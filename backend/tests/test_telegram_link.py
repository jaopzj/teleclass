"""Vínculo da conta do Telegram pela interface, com um Telethon falso."""

from types import SimpleNamespace

import pytest
from telethon import errors
from telethon.crypto import AuthKey
from telethon.tl import types

from .conftest import PASSWORD, register

PHONE = "+55 (11) 91234-5678"


class FakeTelethon:
    """Imita o TelegramClient no que o fluxo usa. `world` guarda o "lado do Telegram"."""

    def __init__(self, session, world):
        self.session = session
        self.world = world
        self.connected = False
        world.clients.append(self)

    async def connect(self):
        if self.world.offline:
            raise ConnectionError("sem rede")
        self.connected = True

    async def disconnect(self):
        self.connected = False

    def is_connected(self):
        return self.connected

    async def is_user_authorized(self):
        return self.world.authorized

    async def send_code_request(self, phone):
        self.world.sent.append(phone)
        if self.world.flood:
            raise errors.FloodWaitError(request=None, capture=120)
        return types.auth.SentCode(
            type=self.world.sent_type,
            phone_code_hash="hash",
            next_type=types.auth.CodeTypeSms(),
            timeout=None,
        )

    async def sign_in(self, phone=None, code=None, phone_code_hash=None, password=None):
        if password is not None:
            if password != self.world.password:
                raise errors.PasswordHashInvalidError(request=None)
            return self._login()
        if code == "00000":
            raise errors.PhoneCodeExpiredError(request=None)
        if code != self.world.code:
            raise errors.PhoneCodeInvalidError(request=None)
        if self.world.password:
            raise errors.SessionPasswordNeededError(request=None)
        return self._login()

    def _login(self):
        self.session.set_dc(2, "149.154.167.51", 443)
        self.session.auth_key = AuthKey(b"\x01" * 256)
        self.world.authorized = True
        return SimpleNamespace(
            id=self.world.telegram_id, first_name="João", last_name="Silva", username="joaos", phone="5511912345678"
        )

    async def qr_login(self):
        return FakeQR(self)

    async def __call__(self, request):
        return SimpleNamespace(hint="nome do gato")

    async def log_out(self):
        self.world.logged_out += 1
        self.connected = False
        return True


class FakeQR:
    """QR do Telegram: expira sozinho e "é aprovado" quando o teste liga `world.qr_approved`."""

    def __init__(self, client):
        self.client = client
        self.generation = 0
        self.recreate_sync()

    def recreate_sync(self):
        import datetime

        self.generation += 1
        self.url = f"tg://login?token=tok{self.generation}"
        lifetime = self.client.world.qr_lifetime
        self.expires = datetime.datetime.now(tz=datetime.timezone.utc) + datetime.timedelta(seconds=lifetime)

    async def recreate(self):
        self.recreate_sync()

    async def wait(self, timeout=None):
        import asyncio

        world = self.client.world
        loop = asyncio.get_running_loop()
        end = loop.time() + timeout
        while not world.qr_approved:
            if loop.time() >= end:
                raise asyncio.TimeoutError
            await asyncio.sleep(0.01)
        if world.password:
            raise errors.SessionPasswordNeededError(request=None)
        return self.client._login()


class World:
    def __init__(self):
        self.clients = []
        self.sent = []
        self.code = "12345"
        self.password = None
        self.telegram_id = 777
        self.authorized = False
        self.offline = False
        self.flood = False
        self.logged_out = 0
        self.sent_type = types.auth.SentCodeTypeApp(length=5)
        self.qr_approved = False
        self.qr_lifetime = 30


@pytest.fixture
def world():
    return World()


@pytest.fixture
def make(make_app, monkeypatch, world):
    monkeypatch.setenv("TG_API_ID", "123")
    monkeypatch.setenv("TG_API_HASH", "abc")

    def factory(username="joao"):
        client = make_app()
        state = client.app.state.teleaula
        state.linker._factory = lambda session: FakeTelethon(session, world)
        state.clients._factory = lambda path: FakeTelethon(_file_session(path), world)
        register(client, username)
        return client

    return factory


def _file_session(path):
    from telethon.sessions import SQLiteSession

    return SQLiteSession(str(path))


def test_full_link_flow_without_terminal(make, world, tmp_path):
    client = make()
    flow = client.post("/api/telegram/link/phone", json={"phone": PHONE}).json()
    assert world.sent == ["+5511912345678"]  # normalizado antes de ir ao Telegram
    assert flow["step"] == "code"
    assert flow["delivery"] == {"method": "app", "input": "digits", "length": 5}
    assert flow["next_method"] == "sms"
    assert flow["phone"] == "+55 ••• ••• 5678"
    assert "hash" not in str(flow)  # phone_code_hash nunca vai ao navegador

    done = client.post("/api/telegram/link/code", json={"code": "12345"}).json()
    assert done["step"] == "done" and done["account"]["name"] == "João Silva"
    assert (tmp_path / "sessions").is_dir()
    user_id = client.get("/api/auth/session").json()["user"]["id"]
    assert (tmp_path / "sessions" / f"{user_id}.session").is_file()

    status = client.get("/api/telegram/status").json()
    assert status["linked"] and status["flow"] is None and status["account"]["phone"] == "+55 ••• ••• 5678"
    # O vínculo continua depois de sair e entrar de novo.
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"username": "joao", "password": PASSWORD})
    assert client.get("/api/auth/session").json()["telegram"]["linked"]


def test_two_step_verification(make, world):
    world.password = "senha-do-telegram"
    client = make()
    client.post("/api/telegram/link/phone", json={"phone": PHONE})
    step = client.post("/api/telegram/link/code", json={"code": "12345"}).json()
    assert step["step"] == "password" and step["password_hint"] == "nome do gato"

    wrong = client.post("/api/telegram/link/password", json={"password": "errada"})
    assert wrong.status_code == 422 and wrong.json()["code"] == "password_invalid"
    assert wrong.json()["attempts_left"] == 4
    ok = client.post("/api/telegram/link/password", json={"password": "senha-do-telegram"}).json()
    assert ok["step"] == "done"


def test_wrong_code_and_attempt_limit(make, world):
    client = make()
    client.post("/api/telegram/link/phone", json={"phone": PHONE})
    bad_format = client.post("/api/telegram/link/code", json={"code": "12"})
    assert bad_format.status_code == 422 and bad_format.json()["code"] == "code_format"
    for left in (4, 3, 2, 1):
        response = client.post("/api/telegram/link/code", json={"code": "99999"})
        assert response.json()["code"] == "code_invalid" and response.json()["attempts_left"] == left
    last = client.post("/api/telegram/link/code", json={"code": "99999"})
    assert last.status_code == 429 and last.json()["code"] == "too_many_attempts"
    # O fluxo foi encerrado: é preciso recomeçar pelo telefone.
    again = client.post("/api/telegram/link/code", json={"code": "12345"})
    assert again.status_code == 410 and again.json()["code"] == "link_expired"


def test_expired_code_then_resend(make, world):
    client = make()
    client.post("/api/telegram/link/phone", json={"phone": PHONE})
    expired = client.post("/api/telegram/link/code", json={"code": "00000"})
    assert expired.status_code == 410 and expired.json()["code"] == "code_expired"
    state = client.get("/api/telegram/status").json()["flow"]
    assert state["code_expired"] and state["can_resend"]
    resent = client.post("/api/telegram/link/resend").json()
    assert resent["code_expired"] is False and len(world.sent) == 2
    assert client.post("/api/telegram/link/code", json={"code": "12345"}).json()["step"] == "done"


def test_resend_respects_wait(make, world):
    client = make()
    client.post("/api/telegram/link/phone", json={"phone": PHONE})
    early = client.post("/api/telegram/link/resend")
    assert early.status_code == 429 and early.json()["code"] == "resend_too_soon"


def test_flow_belongs_to_its_user(make, world):
    joao = make("joao")
    maria = make("maria")
    joao.post("/api/telegram/link/phone", json={"phone": PHONE})
    # Maria não enxerga nem conclui o fluxo do João.
    assert maria.get("/api/telegram/status").json()["flow"] is None
    stolen = maria.post("/api/telegram/link/code", json={"code": "12345"})
    assert stolen.status_code == 410
    assert joao.post("/api/telegram/link/code", json={"code": "12345"}).json()["step"] == "done"


def test_link_requires_platform_login(make_app, monkeypatch):
    monkeypatch.setenv("TG_API_ID", "123")
    monkeypatch.setenv("TG_API_HASH", "abc")
    anonymous = make_app()
    assert anonymous.post("/api/telegram/link/phone", json={"phone": PHONE}).status_code == 401


def test_phone_already_linked_to_other_user(make, world):
    joao = make("joao")
    joao.post("/api/telegram/link/phone", json={"phone": PHONE})
    joao.post("/api/telegram/link/code", json={"code": "12345"})
    maria = make("maria")
    response = maria.post("/api/telegram/link/phone", json={"phone": "+5511912345678"})
    assert response.status_code == 409 and response.json()["code"] == "phone_in_use"
    assert len(world.sent) == 1  # nenhum código foi pedido


def test_telegram_account_already_linked_to_other_user(make, world):
    joao = make("joao")
    joao.post("/api/telegram/link/phone", json={"phone": PHONE})
    joao.post("/api/telegram/link/code", json={"code": "12345"})
    maria = make("maria")
    # Outro número, mesma conta do Telegram (ex.: número trocado no Telegram).
    maria.post("/api/telegram/link/phone", json={"phone": "+351912345678"})
    response = maria.post("/api/telegram/link/code", json={"code": "12345"})
    assert response.status_code == 409 and response.json()["code"] == "telegram_in_use"
    assert world.logged_out == 1  # a autorização recém-criada foi encerrada
    assert not maria.get("/api/telegram/status").json()["linked"]


def test_invalid_phone_and_flood(make, world):
    client = make()
    invalid = client.post("/api/telegram/link/phone", json={"phone": "123"})
    assert invalid.status_code == 422 and invalid.json()["field"] == "phone"
    world.flood = True
    flood = client.post("/api/telegram/link/phone", json={"phone": PHONE})
    assert flood.status_code == 429 and flood.json()["code"] == "telegram_flood_wait"
    assert flood.json()["retry_after"] == 120


def test_telegram_offline(make, world):
    client = make()
    world.offline = True
    response = client.post("/api/telegram/link/phone", json={"phone": PHONE})
    assert response.status_code == 503 and response.json()["code"] == "telegram_unavailable"


def test_flow_expires(make, world):
    client = make()
    client.post("/api/telegram/link/phone", json={"phone": PHONE})
    linker = client.app.state.teleaula.linker
    linker._clock = lambda: 10**9  # muito tempo depois
    assert client.get("/api/telegram/status").json()["flow"] is None
    response = client.post("/api/telegram/link/code", json={"code": "12345"})
    assert response.status_code == 410 and response.json()["code"] == "link_expired"


def test_cancel_flow(make, world):
    client = make()
    client.post("/api/telegram/link/phone", json={"phone": PHONE})
    assert client.delete("/api/telegram/link").status_code == 204
    assert client.get("/api/telegram/status").json()["flow"] is None
    assert not world.clients[0].connected


def test_sms_word_delivery_accepts_text(make, world):
    world.sent_type = types.auth.SentCodeTypeSmsWord(beginning="ga")
    world.code = "gato"
    client = make()
    flow = client.post("/api/telegram/link/phone", json={"phone": PHONE}).json()
    assert flow["delivery"]["input"] == "text" and flow["delivery"]["beginning"] == "ga"
    assert client.post("/api/telegram/link/code", json={"code": "gato"}).json()["step"] == "done"


def test_unlink_requires_password_and_logs_out(make, world, tmp_path):
    client = make()
    client.post("/api/telegram/link/phone", json={"phone": PHONE})
    client.post("/api/telegram/link/code", json={"code": "12345"})
    assert client.post("/api/telegram/unlink", json={"password": "errada"}).status_code == 401
    status = client.post("/api/telegram/unlink", json={"password": PASSWORD}).json()
    assert status["linked"] is False and status["account"] is None
    assert world.logged_out == 1
    assert not list((tmp_path / "sessions").glob("*.session"))


def test_revoked_session_asks_to_link_again(make, world):
    client = make()
    client.post("/api/telegram/link/phone", json={"phone": PHONE})
    client.post("/api/telegram/link/code", json={"code": "12345"})
    world.authorized = False  # a pessoa encerrou a sessão pelo app do Telegram
    response = client.get("/api/courses/curso_exemplo/media/10")
    assert response.status_code == 401 and response.json()["code"] == "telegram_reauth_required"
    status = client.get("/api/telegram/status").json()
    assert status["needs_reauth"] and not status["linked"]
    # Vincular de novo com a mesma conta funciona.
    world.authorized = False
    client.post("/api/telegram/link/phone", json={"phone": PHONE})
    assert client.post("/api/telegram/link/code", json={"code": "12345"}).json()["step"] == "done"


def test_streaming_uses_the_users_own_session(make, world):
    client = make()
    client.post("/api/telegram/link/phone", json={"phone": PHONE})
    client.post("/api/telegram/link/code", json={"code": "12345"})
    clients = client.app.state.teleaula.clients
    user_id = client.get("/api/auth/session").json()["user"]["id"]
    import asyncio

    media_client = asyncio.run(clients.client(user_id))
    assert str(media_client.session.filename).endswith(f"{user_id}.session")
    assert media_client.session.auth_key.key == b"\x01" * 256


def _poll_qr(client, until, tries=200):
    import time

    for _ in range(tries):
        response = client.get("/api/telegram/link/qr")
        body = response.json()
        if until(response, body):
            return response, body
        time.sleep(0.02)
    raise AssertionError(f"QR não chegou ao estado esperado: {body}")


def test_qr_link_flow(make, world, tmp_path):
    client = make()
    flow = client.post("/api/telegram/link/qr").json()
    assert flow["step"] == "qr" and flow["method"] == "qr"
    assert flow["qr_url"].startswith("tg://login?token=") and flow["qr_expires_in"] > 0
    assert flow["phone"] is None and world.sent == []  # nenhum código pedido

    world.qr_approved = True
    _, done = _poll_qr(client, lambda r, b: b.get("step") == "done")
    assert done["account"]["name"] == "João Silva" and done["account"]["phone"] == "+55 ••• ••• 5678"
    status = client.get("/api/telegram/status").json()
    assert status["linked"] and status["flow"] is None
    user_id = client.get("/api/auth/session").json()["user"]["id"]
    assert (tmp_path / "sessions" / f"{user_id}.session").is_file()
    # Resultado entregue uma vez só.
    assert client.get("/api/telegram/link/qr").json()["code"] == "link_expired"


def test_qr_renews_when_expired(make, world):
    world.qr_lifetime = 0.05
    client = make()
    first = client.post("/api/telegram/link/qr").json()["qr_url"]
    _, body = _poll_qr(client, lambda r, b: b.get("qr_url") not in (None, first))
    assert body["step"] == "qr"


def test_qr_with_two_step_password(make, world):
    world.password = "segredo"
    client = make()
    client.post("/api/telegram/link/qr")
    world.qr_approved = True
    _, body = _poll_qr(client, lambda r, b: b.get("step") == "password")
    assert body["password_hint"] == "nome do gato"
    done = client.post("/api/telegram/link/password", json={"password": "segredo"}).json()
    assert done["step"] == "done"
    assert client.get("/api/telegram/status").json()["linked"]


def test_qr_rejects_account_of_another_user(make, world):
    first = make("joao")
    first.post("/api/telegram/link/qr")
    world.qr_approved = True
    _poll_qr(first, lambda r, b: b.get("step") == "done")

    world.qr_approved = False
    second = make("maria")
    second.post("/api/telegram/link/qr")
    world.qr_approved = True
    response, body = _poll_qr(second, lambda r, b: r.status_code == 409)
    assert body["code"] == "telegram_in_use"
    assert not second.get("/api/telegram/status").json()["linked"]


def test_cancel_stops_qr_wait(make, world):
    client = make()
    client.post("/api/telegram/link/qr")
    assert client.delete("/api/telegram/link").status_code == 204
    world.qr_approved = True
    import time

    time.sleep(0.1)
    assert not client.get("/api/telegram/status").json()["linked"]
    assert client.get("/api/telegram/link/qr").status_code == 410
