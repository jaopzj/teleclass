import asyncio

import pytest

from app.streaming.range import ByteRange, RangeNotSatisfiable, parse_range
from app.streaming.streamer import CHUNK_SIZE, stream_range

SIZE = CHUNK_SIZE * 3 + 1234
DATA = bytes(i % 251 for i in range(SIZE))


class FakeSource:
    """Imita o Telegram: só aceita offsets alinhados e entrega blocos de CHUNK_SIZE."""

    def __init__(self) -> None:
        self.offsets: list[int] = []

    async def iter_chunks(self, offset: int):
        assert offset % CHUNK_SIZE == 0
        self.offsets.append(offset)
        for start in range(offset, SIZE, CHUNK_SIZE):
            yield DATA[start : start + CHUNK_SIZE]


async def collect(byte_range: ByteRange) -> bytes:
    return b"".join([block async for block in stream_range(FakeSource(), byte_range)])


@pytest.mark.parametrize(
    "start,end",
    [(0, 0), (0, SIZE - 1), (10, 20), (CHUNK_SIZE - 1, CHUNK_SIZE), (CHUNK_SIZE, CHUNK_SIZE * 2 - 1),
     (CHUNK_SIZE * 3, SIZE - 1), (SIZE - 1, SIZE - 1), (777, CHUNK_SIZE * 2 + 5)],
)
def test_stream_returns_exact_bytes(start, end):
    assert asyncio.run(collect(ByteRange(start, end))) == DATA[start : end + 1]


def test_stream_starts_at_aligned_offset():
    source = FakeSource()

    async def run():
        return [b async for b in stream_range(source, ByteRange(CHUNK_SIZE + 5, CHUNK_SIZE + 10))]

    asyncio.run(run())
    assert source.offsets == [CHUNK_SIZE]


def test_parse_range():
    assert parse_range(None, 100) is None
    assert parse_range("bytes=0-", 100) == ByteRange(0, 99)
    assert parse_range("bytes=10-20", 100) == ByteRange(10, 20)
    assert parse_range("bytes=90-500", 100) == ByteRange(90, 99)
    assert parse_range("bytes=-10", 100) == ByteRange(90, 99)
    assert parse_range("bytes=0-", 100, window=30) == ByteRange(0, 29)
    assert parse_range("bytes=0-50", 100, window=30) == ByteRange(0, 50)  # fim explícito é respeitado
    assert parse_range("bytes=5-1", 100) is None
    assert parse_range("items=0-1", 100) is None
    with pytest.raises(RangeNotSatisfiable):
        parse_range("bytes=100-", 100)
