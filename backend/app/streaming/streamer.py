"""Gera os bytes de um intervalo a partir de uma fonte que entrega blocos alinhados.

O Telegram só aceita downloads que começam em offsets alinhados. A fonte
entrega blocos de `CHUNK_SIZE` a partir de um offset múltiplo de `CHUNK_SIZE`,
e aqui os bytes excedentes do primeiro e do último bloco são descartados.
"""

from __future__ import annotations

from typing import AsyncIterator, Protocol

from .range import ByteRange

# Maior bloco que o Telegram entrega por requisição (upload.getFile).
CHUNK_SIZE = 512 * 1024


class ChunkSource(Protocol):
    def iter_chunks(self, offset: int) -> AsyncIterator[bytes]:
        """Blocos consecutivos a partir de `offset` (múltiplo de `CHUNK_SIZE`)."""
        ...


async def stream_range(source: ChunkSource, byte_range: ByteRange) -> AsyncIterator[bytes]:
    offset = byte_range.start - byte_range.start % CHUNK_SIZE
    skip = byte_range.start - offset
    remaining = byte_range.length
    chunks = source.iter_chunks(offset)
    try:
        async for block in chunks:
            if skip:
                block = block[skip:]
                skip = 0
            if len(block) > remaining:
                block = block[:remaining]
            if block:
                remaining -= len(block)
                yield block
            if remaining <= 0:
                break
    finally:
        aclose = getattr(chunks, "aclose", None)
        if aclose:
            await aclose()
