"""Estrutura final do curso produzida pela indexação.

É a proposta que, nas próximas etapas, será gravada em `modules`/`lessons`
(ver PLANO.md, seção 5). Cada aula guarda a referência original e a origem de
cada material, para rastreabilidade.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Iterator

from .models import MediaInfo
from .resolver import MatchReason


class Strategy(StrEnum):
    SUMMARY = "summary"
    FALLBACK = "fallback"


class TitleSource(StrEnum):
    CAPTION = "caption"
    FILE_NAME = "file_name"
    SUMMARY_LABEL = "summary_label"
    GENERATED = "generated"


@dataclass(slots=True)
class Material:
    message_id: int
    reason: MatchReason
    via: int | None = None
    grouped_id: int | None = None
    media: MediaInfo | None = None
    caption: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "message_id": self.message_id,
            "reason": self.reason.value,
            "via": self.via,
            "grouped_id": self.grouped_id,
            "media": self.media.to_dict() if self.media else None,
            "caption": self.caption,
        }


@dataclass(slots=True)
class Lesson:
    title: str
    title_source: TitleSource
    position: int  # ordem global de apresentação, a partir de 1
    ref: str | None = None
    ref_raw: str | None = None
    summary_location: str | None = None
    description: str = ""
    materials: list[Material] = field(default_factory=list)

    @property
    def resolved(self) -> bool:
        return bool(self.materials)

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "title_source": self.title_source.value,
            "position": self.position,
            "ref": self.ref,
            "ref_raw": self.ref_raw,
            "summary_location": self.summary_location,
            "resolved": self.resolved,
            "description": self.description,
            "materials": [m.to_dict() for m in self.materials],
        }


@dataclass(slots=True)
class CourseSection:
    title: str
    level: int
    implicit: bool = False
    location: str | None = None
    lessons: list[Lesson] = field(default_factory=list)
    children: list[CourseSection] = field(default_factory=list)

    def walk(self) -> Iterator[CourseSection]:
        yield self
        for child in self.children:
            yield from child.walk()

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "level": self.level,
            "implicit": self.implicit,
            "location": self.location,
            "lessons": [lesson.to_dict() for lesson in self.lessons],
            "children": [c.to_dict() for c in self.children],
        }


@dataclass(slots=True)
class CourseStructure:
    title: str
    strategy: Strategy
    sections: list[CourseSection] = field(default_factory=list)

    def walk(self) -> Iterator[CourseSection]:
        for section in self.sections:
            yield from section.walk()

    def lessons(self) -> list[Lesson]:
        return [lesson for section in self.walk() for lesson in section.lessons]

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "strategy": self.strategy.value,
            "sections": [s.to_dict() for s in self.sections],
        }
