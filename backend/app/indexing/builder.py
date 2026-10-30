"""Montagem da estrutura do curso.

`build_from_outline` segue o sumário: a ordem de seções e aulas é a do
sumário, nunca a data das mensagens. `build_fallback` só é usado quando não há
sumário confiável: um módulo "Aulas" em ordem cronológica, com um item por
mensagem de mídia (álbuns viram uma única aula).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from .metadata import extract_metadata
from .models import SourceMessage
from .outline import Outline, RefEntry, Section
from .refs import RefExtractor
from .resolver import MatchReason, MessageIndex, Resolution
from .structure import (
    CourseSection,
    CourseStructure,
    Lesson,
    Material,
    Strategy,
    TitleSource,
)


@dataclass(slots=True)
class BuildResult:
    course: CourseStructure
    resolutions: dict[str, Resolution] = field(default_factory=dict)
    duplicates: dict[str, list[RefEntry]] = field(default_factory=dict)
    first_occurrence: dict[str, RefEntry] = field(default_factory=dict)


class _LessonFactory:
    def __init__(self, index: MessageIndex, refs: RefExtractor) -> None:
        self.index = index
        self.refs = refs
        self.position = 0

    def materials_for(self, resolution: Resolution) -> list[Material]:
        return [self.material(m.message_id, m.reason, m.via) for m in resolution.matches]

    def material(self, message_id: int, reason: MatchReason, via: int | None) -> Material:
        message = self.index.messages[message_id]
        return Material(
            message_id=message.id,
            reason=reason,
            via=via,
            grouped_id=message.grouped_id,
            media=message.media,
            caption=message.text,
        )

    def lesson(
        self,
        materials: list[Material],
        *,
        ref: RefEntry | None = None,
    ) -> Lesson:
        self.position += 1
        # Mensagens que motivaram a associação primeiro: são elas que carregam a legenda.
        ordered = sorted(materials, key=lambda m: (m.reason is MatchReason.ALBUM, m.message_id))
        messages = [self.index.messages[m.message_id] for m in ordered]
        meta = extract_metadata(
            messages, self.refs, position=self.position, summary_label=ref.label if ref else None
        )
        title, source = meta.title, meta.title_source
        if not materials and ref and source is TitleSource.GENERATED:
            title = f"#{ref.raw}"
        return Lesson(
            title=title,
            title_source=source,
            position=self.position,
            ref=ref.key if ref else None,
            ref_raw=ref.raw if ref else None,
            summary_location=str(ref.location) if ref else None,
            description=meta.description,
            materials=materials,
        )


def build_from_outline(
    outline: Outline,
    index: MessageIndex,
    refs: RefExtractor,
    *,
    title: str,
) -> BuildResult:
    factory = _LessonFactory(index, refs)
    result = BuildResult(CourseStructure(title=title, strategy=Strategy.SUMMARY))

    def convert(section: Section) -> CourseSection:
        node = CourseSection(
            title=section.title,
            level=section.level,
            implicit=section.implicit,
            location=str(section.location) if section.location else None,
        )
        for entry in section.refs:
            if entry.key in result.first_occurrence:
                result.duplicates.setdefault(entry.key, []).append(entry)
                continue
            result.first_occurrence[entry.key] = entry
            resolution = index.resolve(entry.key)
            result.resolutions[entry.key] = resolution
            node.lessons.append(factory.lesson(factory.materials_for(resolution), ref=entry))
        node.children = [convert(child) for child in section.children]
        return node

    result.course.sections = [convert(section) for section in outline.sections]
    return result


def build_fallback(
    messages: Sequence[SourceMessage],
    index: MessageIndex,
    refs: RefExtractor,
    *,
    title: str,
) -> BuildResult:
    factory = _LessonFactory(index, refs)
    module = CourseSection(title="Aulas", level=1)
    seen_albums: set[int] = set()
    for message in messages:
        if not message.has_media or message.id not in index.messages:
            continue
        if message.grouped_id is not None:
            if message.grouped_id in seen_albums:
                continue
            seen_albums.add(message.grouped_id)
        ids = index.album_of(message.id)
        materials = [
            factory.material(
                i,
                MatchReason.CHRONOLOGICAL if i == ids[0] else MatchReason.ALBUM,
                None if i == ids[0] else ids[0],
            )
            for i in ids
        ]
        lesson = factory.lesson(materials)
        keys = index.keys_by_message.get(message.id, [])
        if keys:
            lesson.ref = keys[0]
            lesson.ref_raw = keys[0]
        module.lessons.append(lesson)
    course = CourseStructure(title=title, strategy=Strategy.FALLBACK, sections=[module])
    return BuildResult(course)
