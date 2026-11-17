"""Contrato dos layouts de canal.

Um layout é uma forma de organizar o curso no canal (onde fica o sumário, como
as mídias se ligam às aulas). Cada layout sabe se reconhecer (`detect`) e montar
o curso (`index`). Novos formatos de canal são novos layouts registrados em
`DEFAULT_LAYOUTS`; os existentes não mudam.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol

from ..models import ChannelSnapshot

if TYPE_CHECKING:
    from ..pipeline import IndexingOptions, IndexingResult


@dataclass(frozen=True, slots=True)
class LayoutMatch:
    """Quanto o canal parece seguir um layout.

    `score` vai de 0 a 1. `accepted` diz se o layout passou nos critérios
    mínimos para ser usado; `evidence` explica o resultado (vai para o relatório).
    """

    score: float
    accepted: bool
    evidence: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def rejected(cls, **evidence: Any) -> LayoutMatch:
        return cls(0.0, False, evidence)


class ChannelLayout(Protocol):
    name: str

    def detect(self, snapshot: ChannelSnapshot) -> LayoutMatch: ...

    def index(self, snapshot: ChannelSnapshot, options: IndexingOptions) -> IndexingResult: ...
