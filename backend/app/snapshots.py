"""Repositório de snapshots em `data/snapshots/` (um JSON por canal)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .indexing.models import ChannelSnapshot
from .indexing.storage import load_snapshot, save_snapshot

_NAME = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


class SnapshotNotFound(LookupError):
    pass


@dataclass(frozen=True, slots=True)
class SnapshotInfo:
    name: str
    title: str | None
    channel_id: int | None
    messages: int
    modified_at: datetime


class SnapshotStore:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def _path(self, name: str) -> Path:
        # Nomes restritos impedem acesso a arquivos fora da pasta.
        if not _NAME.match(name):
            raise SnapshotNotFound(name)
        return self.directory / f"{name}.json"

    @staticmethod
    def name_for(snapshot: ChannelSnapshot) -> str:
        base = snapshot.username or (f"c{snapshot.channel_id}" if snapshot.channel_id else "canal")
        return re.sub(r"[^A-Za-z0-9_-]", "_", base)[:80]

    def save(self, snapshot: ChannelSnapshot, name: str | None = None) -> str:
        name = name or self.name_for(snapshot)
        save_snapshot(snapshot, self._path(name))
        return name

    def load(self, name: str) -> ChannelSnapshot:
        path = self._path(name)
        if not path.is_file():
            raise SnapshotNotFound(name)
        return load_snapshot(path)

    def list(self) -> list[SnapshotInfo]:
        if not self.directory.is_dir():
            return []
        items = []
        for path in sorted(self.directory.glob("*.json")):
            if not _NAME.match(path.stem):
                continue
            snapshot = load_snapshot(path)
            items.append(
                SnapshotInfo(
                    name=path.stem,
                    title=snapshot.title,
                    channel_id=snapshot.channel_id,
                    messages=len(snapshot.messages),
                    modified_at=datetime.fromtimestamp(path.stat().st_mtime, timezone.utc),
                )
            )
        return items
