"""Cache dos blocos de vídeo já baixados: memória (rápido) e disco (persistente).

O player pede o mesmo trecho mais de uma vez: o início, o fim do arquivo (onde
muitos MP4 guardam o índice), o início de novo, e volta a trechos já vistos ao
retroceder. Com os blocos guardados, nada disso volta ao Telegram.

- `ChunkCache`: LRU em memória, limitado por bytes.
- `DiskChunkCache`: LRU em `data/cache/`, limitado por bytes, sobrevive a
  reinícios (PLANO.md, 4.7). Leituras e gravações rodam fora do event loop.
"""

from __future__ import annotations

import asyncio
import os
from collections import OrderedDict
from pathlib import Path
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


class DiskChunkCache:
    """Chaves são caminhos relativos (`canal/mensagem/bloco`), só com dígitos e letras."""

    def __init__(self, directory: Path, max_bytes: int) -> None:
        self.directory = directory
        self.max_bytes = max_bytes
        self.size = 0
        self._index: OrderedDict[str, int] = OrderedDict()
        if max_bytes > 0 and directory.is_dir():
            self._scan()

    def _scan(self) -> None:
        files = []
        for path in self.directory.rglob("*.bin"):
            try:
                stat = path.stat()
            except OSError:
                continue
            files.append((stat.st_mtime, path, stat.st_size))
        for _, path, size in sorted(files):  # mais antigos primeiro (LRU)
            key = path.relative_to(self.directory).with_suffix("").as_posix()
            self._index[key] = size
            self.size += size
        self._evict()

    def _path(self, key: str) -> Path:
        return self.directory / f"{key}.bin"

    def __contains__(self, key: str) -> bool:
        return key in self._index

    async def get(self, key: str) -> bytes | None:
        if key not in self._index:
            return None
        try:
            data = await asyncio.to_thread(self._path(key).read_bytes)
        except OSError:
            self._forget(key)
            return None
        if key in self._index:
            self._index.move_to_end(key)
        return data

    async def put(self, key: str, data: bytes) -> None:
        if self.max_bytes <= 0 or len(data) > self.max_bytes or key in self._index:
            return
        try:
            await asyncio.to_thread(self._write, self._path(key), data)
        except OSError:
            return  # disco cheio ou sem permissão: segue só com a memória
        self._index[key] = len(data)
        self.size += len(data)
        self._evict()

    @staticmethod
    def _write(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{os.getpid()}.tmp")
        tmp.write_bytes(data)
        tmp.replace(path)

    def _forget(self, key: str) -> None:
        size = self._index.pop(key, None)
        if size is not None:
            self.size -= size

    def _evict(self) -> None:
        while self.size > self.max_bytes and self._index:
            key, _ = next(iter(self._index.items()))
            self._forget(key)
            try:
                self._path(key).unlink()
            except OSError:
                pass
