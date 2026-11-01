"""Acesso aos arquivos das mensagens (vídeos, documentos e miniaturas).

Somente leitura. O vídeo é baixado do Telegram em blocos de 512 KiB, sob
demanda, e entregue ao player conforme ele pede (Range).

Para começar rápido e responder na hora a saltos e retrocessos:
- **paralelismo**: os blocos de um pedido são baixados vários ao mesmo tempo
  (cada pedido ao Telegram tem latência; em sequência, ela se soma);
- **leitura antecipada**: enquanto o vídeo toca, os próximos ~12 MB são
  baixados em segundo plano, com prioridade menor que os pedidos do player.
  Se a pessoa pula para outro trecho, a leitura antecipada do trecho antigo é
  abandonada;
- **cache em dois níveis**: memória e disco (`data/cache/`). Voltar a um
  trecho já visto, mesmo depois de reiniciar o servidor, não vai ao Telegram;
- **sem download duplicado**: um bloco que já está sendo baixado é aproveitado;
- **índice do MP4**: ao abrir um vídeo, o último bloco é buscado logo, porque
  o navegador vai pedi-lo em seguida.

A criptografia do Telegram (MTProto) roda em Python puro se o pacote
`cryptg` não estiver instalado, o que limita o download a poucas centenas de
KB/s e trava o servidor enquanto decifra. `cryptg` é dependência do projeto.
"""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator

from telethon import TelegramClient, errors, types

from ..streaming.cache import ChunkCache, DiskChunkCache
from ..streaming.streamer import CHUNK_SIZE

MESSAGE_TTL = 10 * 60  # a referência do arquivo expira; recarregamos de tempos em tempos
MESSAGE_CACHE_SIZE = 512
PARALLEL_CHUNKS = 4  # blocos baixados ao mesmo tempo para um pedido do player
READ_AHEAD_CHUNKS = 24  # ~12 MB à frente da posição que está tocando
FOREGROUND_DOWNLOADS = 8  # limite global de downloads simultâneos pedidos pelo player
BACKGROUND_DOWNLOADS = 4  # e de downloads antecipados
DEFAULT_CACHE_BYTES = 256 * 1024 * 1024


def fast_crypto_available() -> bool:
    try:
        import cryptg  # noqa: F401
    except ImportError:
        from telethon.crypto import libssl

        return bool(libssl.decrypt_ige)
    return True


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
        memory_cache: ChunkCache | None = None,
        disk_cache: DiskChunkCache | None = None,
        parallel: int = PARALLEL_CHUNKS,
        read_ahead: int = READ_AHEAD_CHUNKS,
    ) -> None:
        self.client = client
        self.parallel = max(1, parallel)
        self.read_ahead = max(0, read_ahead)
        # Os caches podem ser compartilhados entre usuários: antes de servir um
        # trecho, a rota confere com o cliente do próprio usuário se ele acessa a
        # mensagem (`message()`), então ninguém lê vídeo de canal em que não está.
        self._memory = memory_cache if memory_cache is not None else ChunkCache(cache_bytes)
        self._disk = disk_cache
        self._inflight: dict[tuple, asyncio.Future] = {}
        self._background: set[asyncio.Task] = set()
        self._playhead: dict[tuple, int] = {}  # vídeo -> último bloco entregue ao player
        self._foreground = asyncio.Semaphore(FOREGROUND_DOWNLOADS)
        self._background_slots = asyncio.Semaphore(BACKGROUND_DOWNLOADS)
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
                except errors.UnauthorizedError:
                    raise  # sessão revogada: quem chama pede para vincular de novo
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

    async def channel_photo(self, channel: ChannelRef) -> bytes | None:
        """Foto do canal (versão pequena do Telegram, 160 px). None se não houver."""
        peer = await self._peer(channel)
        try:
            data = await self.client.download_profile_photo(peer, file=bytes, download_big=False)
        except (TypeError, ValueError):
            return None
        return data or None


class _MessageChunks:
    """`ChunkSource` de uma mensagem (ver a docstring do módulo)."""

    def __init__(self, media: TelegramMedia, channel: ChannelRef, message_id: int) -> None:
        self.media = media
        self.channel = channel
        self.message_id = message_id
        self.video = (channel, message_id)
        channel_part = str(channel.channel_id) if channel.channel_id else f"u_{channel.username}"
        self._disk_prefix = f"{channel_part}/{message_id}"

    def _key(self, index: int) -> tuple:
        return (self.channel, self.message_id, index)

    def _disk_key(self, index: int) -> str:
        return f"{self._disk_prefix}/{index}"

    def _is_local(self, index: int) -> bool:
        key = self._key(index)
        disk = self.media._disk
        return (
            key in self.media._memory
            or key in self.media._inflight
            or (disk is not None and self._disk_key(index) in disk)
        )

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

    async def _load(self, index: int, slots: asyncio.Semaphore) -> bytes:
        """Disco ou Telegram; guarda o resultado na memória e no disco."""
        key = self._key(index)
        try:
            disk = self.media._disk
            data = await disk.get(self._disk_key(index)) if disk else None
            if data is None:
                async with slots:
                    data = await self._download(index)
                if disk and data:
                    await disk.put(self._disk_key(index), data)
            self.media._memory.put(key, data)
            return data
        finally:
            self.media._inflight.pop(key, None)

    def chunk(self, index: int) -> asyncio.Future:
        """Bloco pedido pelo player: memória, download em andamento ou novo (prioridade alta)."""
        key = self._key(index)
        loop = asyncio.get_running_loop()
        cached = self.media._memory.get(key)
        if cached is not None:
            future = loop.create_future()
            future.set_result(cached)
            return future
        inflight = self.media._inflight.get(key)
        if inflight is not None:
            return inflight
        task = loop.create_task(self._load(index, self.media._foreground))
        task.add_done_callback(_consume_error)
        self.media._inflight[key] = task
        return task

    def prefetch(self, index: int, *, keep: bool = False) -> None:
        """Baixa em segundo plano, com prioridade baixa. Sem `keep`, desiste se a
        reprodução já tiver ido para outro trecho quando chegar a vez do bloco."""
        if self._is_local(index):
            return

        async def run() -> None:
            async with self.media._background_slots:
                if not keep and not self._still_ahead(index):
                    return
                if self._is_local(index):
                    return
                key = self._key(index)
                future = asyncio.get_running_loop().create_future()
                self.media._inflight[key] = future
                try:
                    data = await self._load(index, _NO_LIMIT)
                except BaseException as exc:
                    future.set_exception(exc) if not isinstance(exc, asyncio.CancelledError) else future.cancel()
                    _consume_error(future)
                    raise
                future.set_result(data)

        task = asyncio.get_running_loop().create_task(run())
        self.media._background.add(task)  # mantém a referência até terminar
        task.add_done_callback(self.media._background.discard)
        task.add_done_callback(_consume_error)

    def _still_ahead(self, index: int) -> bool:
        head = self.media._playhead.get(self.video)
        return head is not None and head < index <= head + self.media.read_ahead + self.media.parallel

    async def iter_chunks(self, offset: int) -> AsyncIterator[bytes]:
        message = await self.media.message(self.channel, self.message_id)
        size = int(message.file.size or 0)
        last = (size - 1) // CHUNK_SIZE if size else None
        index = offset // CHUNK_SIZE
        if index == 0 and last:
            self.prefetch(last, keep=True)

        pending: list[asyncio.Future] = []
        next_index = index
        while True:
            while len(pending) < self.media.parallel and (last is None or next_index <= last):
                pending.append(self.chunk(next_index))
                next_index += 1
            if not pending:
                return
            current = next_index - len(pending)
            # shield: se o navegador desistir deste pedido (ex.: pulou para outro
            # trecho), os blocos em andamento terminam e ficam no cache.
            data = await asyncio.shield(pending.pop(0))
            if not data:
                return
            self._advance(current, last)
            yield data
            if len(data) < CHUNK_SIZE:
                return  # último bloco

    def _advance(self, index: int, last: int | None) -> None:
        head = self.media._playhead.get(self.video)
        window = self.media.read_ahead + self.media.parallel
        if last is not None and index >= last - 1 and head is not None and index - head > window:
            return  # leitura do índice no fim do arquivo: não é onde a pessoa está assistindo
        self.media._playhead[self.video] = index
        end = index + self.media.read_ahead
        if last is not None:
            end = min(end, last)
        for ahead in range(index + 1, end + 1):
            self.prefetch(ahead)


class _NoLimit:
    async def __aenter__(self) -> None:
        return None

    async def __aexit__(self, *exc) -> None:
        return None


_NO_LIMIT = _NoLimit()  # o download antecipado já ocupa uma vaga de segundo plano


def _consume_error(future: asyncio.Future) -> None:
    """Marca o erro como lido (quem aguarda o bloco recebe o erro normalmente)."""
    if not future.cancelled():
        future.exception()
