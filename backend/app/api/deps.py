"""Rotas HTTP."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from fastapi import Depends, HTTPException, Request

from ..config import Settings
from ..courses import CourseCatalog
from ..learning import NotesStore, ProgressStore
from ..snapshots import SnapshotStore


@dataclass
class AppState:
    settings: Settings
    store: SnapshotStore
    catalog: CourseCatalog
    progress: ProgressStore
    notes: NotesStore
    telegram: object | None = None  # TelegramClient, quando configurado
    media: object | None = None  # TelegramMedia, criado junto com o cliente
    # A coleta é sequencial para respeitar os limites do Telegram (PLANO.md, 9).
    collect_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # Poucas miniaturas por vez, para não disparar muitas requisições ao Telegram.
    thumbs_semaphore: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(3))


def get_state(request: Request) -> AppState:
    return request.app.state.teleaula


def get_user_id(state: AppState = Depends(get_state)) -> str:
    """Usuário atual. Hoje é sempre o usuário local; o login entra aqui no futuro."""
    return state.settings.user_id


async def get_media(state: AppState = Depends(get_state)):
    client = state.telegram
    if client is None or state.media is None or not await client.is_user_authorized():  # type: ignore[attr-defined]
        raise HTTPException(503, "telegram_not_connected")
    return state.media
