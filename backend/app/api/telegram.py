"""Conta do Telegram do usuário logado (`/api/telegram`).

Vincular a conta é um fluxo em etapas (ver app/telegram/linking.py). Todas as
rotas exigem login na plataforma, e o fluxo fica preso ao usuário que o
iniciou: ninguém continua ou conclui o vínculo de outra pessoa.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from ..accounts import User
from ..errors import AppError
from ..telegram.linking import account_status
from .deps import AppState, get_current_user, get_state

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


class PhoneBody(BaseModel):
    phone: str = Field(max_length=32)


class CodeBody(BaseModel):
    code: str = Field(max_length=64)


class PasswordBody(BaseModel):
    password: str = Field(max_length=256)


class UnlinkBody(BaseModel):
    password: str = Field(max_length=256)


def _status(state: AppState, user: User) -> dict:
    status = account_status(state.settings, state.telegram_accounts, state.clients, state.linker, user.id)
    from ..telegram.media import fast_crypto_available

    # Sem cryptg, a criptografia do Telegram roda em Python puro e o vídeo fica lento.
    status["fast_crypto"] = fast_crypto_available()
    return status


@router.get("/status")
async def status(state: AppState = Depends(get_state), user: User = Depends(get_current_user)) -> dict:
    return _status(state, user)


@router.post("/link/phone")
async def link_phone(body: PhoneBody, state: AppState = Depends(get_state), user: User = Depends(get_current_user)) -> dict:
    return await state.linker.start(user.id, body.phone)


@router.post("/link/qr")
async def link_qr_start(state: AppState = Depends(get_state), user: User = Depends(get_current_user)) -> dict:
    """Vincula por QR code, aprovado no celular (quando o código não chega)."""
    return await state.linker.start_qr(user.id)


@router.get("/link/qr")
async def link_qr_state(state: AppState = Depends(get_state), user: User = Depends(get_current_user)) -> dict:
    """QR atual (renovado sozinho), etapa da senha 2FA ou `{step: "done", account}`."""
    return state.linker.qr_state(user.id)


@router.post("/link/resend")
async def link_resend(state: AppState = Depends(get_state), user: User = Depends(get_current_user)) -> dict:
    return await state.linker.resend(user.id)


@router.post("/link/code")
async def link_code(body: CodeBody, state: AppState = Depends(get_state), user: User = Depends(get_current_user)) -> dict:
    return await state.linker.submit_code(user.id, body.code)


@router.post("/link/password")
async def link_password(
    body: PasswordBody, state: AppState = Depends(get_state), user: User = Depends(get_current_user)
) -> dict:
    return await state.linker.submit_password(user.id, body.password)


@router.delete("/link", status_code=204)
async def link_cancel(state: AppState = Depends(get_state), user: User = Depends(get_current_user)) -> Response:
    await state.linker.cancel(user.id)
    return Response(status_code=204)


@router.post("/unlink")
async def unlink(body: UnlinkBody, state: AppState = Depends(get_state), user: User = Depends(get_current_user)) -> dict:
    """Desvincula: encerra a sessão no Telegram e apaga o arquivo. Pede a senha do Teleaula."""
    key = f"unlink:{user.id}"
    state.limiter.check(key, 5, 15 * 60)
    if not state.users.check_password(user.id, body.password):
        state.limiter.record(key)
        raise AppError(401, "invalid_password", "Senha incorreta.", field="password")
    state.limiter.reset(key)
    await state.linker.cancel(user.id)
    await state.clients.discard(user.id, log_out=True, delete_session=True)
    state.telegram_accounts.unlink(user.id)
    return _status(state, user)
