"""Visualização em texto do resultado (usada pela CLI)."""

from __future__ import annotations

from .pipeline import IndexingResult
from .structure import CourseSection, Lesson


def _size(value: int | None) -> str:
    if not value:
        return ""
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return ""


def _lesson_lines(lesson: Lesson, indent: str) -> list[str]:
    ref = f"[{lesson.ref}] " if lesson.ref else ""
    status = "" if lesson.resolved else "  !! NÃO RESOLVIDA"
    lines = [f"{indent}{lesson.position:>3}. {ref}{lesson.title}  ({lesson.title_source}){status}"]
    for material in lesson.materials:
        media = material.media
        kind = media.kind if media else "texto"
        name = (media.file_name if media else None) or ""
        how = material.reason.value + (f" via {material.via}" if material.via else "")
        album = f" álbum {material.grouped_id}" if material.grouped_id else ""
        lines.append(
            f"{indent}       - msg {material.message_id} {kind} {name} {_size(media.size if media else None)}"
            f" [{how}{album}]".replace("  ", " ")
        )
    return lines


def _section_lines(section: CourseSection, depth: int) -> list[str]:
    indent = "  " * depth
    marker = "=" * section.level
    implicit = " (implícita)" if section.implicit else ""
    lines = [f"{indent}{marker} {section.title}{implicit}"]
    for lesson in section.lessons:
        lines.extend(_lesson_lines(lesson, indent + "  "))
    for child in section.children:
        lines.extend(_section_lines(child, depth + 1))
    return lines


def render_text(result: IndexingResult) -> str:
    course, report = result.course, result.report
    out = [f"Curso: {course.title}", f"Estratégia: {course.strategy.value}"]
    if report.summary.message_ids:
        out.append(f"Sumário: mensagens {report.summary.message_ids} ({report.summary.parser})")
    if report.summary.fallback_reason:
        out.append(f"Fallback: {report.summary.fallback_reason}")
    out.append("")
    for section in course.sections:
        out.extend(_section_lines(section, 0))

    s = report.stats
    out += [
        "",
        "Resumo",
        f"  mensagens: {s.messages} (com mídia: {s.media_messages})",
        f"  aulas: {s.lessons} (resolvidas: {s.resolved_lessons}, não resolvidas: {s.unresolved_lessons})",
        f"  materiais associados: {s.materials}; mídias fora do curso: {s.orphan_media_messages}",
    ]

    def section(title: str, items: list[str]) -> None:
        if items:
            out.extend(["", f"{title} ({len(items)})", *(f"  - {i}" for i in items)])

    section("Avisos do sumário", report.summary.warnings)
    section(
        "Outros candidatos a sumário (descartados)",
        [f"mensagens {c['message_ids']} com {c['refs']} referências" for c in report.summary.discarded_candidates],
    )
    section("Referências não resolvidas", [f"{u.ref} em {u.location} ({u.section})" for u in report.unresolved])
    section(
        "Referências duplicadas no sumário",
        [f"{d.ref}: mantida em {d.kept_at}, ignorada em {', '.join(d.ignored_at)}" for d in report.duplicates_in_summary],
    )
    section(
        "Referências com várias mensagens",
        [f"{m.ref}: mensagens {m.message_ids}" for m in report.multi_message_refs],
    )
    section(
        "Mensagens usadas em mais de uma aula",
        [f"msg {m.message_id}: {', '.join(m.refs)}" for m in report.shared_messages],
    )
    section(
        "Identificadores no canal ausentes do sumário",
        [f"{k}: mensagens {v}" for k, v in report.refs_not_in_summary.items()],
    )
    section(
        "Materiais fora do curso",
        [
            f"mensagens {o.message_ids}"
            + (f" refs {o.refs}" if o.refs else "")
            + (f" — {o.caption.strip().splitlines()[0][:60]}" if o.caption.strip() else "")
            for o in report.orphans
        ],
    )
    return "\n".join(out)
