"""Leitura e gravação de snapshots de canal em JSON.

O snapshot é o ponto de encontro entre a coleta (que fala com o Telegram) e a
indexação (que não fala). Guardar o snapshot permite reprocessar o mesmo canal
quantas vezes for preciso enquanto as regras evoluem, sem novas requisições.
"""

from __future__ import annotations

import json
from pathlib import Path

from .models import ChannelSnapshot


def save_snapshot(snapshot: ChannelSnapshot, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(snapshot.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def load_snapshot(path: Path) -> ChannelSnapshot:
    return ChannelSnapshot.from_dict(json.loads(path.read_text(encoding="utf-8")))
