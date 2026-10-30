"""Acesso aos arquivos das mensagens (vídeos, documentos e miniaturas).

Somente leitura. Os vídeos não são gravados em disco: cada pedido do player
vira downloads parciais direto do Telegram.

Para o vídeo começar e responder rápido aos saltos:
- vários blocos são baixados ao mesmo tempo, à frente da posição pedida
  (cada pedido ao Telegram tem latência; em sequência, ela se soma);
- blocos recentes ficam num cache em memória, e um bloco que já está sendo
  baixado por outro pedido é aproveitado em vez de baixado de novo;
- ao abrir um vídeo, o último bloco (onde muitos MP4 guardam o índice) é
  buscado em segundo plano, porque o navegador vai pedi-lo logo em seguida.
"""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import AsyncIterator

from telethon import TelegramClient, errors, types

from ..streaming.cache import ChunkCache
from ..streaming.streamer import CHUNK_SIZE

MESSAGE_TTL = 10 * 60  # a referência do arquivo expira; recarregamos de tempos em tempos
MESSAGE_CACHE_SIZE = 512
PARALLEL_CHUNKS = 4  # blocos baixados ao mesmo tempo por vídeo em reprodução
DEFAULT_CACHE_BYTES = 256 * 1024 * 1024


class MediaUnavailable(LookupError):
    """A mensagem foi apagada, não tem arquivo ou o canal não está acessível."""


@dataclass(frozen=True, slots=True)
class ChannelRef:
    channel_id: int | None
    username: str | None = None


class TelegramMedia:
    def __init__(
        self,
        client: TelegramClient,
        *,
        cache_bytes: int = DEFAULT_CACHE_BYTES,
        parallel: int = PARALLEL_CHUNKS,
    ) -> None:
        self.client = client
        self.parallel = max(1, parallel)
        self._chunks = ChunkCache(cache_bytes)
        self._inflight: dict[tuple, asyncio.Future] = {}
        self._background: set[asyncio.Task] = set()
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
    """`ChunkSource` de uma mensagem: blocos em paralelo, com cache e retomada
    automática se a referência do arquivo expirar."""

    def __init__(self, media: TelegramMedia, channel: ChannelRef, message_id: int) -> None:
        self.media = media
        self.channel = channel
        self.message_id = message_id

    def _key(self, index: int) -> tuple:
        return (self.channel, self.message_id, index)

    async def _download(self, index: int) -> bytes:
        refreshed = False
        while True:
            message = await self.media.message(self.channel, self.message_id, refresh=refreshed)
            try:
                parts = [
                    bytes(block)
                    async for block in self.media.client.iter_download(
                        message.media,
                        offset=index * CHUNK_SIZE,
                        request_size=CHUNK_SIZE,
                        limit=1,
                        file_size=message.file.size or None,
                    )
                ]
                return b"".join(parts)
            except errors.FileReferenceExpiredError:
                if refreshed:
                    raise
                refreshed = True

    def chunk(self, index: int) -> asyncio.Future:
        """Bloco `index`: do cache, de um download em andamento ou de um novo."""
        key = self._key(index)
        loop = asyncio.get_running_loop()
        cached = self.media._chunks.get(key)
        if cached is not None:
            future = loop.create_future()
            future.set_result(cached)
            return future
        inflight = self.media._inflight.get(key)
        if inflight is not None:
            return inflight

        async def run() -> bytes:
            try:
                data = await self._download(index)
                self.media._chunks.put(key, data)
                return data
            finally:
                self.media._inflight.pop(key, None)

        task = loop.create_task(run())
        # Lê o erro mesmo se ninguém aguardar o bloco (quem aguarda recebe o erro normalmente).
        task.add_done_callback(lambda t: t.cancelled() or t.exception())
        self.media._inflight[key] = task
        return task

    def prefetch(self, index: int) -> None:
        if self._key(index) in self.media._chunks or self._key(index) in self.media._inflight:
            return
        task = self.chunk(index)
        self.media._background.add(task)  # mantém a referência até terminar
        task.add_done_callback(self.media._background.discard)

    async def iter_chunks(self, offset: int) -> AsyncIterator[bytes]:
        message = await self.media.message(self.channel, self.message_id)
        size = int(message.file.size or 0)
        last = (size - 1) // CHUNK_SIZE if size else None
        index = offset // CHUNK_SIZE
        if index == 0 and last:
            self.prefetch(last)

        pending: list[asyncio.Future] = []
        next_index = index
        while True:
            while len(pending) < self.media.parallel and (last is None or next_index <= last):
                pending.append(self.chunk(next_index))
                next_index += 1
            if not pending:
                return
            # shield: se o navegador desistir deste pedido (ex.: pulou para outro
            # trecho), os blocos em andamento terminam e ficam no cache. São no
            # máximo `parallel` blocos, e outro pedido pode estar esperando por eles.
            data = await asyncio.shield(pending.pop(0))
            if not data:
                return
            yield data
            if len(data) < CHUNK_SIZE:
                return  # último bloco
