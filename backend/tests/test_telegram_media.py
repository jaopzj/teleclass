import asyncio
from types import SimpleNamespace

import pytest
from telethon import errors

from app.streaming.cache import DiskChunkCache
from app.streaming.range import ByteRange
from app.streaming.streamer import CHUNK_SIZE, stream_range
from app.telegram.media import ChannelRef, MediaUnavailable, TelegramMedia

SIZE = CHUNK_SIZE * 4 + 100
DATA = bytes(i % 253 for i in range(SIZE))


class FakeClient:
    """Cliente Telethon falso: a referência do arquivo expira uma vez no meio do download."""

    def __init__(self, expire_after: int | None = None):
        self.expire_after = expire_after
        self.fetches = 0
        self.download_offsets: list[int] = []

    async def get_input_entity(self, peer):
        return "peer"

    async def get_dialogs(self):
        return []

    async def get_messages(self, peer, ids):
        self.fetches += 1
        if ids != 7:
            return None
        return SimpleNamespace(id=7, media="media", file=SimpleNamespace(size=SIZE))

    async def iter_download(self, media, *, offset, request_size, limit, file_size):
        assert offset % request_size == 0
        self.download_offsets.append(offset)
        sent = 0
        for start in range(offset, SIZE, request_size)[: limit]:
            if self.expire_after is not None and sent == self.expire_after:
                self.expire_after = None
                raise errors.FileReferenceExpiredError(request=None)
            sent += 1
            yield memoryview(DATA[start : start + request_size])


def read(media, start, end):
    async def run():
        source = media.chunks(ChannelRef(1), 7)
        return b"".join([b async for b in stream_range(source, ByteRange(start, end))])

    return asyncio.run(run())


def test_streams_exact_bytes_from_telegram():
    client = FakeClient()
    assert read(TelegramMedia(client), 100, CHUNK_SIZE * 2 + 50) == DATA[100 : CHUNK_SIZE * 2 + 51]


def test_resumes_after_file_reference_expired():
    client = FakeClient(expire_after=0)
    media = TelegramMedia(client)
    assert read(media, 0, SIZE - 1) == DATA
    assert client.fetches == 2  # recarregou a mensagem uma vez


async def _read(media, start, end):
    source = media.chunks(ChannelRef(1), 7)
    return b"".join([b async for b in stream_range(source, ByteRange(start, end))])


async def _settle(media):
    while media._background or media._inflight:
        await asyncio.sleep(0.01)


def test_parallel_read_ahead_and_memory_cache():
    async def run():
        client = FakeClient()
        media = TelegramMedia(client, parallel=2, read_ahead=2)
        assert await _read(media, CHUNK_SIZE + 5, CHUNK_SIZE + 10) == DATA[CHUNK_SIZE + 5 : CHUNK_SIZE + 11]
        await _settle(media)
        # Bloco 1 (pedido), 2 (paralelo) e 3 (leitura antecipada).
        assert sorted(client.download_offsets) == [CHUNK_SIZE, 2 * CHUNK_SIZE, 3 * CHUNK_SIZE]

        client.download_offsets.clear()
        assert await _read(media, CHUNK_SIZE, 3 * CHUNK_SIZE + 99) == DATA[CHUNK_SIZE : 3 * CHUNK_SIZE + 100]
        await _settle(media)
        assert all(o > 3 * CHUNK_SIZE for o in client.download_offsets)  # 1 a 3 vieram da memória

    asyncio.run(run())


def test_disk_cache_survives_restart(tmp_path):
    async def run():
        first = FakeClient()
        media = TelegramMedia(first, disk_cache=DiskChunkCache(tmp_path, 10 * CHUNK_SIZE), read_ahead=0)
        assert await _read(media, 0, SIZE - 1) == DATA
        await _settle(media)

        # "Reinicia o servidor": memória vazia, disco reaproveitado.
        second = FakeClient()
        media = TelegramMedia(second, disk_cache=DiskChunkCache(tmp_path, 10 * CHUNK_SIZE), read_ahead=0)
        assert await _read(media, 100, SIZE - 1) == DATA[100:]
        assert second.download_offsets == []

    asyncio.run(run())


def test_seeking_abandons_stale_read_ahead():
    async def run():
        client = FakeClient()
        media = TelegramMedia(client, parallel=1, read_ahead=3)
        media._background_slots = asyncio.Semaphore(0)  # segura a leitura antecipada
        await _read(media, 0, 10)
        assert len(media._background) >= 3
        await _read(media, 3 * CHUNK_SIZE, 3 * CHUNK_SIZE + 10)  # pulou para frente
        client.download_offsets.clear()
        for _ in range(10):
            media._background_slots.release()
        await _settle(media)
        # Os blocos 1 e 2 ficaram para trás e não foram baixados; o 4 (à frente) foi.
        assert CHUNK_SIZE not in client.download_offsets
        assert 2 * CHUNK_SIZE not in client.download_offsets
        assert 4 * CHUNK_SIZE in client.download_offsets

    asyncio.run(run())


def test_opening_a_video_prefetches_the_last_chunk():
    async def run():
        client = FakeClient()
        media = TelegramMedia(client, parallel=1, read_ahead=0)
        await _read(media, 0, 10)
        await _settle(media)
        assert 4 * CHUNK_SIZE in client.download_offsets

    asyncio.run(run())


def test_memory_cache_is_bounded():
    client = FakeClient()
    media = TelegramMedia(client, cache_bytes=CHUNK_SIZE * 2, parallel=1, read_ahead=0)
    read(media, 0, SIZE - 1)
    assert media._memory.size <= CHUNK_SIZE * 2


def test_disk_cache_evicts_oldest(tmp_path):
    async def run():
        cache = DiskChunkCache(tmp_path, 25)
        for i in range(4):
            await cache.put(f"1/7/{i}", bytes(10))
        assert cache.size <= 25 and "1/7/0" not in cache and "1/7/3" in cache
        assert await cache.get("1/7/3") == bytes(10)
        assert DiskChunkCache(tmp_path, 25).size == cache.size  # reconstruído do disco

    asyncio.run(run())
