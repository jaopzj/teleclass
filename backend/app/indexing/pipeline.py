"""Orquestra as etapas da indexação e monta o relatório de inspeção."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence

from .metadata import clean_caption
from .builder import BuildResult, build_fallback, build_from_outline
from .models import ChannelSnapshot
from .outline import DEFAULT_PARSERS, Outline, OutlineParser
from .refs import RefExtractor
from .report import (
    DuplicateRef,
    IndexingReport,
    MultiMessageRef,
    OrphanMaterial,
    SharedMessage,
    UnresolvedRef,
)
from .resolver import MessageIndex
from .structure import CourseStructure, Strategy
from .summary import SummaryDetection, detect_summary


@dataclass(frozen=True, slots=True)
class IndexingOptions:
    max_summary_gap: int = 2
    parsers: Sequence[OutlineParser] = field(default_factory=lambda: DEFAULT_PARSERS)
    refs: RefExtractor = field(default_factory=RefExtractor)


@dataclass(slots=True)
class IndexingResult:
    course: CourseStructure
    report: IndexingReport
    outline: Outline | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "course": self.course.to_dict(),
            "report": self.report.to_dict(),
            "outline": self.outline.to_dict() if self.outline else None,
        }


def index_snapshot(
    snapshot: ChannelSnapshot, options: IndexingOptions | None = None
) -> IndexingResult:
    options = options or IndexingOptions()
    messages = snapshot.messages
    title = snapshot.title or "Curso sem título"
    report = IndexingReport()

    detection = detect_summary(messages, options.parsers, max_gap=options.max_summary_gap)
    _fill_summary_info(report, detection)

    outline: Outline | None = None
    summary_ids: list[int] = []
    if detection.chosen:
        summary_ids = detection.chosen.message_ids
        outline = detection.chosen.parser.parse(detection.chosen.sources())
        report.summary.warnings.extend(outline.warnings)

    index = MessageIndex(messages, options.refs, exclude_ids=summary_ids)

    if outline is not None and not outline.is_empty:
        build = build_from_outline(outline, index, options.refs, title=title)
    else:
        report.summary.fallback_reason = (
            "nenhum sumário encontrado" if outline is None else "sumário sem referências"
        )
        build = build_fallback(messages, index, options.refs, title=title)

    _fill_findings(report, build, index, options.refs, total_messages=len(messages))
    return IndexingResult(course=build.course, report=report, outline=outline)


def _fill_summary_info(report: IndexingReport, detection: SummaryDetection) -> None:
    if detection.chosen:
        report.summary.parser = detection.chosen.parser.name
        report.summary.message_ids = detection.chosen.message_ids
    report.summary.discarded_candidates = [
        {"parser": b.parser.name, "message_ids": b.message_ids, "refs": b.ref_count}
        for b in detection.discarded
    ]


def _fill_findings(
    report: IndexingReport,
    build: BuildResult,
    index: MessageIndex,
    refs: RefExtractor,
    *,
    total_messages: int,
) -> None:
    course = build.course
    used: dict[int, list[str]] = {}

    for section in course.walk():
        for lesson in section.lessons:
            if not lesson.resolved and lesson.ref:
                report.unresolved.append(
                    UnresolvedRef(lesson.ref, lesson.summary_location, section.title)
                )
            for material in lesson.materials:
                used.setdefault(material.message_id, []).append(lesson.ref or f"#{lesson.position}")

    for key, entries in build.duplicates.items():
        first = build.first_occurrence[key]
        report.duplicates_in_summary.append(
            DuplicateRef(key, str(first.location), [str(e.location) for e in entries])
        )

    for key, resolution in build.resolutions.items():
        groups = {index.messages[i].grouped_id or -i for i in resolution.tagged_ids}
        if len(groups) > 1:
            report.multi_message_refs.append(MultiMessageRef(key, resolution.tagged_ids))

    report.shared_messages = [
        SharedMessage(message_id, refs) for message_id, refs in used.items() if len(refs) > 1
    ]

    summary_keys = set(build.first_occurrence)
    if course.strategy is Strategy.SUMMARY:
        report.refs_not_in_summary = {
            key: ids for key, ids in index.by_key.items() if key not in summary_keys
        }

    seen_albums: set[int] = set()
    for message in index.messages.values():
        if not message.has_media or message.id in used:
            continue
        if message.grouped_id is not None:
            if message.grouped_id in seen_albums:
                continue
            seen_albums.add(message.grouped_id)
        ids = [i for i in index.album_of(message.id) if i not in used]
        keys = sorted({k for i in ids for k in index.keys_by_message.get(i, [])})
        captions = (clean_caption(index.messages[i].text, refs) for i in ids)
        caption = next((c for c in captions if c), "")
        report.orphans.append(OrphanMaterial(ids, message.grouped_id, keys, caption))

    stats = report.stats
    stats.messages = total_messages
    stats.media_messages = sum(1 for m in index.messages.values() if m.has_media)
    lessons = course.lessons()
    stats.lessons = len(lessons)
    stats.resolved_lessons = sum(1 for lesson in lessons if lesson.resolved)
    stats.unresolved_lessons = stats.lessons - stats.resolved_lessons
    stats.materials = sum(len(lesson.materials) for lesson in lessons)
    stats.orphan_media_messages = sum(
        1 for o in report.orphans for i in o.message_ids if index.messages[i].has_media
    )
