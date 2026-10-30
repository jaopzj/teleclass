from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from fastapi import Request

from ..config import Settings
from ..snapshots import SnapshotStore


@dataclass
class AppState:
    settings: Settings
    store: SnapshotStore
    telegram: object | None = None  # TelegramClient, quando configurado
    # A coleta é sequencial para respeitar os limites do Telegram (PLANO.md, 9).
    collect_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


def get_state(request: Request) -> AppState:
    return request.app.state.teleaula
