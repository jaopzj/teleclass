"""Relatório de inspeção da indexação.

Responde às perguntas do piloto: qual sumário foi usado, quais referências não
foram encontradas, onde há duplicações, quais materiais ficaram de fora e como
cada material foi associado à sua aula (este último fica em cada `Material`).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class SummaryInfo:
    parser: str | None = None
    message_ids: list[int] = field(default_factory=list)
    discarded_candidates: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    fallback_reason: str | None = None


@dataclass(slots=True)
class UnresolvedRef:
    ref: str
    location: str | None
    section: str


@dataclass(slots=True)
class DuplicateRef:
    ref: str
    kept_at: str | None
    ignored_at: list[str]


@dataclass(slots=True)
class MultiMessageRef:
    """Uma referência encontrada em várias mensagens fora de um mesmo álbum.

    É esperado quando a aula tem vários materiais (vídeo + PDF, por exemplo),
    mas também pode indicar uma reutilização acidental do identificador.
    """

    ref: str
    message_ids: list[int]


@dataclass(slots=True)
class SharedMessage:
    message_id: int
    refs: list[str]


@dataclass(slots=True)
class OrphanMaterial:
    message_ids: list[int]
    grouped_id: int | None
    refs: list[str]
    caption: str


@dataclass(slots=True)
class Stats:
    messages: int = 0
    media_messages: int = 0
    lessons: int = 0
    resolved_lessons: int = 0
    unresolved_lessons: int = 0
    materials: int = 0
    orphan_media_messages: int = 0


@dataclass(slots=True)
class IndexingReport:
    summary: SummaryInfo = field(default_factory=SummaryInfo)
    stats: Stats = field(default_factory=Stats)
    unresolved: list[UnresolvedRef] = field(default_factory=list)
    duplicates_in_summary: list[DuplicateRef] = field(default_factory=list)
    multi_message_refs: list[MultiMessageRef] = field(default_factory=list)
    shared_messages: list[SharedMessage] = field(default_factory=list)
    refs_not_in_summary: dict[str, list[int]] = field(default_factory=dict)
    orphans: list[OrphanMaterial] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
