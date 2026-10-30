import asyncio
from types import SimpleNamespace

import pytest
from telethon import errors

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
        for start in range(offset, SIZE, request_size):
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
    client = FakeClient(expire_after=2)
    media = TelegramMedia(client)
    assert read(media, 0, SIZE - 1) == DATA
    # Recarregou a mensagem e continuou do ponto em que parou, sem repetir bytes.
    assert client.fetches == 2
    assert client.download_offsets == [0, 2 * CHUNK_SIZE]


def test_deleted_message_is_unavailable():
    with pytest.raises(MediaUnavailable):
        asyncio.run(TelegramMedia(FakeClient()).message(ChannelRef(1), 8))
