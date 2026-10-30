"""Estado da aplicação e dependências comuns das rotas."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from fastapi import Depends, Request

from ..accounts import RateLimiter, SessionStore, User, UserStore
from ..config import Settings
from ..courses import CourseCatalog
from ..errors import AppError
from ..learning import NotesStore, ProgressStore
from ..snapshots import SnapshotStore
from ..telegram.accounts import TelegramAccountStore
from ..telegram.clients import TelegramClients
from ..telegram.linking import TelegramLinker

SESSION_COOKIE = "teleaula_session"


@dataclass
class AppState:
    settings: Settings
    store: SnapshotStore
    catalog: CourseCatalog
    progress: ProgressStore
    notes: NotesStore
    users: UserStore
    sessions: SessionStore
    limiter: RateLimiter
    telegram_accounts: TelegramAccountStore
    clients: TelegramClients
    linker: TelegramLinker
    # A coleta é sequencial para respeitar os limites do Telegram (PLANO.md, 9).
    collect_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # Poucas miniaturas por vez, para não disparar muitas requisições ao Telegram.
    thumbs_semaphore: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(3))


def get_state(request: Request) -> AppState:
    return request.app.state.teleaula


class NotAuthenticated(AppError):
    def __init__(self) -> None:
        super().__init__(401, "not_authenticated", "Sua sessão terminou. Entre de novo para continuar.")


def get_current_user(request: Request, state: AppState = Depends(get_state)) -> User:
    """Usuário logado na plataforma (cookie de sessão). Independe do Telegram."""
    user_id = state.sessions.resolve(request.cookies.get(SESSION_COOKIE))
    user = state.users.get(user_id) if user_id else None
    if user is None:
        raise NotAuthenticated()
    return user


def get_user_id(user: User = Depends(get_current_user)) -> str:
    return user.id


def require_telegram(state: AppState, user_id: str) -> None:
    """Erro claro antes de tentar conectar: servidor sem API, conta não vinculada."""
    from ..telegram.client import TelegramNotConfigured
    from ..telegram.clients import TelegramNotLinked

    if not state.settings.telegram_configured:
        raise TelegramNotConfigured()
    if state.telegram_accounts.get(user_id) is None:
        raise TelegramNotLinked()


async def get_media(state: AppState = Depends(get_state), user_id: str = Depends(get_user_id)):
    """Mídia do Telegram pela conta do próprio usuário."""
    require_telegram(state, user_id)
    return await state.clients.media(user_id)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"
