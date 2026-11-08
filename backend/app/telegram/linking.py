"""Vínculo da conta do Telegram pela interface (substitui o `cli login`).

O login do Telegram (MTProto, via Telethon) tem estado entre os passos: o
mesmo cliente que pediu o código precisa confirmar o código e a senha de duas
etapas. Por isso cada vínculo em andamento ("fluxo") guarda seu cliente em
memória, preso ao usuário logado que o iniciou:

1. `start(telefone)`  -> `send_code_request`: o Telegram escolhe como entrega o
   código (app, SMS, ligação, e-mail...) e a resposta diz qual foi;
2. `resend()`         -> pede o código de novo, pelo próximo método oferecido;
3. `submit_code()`    -> `sign_in(código)`; se a conta tem verificação em duas
   etapas, o Telegram pede a senha (`SessionPasswordNeededError`);
4. `submit_password()`-> `sign_in(password=...)`;
5. no sucesso, a sessão é gravada em `data/sessions/<usuário>.session` e o
   vínculo em `telegram_accounts`.

Alternativa sem código: `start_qr()` mostra um QR code (`auth.exportLoginToken`)
que a pessoa aprova no celular (Configurações > Dispositivos > Conectar
dispositivo). Serve quando o Telegram não entrega o código, o que acontece com
logins vindos de IPs de datacenter (servidor na nuvem). Uma tarefa em segundo
plano espera a aprovação e renova o QR quando ele expira; a tela consulta
`qr_state()`. Se a conta tem senha de duas etapas, o fluxo cai na etapa
`password` e segue igual ao do código.

Durante o fluxo a sessão fica só em memória (`StringSession`): um fluxo
abandonado não deixa arquivo nenhum. Fluxos expiram após `FLOW_TTL` sem uso.
Nada daqui registra telefone, código ou senha em log.
"""

from __future__ import annotations

import asyncio
import datetime
import logging
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, TypeVar

from telethon import TelegramClient, errors, functions, types
from telethon.sessions import SQLiteSession, StringSession

from ..accounts.ratelimit import RateLimiter, format_wait
from ..accounts.validation import mask_phone, normalize_phone
from ..config import Settings
from ..errors import AppError
from .accounts import LinkedAccount, TelegramAccountConflict, TelegramAccountStore
from .client import TelegramNotConfigured, create_client
from .clients import TelegramClients

log = logging.getLogger("teleaula.telegram.link")

FLOW_TTL = 10 * 60  # segundos sem atividade até o fluxo expirar
REQUEST_TIMEOUT = 25  # cada chamada ao Telegram
MAX_CODE_ATTEMPTS = 5
MAX_PASSWORD_ATTEMPTS = 5
MAX_RESENDS = 4
QR_RESULT_TTL = 2 * 60  # resultado do QR (vinculado ou erro) guardado até a tela consultar
STARTS_PER_WINDOW, START_WINDOW = 5, 15 * 60  # códigos pedidos por usuário

T = TypeVar("T")
SessionFactory = Callable[[object], TelegramClient]


def _err(status: int, code: str, message: str, **kwargs) -> AppError:
    return AppError(status, code, message, **kwargs)


def flood_error(seconds: int) -> AppError:
    return _err(
        429,
        "telegram_flood_wait",
        f"O Telegram limitou novas tentativas para este número. Tente de novo em {format_wait(seconds)}.",
        retry_after=seconds,
    )


def describe_delivery(sent_type, *, length_hint: int | None = None) -> dict:
    """Traduz o tipo de envio do Telegram para o formato que a tela usa.

    `input` diz o que a pessoa digita: `digits` (com `length`), `text` (uma
    palavra ou frase do SMS) ou `phone_tail` (os últimos dígitos do número que
    ligou).
    """
    length = getattr(sent_type, "length", None) or length_hint
    if isinstance(sent_type, types.auth.SentCodeTypeApp):
        return {"method": "app", "input": "digits", "length": length}
    if isinstance(sent_type, (types.auth.SentCodeTypeSms, types.auth.SentCodeTypeFirebaseSms)):
        return {"method": "sms", "input": "digits", "length": length}
    if isinstance(sent_type, types.auth.SentCodeTypeSmsWord):
        return {"method": "sms_word", "input": "text", "length": None, "beginning": sent_type.beginning}
    if isinstance(sent_type, types.auth.SentCodeTypeSmsPhrase):
        return {"method": "sms_phrase", "input": "text", "length": None, "beginning": sent_type.beginning}
    if isinstance(sent_type, types.auth.SentCodeTypeCall):
        return {"method": "call", "input": "digits", "length": length}
    if isinstance(sent_type, types.auth.SentCodeTypeFlashCall):
        return {"method": "flash_call", "input": "phone", "length": None}
    if isinstance(sent_type, types.auth.SentCodeTypeMissedCall):
        return {"method": "missed_call", "input": "phone_tail", "length": sent_type.length, "prefix": sent_type.prefix}
    if isinstance(sent_type, types.auth.SentCodeTypeEmailCode):
        return {"method": "email", "input": "digits", "length": length, "email": sent_type.email_pattern}
    if isinstance(sent_type, types.auth.SentCodeTypeFragmentSms):
        return {"method": "fragment", "input": "digits", "length": length, "url": sent_type.url}
    return {"method": "unknown", "input": "digits", "length": length}


def describe_next(next_type) -> str | None:
    if next_type is None:
        return None
    if isinstance(next_type, types.auth.CodeTypeSms):
        return "sms"
    if isinstance(next_type, types.auth.CodeTypeCall):
        return "call"
    if isinstance(next_type, types.auth.CodeTypeFlashCall):
        return "flash_call"
    if isinstance(next_type, types.auth.CodeTypeMissedCall):
        return "missed_call"
    if isinstance(next_type, types.auth.CodeTypeFragmentSms):
        return "fragment"
    return "other"


@dataclass
class LinkFlow:
    user_id: str
    client: TelegramClient
    phone: str  # vazio no fluxo por QR code
    step: str = "code"  # "code" | "password" | "qr"
    method: str = "phone"  # "phone" | "qr"
    qr: object = None
    qr_url: str = ""
    qr_expires: float = 0.0  # time.time()
    task: asyncio.Task | None = None
    phone_code_hash: str = ""
    delivery: dict = field(default_factory=dict)
    next_method: str | None = None
    resend_at: float = 0.0  # time.time()
    resends: int = 0
    code_expired: bool = False
    code_attempts: int = 0
    password_attempts: int = 0
    password_hint: str | None = None
    touched: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def public(self) -> dict:
        now = time.time()
        return {
            "step": self.step,
            "method": self.method,
            "phone": mask_phone(self.phone) if self.phone else None,
            "qr_url": self.qr_url if self.step == "qr" else None,
            "qr_expires_in": max(0, round(self.qr_expires - now)) if self.step == "qr" else 0,
            "delivery": self.delivery,
            "next_method": self.next_method,
            "can_resend": self.step == "code"
            and (self.code_expired or (self.next_method is not None and self.resends < MAX_RESENDS)),
            "resend_in": max(0, round(self.resend_at - now)) if self.resend_at else 0,
            "code_expired": self.code_expired,
            "attempts_left": (
                MAX_CODE_ATTEMPTS - self.code_attempts
                if self.step == "code"
                else MAX_PASSWORD_ATTEMPTS - self.password_attempts
            ),
            "password_hint": self.password_hint,
            "expires_in": max(0, round(FLOW_TTL - (time.monotonic() - self.touched))),
        }


class TelegramLinker:
    def __init__(
        self,
        settings: Settings,
        accounts: TelegramAccountStore,
        clients: TelegramClients,
        limiter: RateLimiter,
        *,
        factory: SessionFactory | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.settings = settings
        self.accounts = accounts
        self.clients = clients
        self.limiter = limiter
        # Fluxo de login: sem espera automática em FloodWait (a pessoa recebe o aviso na hora).
        self._factory = factory or (lambda session: create_client(settings, session, flood_sleep_threshold=0))
        self._clock = clock
        self._flows: dict[str, LinkFlow] = {}
        self._starting: set[str] = set()
        # Fim de um fluxo por QR (feito em segundo plano), até a tela consultar.
        self._qr_results: dict[str, tuple[float, dict | AppError]] = {}

    # --- estado ---------------------------------------------------------------

    def _expired(self, flow: LinkFlow) -> bool:
        return self._clock() - flow.touched > FLOW_TTL

    def flow(self, user_id: str) -> LinkFlow | None:
        """Fluxo em andamento (um expirado conta como inexistente; `sweep` o fecha)."""
        flow = self._flows.get(user_id)
        if flow is not None and self._expired(flow) and not flow.lock.locked():
            return None
        return flow

    def state(self, user_id: str) -> dict | None:
        flow = self.flow(user_id)
        return flow.public() if flow else None

    def _require(self, user_id: str, step: str) -> LinkFlow:
        flow = self._flows.get(user_id)
        if flow is None or (self._expired(flow) and not flow.lock.locked()):
            if flow is not None:
                self._flows.pop(user_id, None)
                asyncio.ensure_future(_close(flow))
            raise _err(
                410,
                "link_expired",
                "Esta etapa expirou por falta de atividade. Informe o telefone de novo para receber outro código.",
            )
        if flow.step != step:
            raise _err(409, "wrong_step", "Esta etapa já foi concluída. Atualize a página para continuar.")
        if flow.lock.locked():
            raise _err(409, "busy", "Ainda estamos processando o pedido anterior.")
        return flow

    async def cancel(self, user_id: str) -> None:
        self._qr_results.pop(user_id, None)
        flow = self._flows.pop(user_id, None)
        if flow is not None:
            await _close(flow)

    async def sweep(self) -> None:
        for user_id, flow in list(self._flows.items()):
            if self._expired(flow) and not flow.lock.locked():
                self._flows.pop(user_id, None)
                await _close(flow)
        now = self._clock()
        for user_id, (at, _) in list(self._qr_results.items()):
            if now - at > QR_RESULT_TTL:
                self._qr_results.pop(user_id, None)

    async def close(self) -> None:
        for user_id in list(self._flows):
            await self.cancel(user_id)

    # --- passos ---------------------------------------------------------------

    async def start(self, user_id: str, phone_input: str) -> dict:
        if not self.settings.telegram_configured:
            raise TelegramNotConfigured()
        phone = normalize_phone(phone_input)
        owner = self.accounts.owner_of_phone(phone)
        if owner is not None and owner != user_id:
            raise _err(
                409,
                "phone_in_use",
                "Este telefone já está vinculado a outra conta do Teleaula.",
                field="phone",
            )
        if user_id in self._starting:
            raise _err(409, "busy", "Já estamos enviando o código. Aguarde um instante.")
        self.limiter.hit(
            f"tg-start:{user_id}",
            STARTS_PER_WINDOW,
            START_WINDOW,
            "Você pediu muitos códigos em pouco tempo. Aguarde alguns minutos e tente de novo.",
        )
        self._starting.add(user_id)
        try:
            await self.cancel(user_id)  # recomeçar descarta o fluxo anterior
            client = self._factory(StringSession())
            flow = LinkFlow(user_id=user_id, client=client, phone=phone, touched=self._clock())
            try:
                await self._call(client.connect())
                sent = await self._call(client.send_code_request(phone))
            except BaseException:
                await _disconnect(client)
                raise
            self._apply_sent(flow, sent)
            self._flows[user_id] = flow
            return flow.public()
        finally:
            self._starting.discard(user_id)

    async def start_qr(self, user_id: str) -> dict:
        """Vínculo por QR code: a pessoa aprova no celular, sem código nenhum."""
        if not self.settings.telegram_configured:
            raise TelegramNotConfigured()
        if user_id in self._starting:
            raise _err(409, "busy", "Já estamos preparando o vínculo. Aguarde um instante.")
        self.limiter.hit(
            f"tg-start:{user_id}",
            STARTS_PER_WINDOW,
            START_WINDOW,
            "Você tentou vincular muitas vezes em pouco tempo. Aguarde alguns minutos e tente de novo.",
        )
        self._starting.add(user_id)
        try:
            await self.cancel(user_id)
            client = self._factory(StringSession())
            flow = LinkFlow(user_id=user_id, client=client, phone="", step="qr", method="qr", touched=self._clock())
            try:
                await self._call(client.connect())
                flow.qr = await self._call(client.qr_login())
            except BaseException:
                await _disconnect(client)
                raise
            self._apply_qr(flow)
            self._flows[user_id] = flow
            flow.task = asyncio.create_task(self._wait_qr(flow))
            return flow.public()
        finally:
            self._starting.discard(user_id)

    def qr_state(self, user_id: str) -> dict:
        """O que a tela mostra enquanto espera: QR atual, etapa da senha ou o resultado."""
        flow = self.flow(user_id)
        if flow is not None and flow.method == "qr":
            flow.touched = self._clock()  # a tela aberta mantém o fluxo vivo
            return flow.public()
        result = self._qr_results.pop(user_id, None)
        if result is not None:
            if isinstance(result[1], AppError):
                raise result[1]
            return result[1]
        raise _err(410, "link_expired", "O QR code expirou. Gere outro para continuar.")

    async def _wait_qr(self, flow: LinkFlow) -> None:
        """Espera a aprovação no celular, renovando o QR sempre que ele expira."""
        try:
            while self._flows.get(flow.user_id) is flow:
                remaining = max(1.0, flow.qr_expires - time.time())
                try:
                    me = await flow.qr.wait(timeout=remaining)
                except asyncio.TimeoutError:
                    await self._call(flow.qr.recreate())
                    self._apply_qr(flow)
                    continue
                except errors.SessionPasswordNeededError:
                    flow.step = "password"
                    flow.touched = self._clock()
                    flow.password_hint = await self._password_hint(flow.client)
                    return
                result = await self._finish(flow, me)
                self._qr_results[flow.user_id] = (self._clock(), result)
                return
        except asyncio.CancelledError:
            raise
        except AppError as exc:
            self._qr_results[flow.user_id] = (self._clock(), exc)
            await self._drop(flow)
        except Exception:  # noqa: BLE001
            log.exception("Falha no vínculo por QR code")
            self._qr_results[flow.user_id] = (
                self._clock(),
                _err(502, "telegram_error", "O Telegram recusou o pedido. Gere outro QR code e tente de novo."),
            )
            await self._drop(flow)

    def _apply_qr(self, flow: LinkFlow) -> None:
        flow.qr_url = flow.qr.url
        expires = flow.qr.expires
        if isinstance(expires, datetime.datetime):
            flow.qr_expires = expires.timestamp()
        else:
            flow.qr_expires = time.time() + 30

    async def resend(self, user_id: str) -> dict:
        flow = self._require(user_id, "code")
        wait = round(flow.resend_at - time.time())
        if wait > 0 and not flow.code_expired:
            raise _err(429, "resend_too_soon", f"Aguarde {format_wait(wait)} para pedir outro código.", retry_after=wait)
        if flow.resends >= MAX_RESENDS and not flow.code_expired:
            raise _err(429, "resend_limit", "Limite de reenvios atingido. Recomece informando o telefone.")
        async with flow.lock:
            # Telethon reenvia (`ResendCodeRequest`) enquanto o código vale e pede
            # um novo quando ele expirou.
            sent = await self._call(flow.client.send_code_request(flow.phone))
            flow.resends += 1
            flow.code_expired = False
            flow.code_attempts = 0
            self._apply_sent(flow, sent)
            flow.touched = self._clock()
        return flow.public()

    async def submit_code(self, user_id: str, code_input: str) -> dict:
        flow = self._require(user_id, "code")
        code = self._clean_code(flow, code_input)
        if flow.code_expired:
            raise _err(410, "code_expired", "Este código expirou. Peça um novo código.", field="code")
        async with flow.lock:
            flow.touched = self._clock()
            try:
                me = await self._call(
                    flow.client.sign_in(phone=flow.phone, code=code, phone_code_hash=flow.phone_code_hash)
                )
            except errors.SessionPasswordNeededError:
                flow.step = "password"
                flow.password_hint = await self._password_hint(flow.client)
                return flow.public()
            except (errors.PhoneCodeInvalidError, errors.PhoneCodeEmptyError) as exc:
                flow.code_attempts += 1
                left = MAX_CODE_ATTEMPTS - flow.code_attempts
                if left <= 0:
                    await self._drop(flow)
                    raise _err(
                        429,
                        "too_many_attempts",
                        "Muitos códigos incorretos. Por segurança, recomece informando o telefone.",
                    ) from exc
                raise _err(
                    422,
                    "code_invalid",
                    f"Código incorreto. Confira e tente de novo ({left} {'tentativa restante' if left == 1 else 'tentativas restantes'}).",
                    field="code",
                    extra={"attempts_left": left},
                ) from exc
            except errors.PhoneCodeExpiredError as exc:
                flow.code_expired = True
                raise _err(410, "code_expired", "Este código expirou. Peça um novo código.", field="code") from exc
            except errors.PhoneNumberUnoccupiedError as exc:
                await self._drop(flow)
                raise _err(
                    422,
                    "phone_not_registered",
                    "Este número ainda não tem conta no Telegram. Crie a conta pelo app oficial e volte aqui.",
                    field="phone",
                ) from exc
            return await self._finish(flow, me)

    async def submit_password(self, user_id: str, password: str) -> dict:
        flow = self._require(user_id, "password")
        if not password:
            raise _err(422, "password_required", "Digite a senha de verificação em duas etapas.", field="password")
        if len(password) > 256:
            raise _err(422, "password_invalid", "Senha incorreta.", field="password")
        async with flow.lock:
            flow.touched = self._clock()
            try:
                me = await self._call(flow.client.sign_in(password=password))
            except errors.PasswordHashInvalidError as exc:
                flow.password_attempts += 1
                left = MAX_PASSWORD_ATTEMPTS - flow.password_attempts
                if left <= 0:
                    await self._drop(flow)
                    raise _err(
                        429,
                        "too_many_attempts",
                        "Muitas senhas incorretas. Por segurança, recomece informando o telefone.",
                    ) from exc
                raise _err(
                    422,
                    "password_invalid",
                    f"Senha incorreta ({left} {'tentativa restante' if left == 1 else 'tentativas restantes'}).",
                    field="password",
                    extra={"attempts_left": left},
                ) from exc
            return await self._finish(flow, me)

    # --- auxiliares -----------------------------------------------------------

    def _apply_sent(self, flow: LinkFlow, sent) -> None:
        if isinstance(sent.type, types.auth.SentCodeTypeSetUpEmailRequired):
            raise _err(
                422,
                "email_setup_required",
                "O Telegram pede que você cadastre um e-mail de login no app oficial antes de entrar em outro "
                "aplicativo. Faça isso em Configurações > Privacidade e tente de novo.",
                field="phone",
            )
        flow.phone_code_hash = sent.phone_code_hash or flow.phone_code_hash
        flow.delivery = describe_delivery(sent.type, length_hint=flow.delivery.get("length"))
        flow.next_method = describe_next(getattr(sent, "next_type", None))
        timeout = getattr(sent, "timeout", None)
        # Sem `timeout`, o Telegram não impõe espera; usamos 30 s para evitar cliques repetidos.
        flow.resend_at = time.time() + (timeout if timeout else 30)

    def _clean_code(self, flow: LinkFlow, value: str) -> str:
        delivery = flow.delivery
        raw = (value or "").strip()
        if delivery.get("input") == "text":
            if not raw or len(raw) > 64:
                raise _err(422, "code_format", "Digite a palavra ou frase recebida por SMS.", field="code")
            return raw
        digits = "".join(ch for ch in raw if ch.isdigit())
        length = delivery.get("length")
        if delivery.get("input") == "phone":
            if not 5 <= len(digits) <= 16:
                raise _err(422, "code_format", "Digite o número completo que ligou para você.", field="code")
            return digits
        if not digits or (length and len(digits) != length) or (not length and not 4 <= len(digits) <= 8):
            expected = f"{length} dígitos" if length else "só números"
            raise _err(422, "code_format", f"O código tem {expected}.", field="code")
        return digits

    async def _password_hint(self, client: TelegramClient) -> str | None:
        try:
            info = await self._call(client(functions.account.GetPasswordRequest()))
        except AppError:
            return None
        hint = getattr(info, "hint", None)
        return hint[:64] if hint else None

    async def _finish(self, flow: LinkFlow, me) -> dict:
        owner = self.accounts.owner_of_telegram_user(int(me.id))
        if owner is not None and owner != flow.user_id:
            # Encerra a autorização recém-criada: ela não será usada.
            try:
                await self._call(flow.client.log_out())
            except AppError:
                pass
            await self._drop(flow)
            raise _err(409, "telegram_in_use", "Esta conta do Telegram já está vinculada a outra conta do Teleaula.")
        if flow.method == "qr":
            # No QR o telefone só aparece agora; a regra de "um telefone, um usuário" vale igual.
            flow.phone = _phone_of(me)
            if not flow.phone:
                await self._drop(flow)
                raise _err(502, "telegram_error", "O Telegram não informou o telefone da conta. Tente vincular pelo número.")
            phone_owner = self.accounts.owner_of_phone(flow.phone)
            if phone_owner is not None and phone_owner != flow.user_id:
                try:
                    await self._call(flow.client.log_out())
                except AppError:
                    pass
                await self._drop(flow)
                raise _err(409, "phone_in_use", "Este telefone já está vinculado a outra conta do Teleaula.")

        # Substitui uma sessão anterior do mesmo usuário (revincular).
        await self.clients.discard(flow.user_id, delete_session=True)
        session = flow.client.session
        self.settings.sessions_dir.mkdir(parents=True, exist_ok=True)
        target = SQLiteSession(str(self.settings.session_path(flow.user_id)))
        try:
            target.set_dc(session.dc_id, session.server_address, session.port)
            target.auth_key = session.auth_key
            target.save()
        finally:
            target.close()
        _restrict(self.clients.session_file(flow.user_id))
        await self._drop(flow)
        try:
            account = self.accounts.link(flow.user_id, flow.phone, me)
        except TelegramAccountConflict as exc:
            await self.clients.discard(flow.user_id, log_out=True, delete_session=True)
            raise _err(409, "telegram_in_use", "Esta conta do Telegram já está vinculada a outra conta do Teleaula.") from exc
        log.info("Conta do Telegram vinculada ao usuário %s", flow.user_id)
        return {"step": "done", "account": account.to_dict()}

    async def _drop(self, flow: LinkFlow) -> None:
        if self._flows.get(flow.user_id) is flow:
            self._flows.pop(flow.user_id, None)
        await _close(flow)

    async def _call(self, awaitable: Awaitable[T]) -> T:
        """Chama o Telegram com tempo limite e traduz os erros gerais."""
        try:
            return await asyncio.wait_for(awaitable, REQUEST_TIMEOUT)
        except asyncio.TimeoutError as exc:
            raise _err(504, "telegram_timeout", "O Telegram demorou para responder. Tente de novo.") from exc
        except errors.FloodWaitError as exc:
            raise flood_error(int(exc.seconds)) from exc
        except (errors.PhoneNumberFloodError, errors.PhonePasswordFloodError) as exc:
            raise _err(
                429,
                "telegram_flood",
                "O Telegram bloqueou temporariamente novas tentativas para este número. Tente mais tarde.",
            ) from exc
        except errors.PhoneNumberInvalidError as exc:
            raise _err(422, "invalid_phone", "O Telegram não reconheceu este número. Confira o código do país e o DDD.", field="phone") from exc
        except errors.PhoneNumberBannedError as exc:
            raise _err(403, "phone_banned", "Este número foi bloqueado pelo Telegram.", field="phone") from exc
        except errors.SendCodeUnavailableError as exc:
            raise _err(
                429,
                "send_code_unavailable",
                "O Telegram não tem mais formas de enviar o código agora. Aguarde alguns minutos e recomece.",
            ) from exc
        except (errors.ApiIdInvalidError, errors.ApiIdPublishedFloodError) as exc:
            log.error("TG_API_ID/TG_API_HASH recusados pelo Telegram")
            raise _err(
                503,
                "telegram_not_configured",
                "As credenciais de API do Telegram do servidor são inválidas. Confira TG_API_ID e TG_API_HASH no .env.",
            ) from exc
        except (OSError, ConnectionError) as exc:
            log.warning("Falha de conexão com o Telegram: %s", type(exc).__name__)
            raise _err(503, "telegram_unavailable", "Não foi possível falar com o Telegram. Verifique a internet e tente de novo.") from exc
        except (
            errors.PhoneCodeInvalidError,
            errors.PhoneCodeEmptyError,
            errors.PhoneCodeExpiredError,
            errors.SessionPasswordNeededError,
            errors.PasswordHashInvalidError,
            errors.PhoneNumberUnoccupiedError,
        ):
            raise  # tratados por quem chamou
        except errors.RPCError as exc:
            log.warning("Erro do Telegram no vínculo: %s", type(exc).__name__)
            raise _err(502, "telegram_error", "O Telegram recusou o pedido. Tente de novo em instantes.") from exc


def _phone_of(me) -> str:
    """Telefone da conta que aprovou o QR (o Telegram manda sem o `+`)."""
    raw = getattr(me, "phone", None)
    if not raw:
        return ""
    try:
        return normalize_phone(f"+{raw}")
    except AppError:
        return ""


async def _close(flow: LinkFlow) -> None:
    """Encerra um fluxo: para a espera do QR (se houver) e desconecta o cliente."""
    task = flow.task
    if task is not None and task is not asyncio.current_task() and not task.done():
        task.cancel()
    await _disconnect(flow.client)


async def _disconnect(client: TelegramClient) -> None:
    try:
        await client.disconnect()
    except Exception:  # noqa: BLE001
        pass


def _restrict(path) -> None:
    try:
        path.chmod(0o600)
    except OSError:
        pass


def account_status(
    settings: Settings, accounts: TelegramAccountStore, clients: TelegramClients, linker: TelegramLinker, user_id: str
) -> dict:
    account: LinkedAccount | None = accounts.get(user_id)
    linked = account is not None and clients.has_session(user_id)
    return {
        "configured": settings.telegram_configured,
        "linked": linked,
        # Precisa vincular de novo: há registro, mas a sessão sumiu ou foi revogada.
        "needs_reauth": account is not None and not linked,
        "account": account.to_dict() if account else None,
        "flow": linker.state(user_id),
    }
