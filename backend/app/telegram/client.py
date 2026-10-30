"""Criação do cliente Telethon a partir da configuração."""

from __future__ import annotations

from telethon import TelegramClient

from ..config import Settings


class TelegramNotConfigured(RuntimeError):
    pass


def create_client(settings: Settings) -> TelegramClient:
    if not settings.telegram_configured:
        raise TelegramNotConfigured(
            "Defina TG_API_ID e TG_API_HASH no .env (obtidos em https://my.telegram.org)."
        )
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return TelegramClient(
        str(settings.session_path),
        settings.api_id,
        settings.api_hash,
        flood_sleep_threshold=60,
    )
