"""Cache em memória dos blocos baixados (LRU limitado por bytes).

O player pede o mesmo trecho mais de uma vez: o início, depois o fim do
arquivo (onde costuma ficar o índice do MP4), depois o início de novo, e
volta a trechos já vistos ao pular no vídeo. Guardar os blocos recentes evita
baixar tudo de novo do Telegram.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Hashable


class ChunkCache:
    def __init__(self, max_bytes: int) -> None:
        self.max_bytes = max_bytes
        self.size = 0
        self._items: OrderedDict[Hashable, bytes] = OrderedDict()

    def get(self, key: Hashable) -> bytes | None:
        data = self._items.get(key)
        if data is not None:
            self._items.move_to_end(key)
        return data

    def put(self, key: Hashable, data: bytes) -> None:
        if self.max_bytes <= 0 or len(data) > self.max_bytes:
            return
        old = self._items.pop(key, None)
        if old is not None:
            self.size -= len(old)
        self._items[key] = data
        self.size += len(data)
        while self.size > self.max_bytes:
            _, dropped = self._items.popitem(last=False)
            self.size -= len(dropped)

    def __contains__(self, key: Hashable) -> bool:
        return key in self._items
