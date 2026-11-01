"""Interpretação do cabeçalho HTTP `Range` (só o primeiro intervalo, em bytes)."""

from __future__ import annotations

import re
from dataclasses import dataclass

_RANGE = re.compile(r"^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$")


class RangeNotSatisfiable(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ByteRange:
    start: int
    end: int  # inclusivo

    @property
    def length(self) -> int:
        return self.end - self.start + 1


def parse_range(header: str | None, size: int, *, window: int | None = None) -> ByteRange | None:
    """Retorna o intervalo pedido, `None` se não houver (ou for inválido) e
    `RangeNotSatisfiable` se estiver fora do arquivo.

    Pedidos abertos (`bytes=START-`) são limitados a `window` bytes: o player
    pede o restante quando precisar, e um salto no vídeo não fica esperando um
    download longo terminar.
    """
    if not header:
        return None
    first = header.split(",", 1)[0]
    match = _RANGE.match(first)
    if not match or (not match.group(1) and not match.group(2)):
        return None  # sintaxe inválida: a RFC 9110 manda ignorar o Range
    start_s, end_s = match.groups()
    if not start_s:  # bytes=-N (últimos N bytes)
        suffix = int(end_s)
        if suffix == 0 or size == 0:
            raise RangeNotSatisfiable(header)
        return ByteRange(max(size - suffix, 0), size - 1)
    start = int(start_s)
    if start >= size:
        raise RangeNotSatisfiable(header)
    if end_s:
        end = int(end_s)
        if end < start:
            return None
        end = min(end, size - 1)
    else:
        end = size - 1 if window is None else min(size - 1, start + window - 1)
    return ByteRange(start, end)
