"""Clientes do Telegram por usuário, criados sob demanda e mantidos conectados.

Cada usuário assiste e coleta canais com a própria conta do Telegram. O
cliente é conectado no primeiro uso (não no início do servidor) e reaproveitado
nos pedidos seguintes. Se o Telegram revogar a sessão (por exemplo, a pessoa
encerrou a sessão "Teleaula" pelo app), a API responde
`telegram_reauth_required` e o frontend leva de volta à etapa de vínculo.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from telethon import TelegramClient

from ..config import Settings
from ..errors import AppError
from ..streaming.cache import ChunkCache, DiskChunkCache
from .client import create_client
from .media import TelegramMedia

log = logging.getLogger("teleaula.telegram")
CONNECT_TIMEOUT = 20


class TelegramNotLinked(AppError):
    def __init__(self) -> None:
        super().__init__(
            409, "telegram_not_linked", "Vincule sua conta do Telegram para assistir e coletar cursos."
        )


class TelegramReauthRequired(AppError):
    def __init__(self) -> None:
        super().__init__(
            401,
            "telegram_reauth_required",
            "Sua sessão do Telegram foi encerrada. Vincule a conta de novo para continuar.",
        )


class TelegramUnavailable(AppError):
    def __init__(self) -> None:
        super().__init__(
            503,
            "telegram_unavailable",
            "Não foi possível falar com o Telegram agora. Verifique a internet e tente de novo.",
        )


@dataclass
class _Entry:
    client: TelegramClient
    media: TelegramMedia


ClientFactory = Callable[[Path], TelegramClient]


class TelegramClients:
    def __init__(
        self,
        settings: Settings,
        *,
        factory: ClientFactory | None = None,
        memory_cache: ChunkCache | None = None,
        disk_cache: DiskChunkCache | None = None,
    ) -> None:
        self.settings = settings
        self._factory = factory or (lambda path: create_client(settings, path))
        self._memory = memory_cache
        self._disk = disk_cache
        self._entries: dict[str, _Entry] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def session_file(self, user_id: str) -> Path:
        return self.settings.session_path(user_id).with_suffix(".session")

    def has_session(self, user_id: str) -> bool:
        return self.session_file(user_id).is_file()

    async def _entry(self, user_id: str) -> _Entry:
        entry = self._entries.get(user_id)
        if entry is not None and entry.client.is_connected():
            return entry
        lock = self._locks.setdefault(user_id, asyncio.Lock())
        async with lock:
            entry = self._entries.get(user_id)
            if entry is not None and entry.client.is_connected():
                return entry
            if entry is not None:
                self._entries.pop(user_id, None)
            if not self.has_session(user_id):
                raise TelegramReauthRequired()
            client = self._factory(self.settings.session_path(user_id))
            try:
                await asyncio.wait_for(client.connect(), CONNECT_TIMEOUT)
                authorized = await asyncio.wait_for(client.is_user_authorized(), CONNECT_TIMEOUT)
            except (OSError, asyncio.TimeoutError) as exc:
                log.warning("Telegram indisponível: %s", type(exc).__name__)
                await _quiet_disconnect(client)
                raise TelegramUnavailable() from exc
            if not authorized:
                # Sessão revogada no Telegram: o arquivo não serve mais.
                await _quiet_disconnect(client)
                self._delete_session(user_id)
                raise TelegramReauthRequired()
            media = TelegramMedia(
                client,
                cache_bytes=self.settings.stream_cache_mb * 1024 * 1024,
                memory_cache=self._memory,
                disk_cache=self._disk,
            )
            entry = self._entries[user_id] = _Entry(client, media)
            return entry

    async def client(self, user_id: str) -> TelegramClient:
        return (await self._entry(user_id)).client

    async def media(self, user_id: str) -> TelegramMedia:
        return (await self._entry(user_id)).media

    def is_connected(self, user_id: str) -> bool:
        entry = self._entries.get(user_id)
        return entry is not None and entry.client.is_connected()

    async def discard(self, user_id: str, *, log_out: bool = False, delete_session: bool = False) -> None:
        """Fecha o cliente do usuário. `log_out` encerra a sessão também no Telegram."""
        entry = self._entries.pop(user_id, None)
        client = entry.client if entry else None
        if log_out and client is None and self.has_session(user_id):
            client = self._factory(self.settings.session_path(user_id))
            try:
                await asyncio.wait_for(client.connect(), CONNECT_TIMEOUT)
            except (OSError, asyncio.TimeoutError):
                pass
        if client is not None:
            if log_out:
                try:
                    await asyncio.wait_for(client.log_out(), CONNECT_TIMEOUT)
                except Exception:  # noqa: BLE001 - sem rede: apagamos a sessão mesmo assim
                    log.warning("Não foi possível encerrar a sessão no Telegram")
            await _quiet_disconnect(client)
        if delete_session:
            self._delete_session(user_id)

    async def revoked(self, user_id: str) -> None:
        """O Telegram recusou a sessão no meio do uso (UnauthorizedError)."""
        await self.discard(user_id, delete_session=True)

    def _delete_session(self, user_id: str) -> None:
        for path in self.session_file(user_id).parent.glob(f"{user_id}.session*"):
            path.unlink(missing_ok=True)

    async def close(self) -> None:
        for user_id in list(self._entries):
            await self.discard(user_id)


async def _quiet_disconnect(client: TelegramClient) -> None:
    try:
        await client.disconnect()
    except Exception:  # noqa: BLE001
        pass
