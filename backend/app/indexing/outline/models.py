"""Representação normalizada de um sumário, sem nada específico do Telegram."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterator


@dataclass(frozen=True, slots=True)
class OutlineSource:
    """Um trecho de texto do sumário. `source_id` identifica a origem (ex.: id da mensagem)."""

    source_id: str
    text: str


@dataclass(frozen=True, slots=True)
class Location:
    source_id: str
    line: int  # 1-based, dentro do texto da origem

    def __str__(self) -> str:
        return f"{self.source_id}:{self.line}"


@dataclass(frozen=True, slots=True)
class RefEntry:
    """Uma referência citada no sumário (ex.: `#A001`)."""

    key: str
    raw: str
    location: Location
    label: str | None = None  # texto que acompanhava a referência na mesma linha

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "raw": self.raw,
            "label": self.label,
            "location": str(self.location),
        }


@dataclass(slots=True)
class Section:
    """Um nó da hierarquia. `level` 1 é módulo, 2 é subtópico, e assim por diante.

    `implicit` marca seções criadas pelo parser para acomodar referências que
    apareceram antes de qualquer título.
    """

    title: str
    level: int
    location: Location | None
    refs: list[RefEntry] = field(default_factory=list)
    children: list[Section] = field(default_factory=list)
    implicit: bool = False

    def walk(self) -> Iterator[Section]:
        yield self
        for child in self.children:
            yield from child.walk()

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "level": self.level,
            "implicit": self.implicit,
            "location": str(self.location) if self.location else None,
            "refs": [r.to_dict() for r in self.refs],
            "children": [c.to_dict() for c in self.children],
        }


@dataclass(slots=True)
class Outline:
    format: str
    sections: list[Section] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def walk(self) -> Iterator[Section]:
        for section in self.sections:
            yield from section.walk()

    def all_refs(self) -> list[RefEntry]:
        return [ref for section in self.walk() for ref in section.refs]

    @property
    def is_empty(self) -> bool:
        return not self.all_refs()

    def to_dict(self) -> dict[str, Any]:
        return {
            "format": self.format,
            "sections": [s.to_dict() for s in self.sections],
            "warnings": list(self.warnings),
        }
