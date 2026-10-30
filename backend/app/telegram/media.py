"""Acesso aos arquivos das mensagens (vídeos, documentos e miniaturas).

Somente leitura. Os vídeos não são baixados para o disco: cada pedido do player
vira um download parcial (`iter_download` com offset) direto do Telegram.
"""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import AsyncIterator

from telethon import TelegramClient, errors, types

from ..streaming.streamer import CHUNK_SIZE

MESSAGE_TTL = 10 * 60  # a referência do arquivo expira; recarregamos de tempos em tempos
MESSAGE_CACHE_SIZE = 512


class MediaUnavailable(LookupError):
    """A mensagem foi apagada, não tem arquivo ou o canal não está acessível."""


@dataclass(frozen=True, slots=True)
class ChannelRef:
    channel_id: int | None
    username: str | None = None


class TelegramMedia:
    def __init__(self, client: TelegramClient) -> None:
        self.client = client
        self._peers: dict[ChannelRef, object] = {}
        self._messages: OrderedDict[tuple[ChannelRef, int], tuple[float, object]] = OrderedDict()
        self._dialogs_loaded = False
        self._lock = asyncio.Lock()

    async def _peer(self, channel: ChannelRef):
        if channel in self._peers:
            return self._peers[channel]
        candidates: list[object] = []
        if channel.channel_id:
            candidates.append(types.PeerChannel(channel.channel_id))
        if channel.username:
            candidates.append(channel.username)
        for attempt in range(2):
            for candidate in candidates:
                try:
                    peer = await self.client.get_input_entity(candidate)
                except (ValueError, errors.RPCError):
                    continue
                self._peers[channel] = peer
                return peer
            # Canal privado fora do cache da sessão: carregar os diálogos preenche o cache.
            async with self._lock:
                if attempt or self._dialogs_loaded:
                    break
                await self.client.get_dialogs()
                self._dialogs_loaded = True
        raise MediaUnavailable("Canal não acessível por esta conta")

    async def message(self, channel: ChannelRef, message_id: int, *, refresh: bool = False):
        key = (channel, message_id)
        cached = self._messages.get(key)
        if cached and not refresh and time.monotonic() - cached[0] < MESSAGE_TTL:
            self._messages.move_to_end(key)
            return cached[1]
        peer = await self._peer(channel)
        message = await self.client.get_messages(peer, ids=message_id)
        if message is None or not getattr(message, "media", None) or not message.file:
            raise MediaUnavailable("Mensagem apagada ou sem arquivo")
        self._messages[key] = (time.monotonic(), message)
        while len(self._messages) > MESSAGE_CACHE_SIZE:
            self._messages.popitem(last=False)
        return message

    async def file_size(self, channel: ChannelRef, message_id: int) -> int:
        message = await self.message(channel, message_id)
        return int(message.file.size or 0)

    def chunks(self, channel: ChannelRef, message_id: int) -> "_MessageChunks":
        return _MessageChunks(self, channel, message_id)

    async def thumbnail(self, channel: ChannelRef, message_id: int) -> bytes | None:
        message = await self.message(channel, message_id)
        document = getattr(message, "document", None)
        if document is not None and not getattr(document, "thumbs", None):
            return None
        try:
            data = await self.client.download_media(message, file=bytes, thumb=-1)
        except errors.FileReferenceExpiredError:
            message = await self.message(channel, message_id, refresh=True)
            data = await self.client.download_media(message, file=bytes, thumb=-1)
        except (TypeError, ValueError):
            return None
        return data or None


class _MessageChunks:
    """`ChunkSource` de uma mensagem; retoma sozinho se a referência do arquivo expirar."""

    def __init__(self, media: TelegramMedia, channel: ChannelRef, message_id: int) -> None:
        self.media = media
        self.channel = channel
        self.message_id = message_id

    async def iter_chunks(self, offset: int) -> AsyncIterator[bytes]:
        message = await self.media.message(self.channel, self.message_id)
        retried = False
        while True:
            try:
                size = int(message.file.size or 0)
                chunks = -(-(size - offset) // CHUNK_SIZE) if size else None
                async for block in self.media.client.iter_download(
                    message.media,
                    offset=offset,
                    request_size=CHUNK_SIZE,
                    limit=chunks,
                    file_size=size or None,
                ):
                    offset += len(block)
                    retried = False
                    yield bytes(block)  # o Telethon pode entregar memoryview
                return
            except errors.FileReferenceExpiredError:
                if retried:
                    raise
                retried = True
                message = await self.media.message(self.channel, self.message_id, refresh=True)
