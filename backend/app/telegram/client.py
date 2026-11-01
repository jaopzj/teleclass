"""Criação dos clientes Telethon.

Cada usuário da plataforma usa a própria conta do Telegram, com a sessão em
`data/sessions/<id do usuário>.session`. O arquivo equivale à senha da conta.
"""

from __future__ import annotations

from pathlib import Path

from telethon import TelegramClient
from telethon.sessions import Session

from ..config import Settings
from ..errors import AppError


class TelegramNotConfigured(AppError):
    def __init__(self) -> None:
        super().__init__(
            503,
            "telegram_not_configured",
            "O servidor ainda não está configurado para o Telegram. "
            "Defina TG_API_ID e TG_API_HASH no arquivo .env e reinicie o servidor.",
        )


def create_client(
    settings: Settings, session: str | Path | Session, *, flood_sleep_threshold: int = 60
) -> TelegramClient:
    """`session`: caminho do arquivo (sem `.session`) ou uma sessão do Telethon."""
    if not settings.telegram_configured:
        raise TelegramNotConfigured()
    if isinstance(session, Path):
        session.parent.mkdir(parents=True, exist_ok=True)
        session = str(session)
    return TelegramClient(
        session,
        settings.api_id,
        settings.api_hash,
        flood_sleep_threshold=flood_sleep_threshold,
        device_model="Teleaula",
        app_version="0.1.0",
    )
