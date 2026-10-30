"""Cadastro, login e sessão da plataforma (`/api/auth`).

Contrato em docs/autenticacao.md. A conta do Telegram é tratada à parte, em
`/api/telegram` (app/api/telegram.py).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from ..accounts import User
from ..accounts.validation import normalize_username
from ..errors import AppError
from ..telegram.linking import account_status
from .deps import SESSION_COOKIE, AppState, client_ip, get_current_user, get_state

router = APIRouter(prefix="/api/auth", tags=["autenticação"])

LOGIN_FAILURES, LOGIN_WINDOW = 8, 15 * 60  # por usuário + IP
LOGIN_IP_FAILURES = 30  # por IP, qualquer usuário
REGISTER_LIMIT, REGISTER_WINDOW = 5, 60 * 60
AVAILABILITY_LIMIT, AVAILABILITY_WINDOW = 60, 60


class Credentials(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


def _set_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=30 * 24 * 3600,
        httponly=True,
        samesite="strict",
        secure=request.url.scheme == "https",
        path="/",
    )


def _session_payload(state: AppState, user: User) -> dict:
    telegram = account_status(state.settings, state.telegram_accounts, state.clients, state.linker, user.id)
    return {"user": user.to_dict(), "telegram": telegram}


@router.get("/session")
def session(request: Request, state: AppState = Depends(get_state)) -> dict:
    """Quem está logado. Responde 200 com `user: null` quando ninguém está."""
    user_id = state.sessions.resolve(request.cookies.get(SESSION_COOKIE))
    user = state.users.get(user_id) if user_id else None
    if user is None:
        return {"user": None, "telegram": None}
    return _session_payload(state, user)


@router.get("/username-availability")
def username_availability(username: str, request: Request, state: AppState = Depends(get_state)) -> dict:
    state.limiter.hit(f"avail:{client_ip(request)}", AVAILABILITY_LIMIT, AVAILABILITY_WINDOW)
    available, reason = state.users.is_available(username[:64])
    return {"username": normalize_username(username[:64]), "available": available, "reason": reason}


@router.post("/register", status_code=201)
def register(body: Credentials, request: Request, response: Response, state: AppState = Depends(get_state)) -> dict:
    state.limiter.hit(
        f"register:{client_ip(request)}",
        REGISTER_LIMIT,
        REGISTER_WINDOW,
        "Muitas contas criadas a partir deste dispositivo. Tente de novo mais tarde.",
    )
    user = state.users.create(body.username, body.password)
    if state.users.count() == 1:
        # Primeira conta: herda os cursos coletados antes de existir login.
        state.libraries.adopt_legacy(user.id)
    _set_cookie(response, request, state.sessions.create(user.id))
    return _session_payload(state, user)


@router.post("/login")
def login(body: Credentials, request: Request, response: Response, state: AppState = Depends(get_state)) -> dict:
    ip = client_ip(request)
    user_key = f"login:{normalize_username(body.username)}:{ip}"
    ip_key = f"login-ip:{ip}"
    message = "Muitas tentativas de login. Aguarde alguns minutos e tente de novo."
    state.limiter.check(user_key, LOGIN_FAILURES, LOGIN_WINDOW, message)
    state.limiter.check(ip_key, LOGIN_IP_FAILURES, LOGIN_WINDOW, message)
    try:
        user = state.users.authenticate(body.username, body.password)
    except AppError:
        state.limiter.record(user_key)
        state.limiter.record(ip_key)
        raise
    state.limiter.reset(user_key)
    # Uma sessão nova a cada login (um token anterior roubado não vira o desta sessão).
    state.sessions.revoke(request.cookies.get(SESSION_COOKIE))
    _set_cookie(response, request, state.sessions.create(user.id))
    return _session_payload(state, user)


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, state: AppState = Depends(get_state)) -> Response:
    """Sai da plataforma. A conta do Telegram continua vinculada."""
    token = request.cookies.get(SESSION_COOKIE)
    user_id = state.sessions.resolve(token)
    if user_id:
        await state.linker.cancel(user_id)  # um vínculo pela metade não sobrevive ao logout
    state.sessions.revoke(token)
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@router.get("/me")
def me(state: AppState = Depends(get_state), user: User = Depends(get_current_user)) -> dict:
    return _session_payload(state, user)
