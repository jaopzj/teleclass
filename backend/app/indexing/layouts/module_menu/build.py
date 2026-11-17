"""Do resultado da varredura para `CourseStructure`, relatório e sumário.

- menu `#I01` -> módulo (nível 1), na ordem da primeira aparição;
- aula com 1 vídeo e sem materiais -> uma aula, com o título do menu;
- aula com 2+ vídeos, ou vídeo + materiais -> subtópico (nível 2) com uma
  aula por vídeo e, no fim, uma aula "Materiais de apoio";
- só materiais -> uma aula de arquivos; só o cabeçalho -> aula de texto;
- listada no menu e ausente do canal -> aula sem mensagens (não resolvida).

Se um módulo tem alguma aula que precisa de subtópico, todas as aulas dele
viram subtópicos (com o nome do menu), para manter a ordem do menu na tela.

A ordem das aulas é a do menu; aulas com cabeçalho fora do menu entram no fim
do módulo, na ordem do canal. Os vídeos de uma aula seguem a ordem das mensagens.

Chaves (usadas para progresso e anotações): `J01.m<id do vídeo>` para vídeos,
`J01.materiais` para o grupo de materiais e `J01` nos demais casos. Se a mesma
tag aparece em mais de um menu, a chave ganha o menu na frente (`I05.J01...`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from ...metadata import clean_caption
from ...models import SourceMessage
from ...outline import Outline, RefEntry, Section
from ...outline.models import Location
from ...refs import RefExtractor
from ...report import DuplicateRef, IndexingReport, OrphanMaterial, UnresolvedRef
from ...resolver import MatchReason
from ...structure import (
    CourseSection,
    CourseStructure,
    Lesson,
    Material,
    Strategy,
    TitleSource,
)
from .assemble import Assembly, LessonGroup, MenuBlock
from .parsing import prefix, same_title, video_title

MATERIALS_TITLE = "Materiais de apoio"
NO_MODULE_TITLE = "(sem módulo)"


@dataclass(slots=True)
class Built:
    course: CourseStructure
    report: IndexingReport
    outline: Outline


@dataclass(slots=True)
class _Builder:
    assembly: Assembly
    refs: RefExtractor
    report: IndexingReport = field(default_factory=IndexingReport)
    ambiguous: set[str] = field(default_factory=set)
    menu_labels: dict[int, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        modules = self.assembly.modules
        owners: dict[str, set[int | None]] = {}
        for menu in modules:
            for entry in menu.entries:
                owners.setdefault(entry.key, set()).add(menu.id)
        for (menu_id, key) in self.assembly.groups:
            owners.setdefault(key, set()).add(menu_id)
        self.ambiguous = {k for k, ids in owners.items() if len(ids) > 1}
        tags = [m.key for m in modules]
        self.menu_labels = {
            m.id: m.key if tags.count(m.key) == 1 else f"{m.key}-{m.id}" for m in modules
        }

    # ------------------------------------------------------------------ chaves
    def base_key(self, key: str, menu_id: int | None) -> str:
        if key in self.ambiguous and menu_id is not None:
            return f"{self.menu_labels[menu_id]}.{key}"
        return key

    # ---------------------------------------------------------------- materiais
    @staticmethod
    def material(message: SourceMessage, via: int | None) -> Material:
        return Material(
            message_id=message.id,
            reason=MatchReason.SEQUENCE,
            via=via,
            grouped_id=message.grouped_id,
            media=message.media,
            caption=message.text,
        )

    def caption_parts(self, message: SourceMessage) -> tuple[str, str]:
        caption = clean_caption(message.text, self.refs)
        lines = [line for line in caption.splitlines() if line.strip()]
        if not lines:
            return "", ""
        source = message.markdown if message.markdown is not None else message.text
        md_lines = [line for line in clean_caption(source, self.refs).splitlines() if line.strip()]
        return video_title(lines[0]), "\n".join(md_lines[1:]).strip()

    def full_caption(self, message: SourceMessage) -> str:
        source = message.markdown if message.markdown is not None else message.text
        return clean_caption(source, self.refs)

    # -------------------------------------------------------------------- aulas
    @staticmethod
    def lesson(title: str, source: TitleSource, ref: str, raw: str, location: str | None,
               materials: list[Material], description: str = "") -> Lesson:
        # A posição é definida no fim, percorrendo o curso já montado.
        return Lesson(title=title, title_source=source, position=0, ref=ref, ref_raw=raw,
                      summary_location=location, description=description, materials=materials)

    def video_lesson(self, video: SourceMessage, via: int, base: str, raw: str,
                     location: str | None, number: int) -> Lesson:
        caption_title, description = self.caption_parts(video)
        if caption_title:
            title, source = caption_title, TitleSource.CAPTION
        elif video.media and video.media.file_name:
            title, source = video.media.file_name.rsplit(".", 1)[0], TitleSource.FILE_NAME
        else:
            title, source = f"Parte {number}", TitleSource.GENERATED
        return self.lesson(title, source, f"{base}.m{video.id}", raw, location,
                           [self.material(video, via)], description)

    def item_for(self, group: LessonGroup | None, entry_label: str | None, *, key: str, raw: str,
                 module: str | None, location: str | None) -> _Item:
        base = self.base_key(key, module)
        if group is None:
            title = entry_label or f"#{raw}"
            source = TitleSource.SUMMARY_LABEL if entry_label else TitleSource.GENERATED
            only = self.lesson(title, source, base, raw, location, [])
            return _Item(title, location, only, [only])

        via = group.first_id
        here = location or str(group.first_id)
        title, source = (
            (entry_label, TitleSource.SUMMARY_LABEL) if entry_label
            else (group.title, TitleSource.HEADER) if group.title
            else (f"#{raw}", TitleSource.GENERATED)
        )
        videos, files = group.videos, group.materials

        if not videos and files:
            materials = [self.material(m, via) for m in files]
            only = self.lesson(title, source, base, raw, here, materials, group.body)
            return _Item(title, here, only, [only])
        if not videos:  # só o cabeçalho: aula de texto
            headers = [Material(message_id=i, reason=MatchReason.SEQUENCE) for i in group.header_ids]
            only = self.lesson(title, source, base, raw, here, headers, group.body)
            return _Item(title, here, only, [only])

        expanded = [self.video_lesson(v, via, base, raw, here, n) for n, v in enumerate(videos, start=1)]
        if files:
            expanded.append(self.lesson(MATERIALS_TITLE, TitleSource.GENERATED, f"{base}.materiais",
                                        raw, here, [self.material(m, via) for m in files], group.body))
            return _Item(title, here, None, expanded)
        if len(videos) > 1:
            return _Item(title, here, None, expanded)
        # Um vídeo só: no formato compacto a aula leva o nome do menu e a legenda vira descrição.
        video = videos[0]
        description = "\n\n".join(p for p in (group.body, self.full_caption(video)) if p)
        compact = self.lesson(title, source, f"{base}.m{video.id}", raw, here,
                              [self.material(video, via)], description)
        return _Item(title, here, compact, expanded)

    # ------------------------------------------------------------------ módulos
    def module(self, menu: MenuBlock | None, groups: list[LessonGroup], *, title: str) -> CourseSection:
        section = CourseSection(
            title=title, level=1, implicit=menu is None, location=str(menu.id) if menu else None
        )
        menu_id = menu.id if menu else None
        by_key = {g.key: g for g in groups if g.in_menu}
        seen: dict[str, int] = {}
        items: list[tuple[int | None, _Item]] = []  # (primeiro cabeçalho, aula)

        for entry in menu.entries if menu else []:
            location = f"{menu.message_ids[-1]}:{entry.line}"
            if entry.key in seen:
                self.report.duplicates_in_summary.append(
                    DuplicateRef(entry.key, f"{menu.message_ids[-1]}:{seen[entry.key]}", [location])
                )
                continue
            seen[entry.key] = entry.line
            group = by_key.get(entry.key)
            if group is None:
                self.report.unresolved.append(UnresolvedRef(entry.key, location, section.title))
            items.append((group.first_id if group else None,
                          self.item_for(group, entry.label or None, key=entry.key, raw=entry.raw,
                                        module=menu_id, location=location)))

        # Aulas sem entrada no menu entram logo depois da aula que as antecede no canal.
        for group in sorted((g for g in groups if not g.in_menu), key=lambda g: g.first_id):
            if menu is not None:
                self.report.refs_not_in_summary[self.base_key(group.key, menu_id)] = list(group.header_ids)
            item = self.item_for(group, None, key=group.key, raw=group.raw, module=menu_id, location=None)
            after = [i for i, (anchor, _) in enumerate(items) if anchor is not None and anchor < group.first_id]
            items.insert(after[-1] + 1 if after else 0, (group.first_id, item))

        # O catálogo lista as aulas do módulo antes dos subtópicos. Para não perder a
        # ordem do menu, ou o módulo é todo de aulas, ou todo de subtópicos.
        if all(item.compact is not None for _, item in items):
            section.lessons = [item.compact for _, item in items if item.compact is not None]
        else:
            section.children = [
                CourseSection(title=item.title, level=2, location=item.location, lessons=item.expanded)
                for _, item in items
            ]
        return section


@dataclass(slots=True)
class _Item:
    """Uma aula do menu, nas duas formas possíveis de exibição."""

    title: str
    location: str | None
    compact: Lesson | None  # aula única direto no módulo (None se precisa de subtópico)
    expanded: list[Lesson]  # aulas dentro de um subtópico com o nome do menu


def _module_order(assembly: Assembly) -> list[tuple[MenuBlock, MenuBlock | None]]:
    """Módulos na ordem dos índices (partes), cada um com a parte a que pertence.

    Um módulo listado num índice (pelo título) segue a ordem desse índice; um
    módulo que nenhum índice lista fica na parte que o antecede no canal.
    Sem índices, vale a ordem de aparição.
    """
    modules, indexes = assembly.modules, assembly.indexes
    if not indexes:
        return [(m, None) for m in modules]
    placed: dict[int, MenuBlock] = {}
    listed: dict[int, list[MenuBlock]] = {i.id: [] for i in indexes}
    for index in indexes:
        for entry in index.entries:
            candidates = [m for m in modules if m.id not in placed and same_title(m.title, entry.label)]
            if not candidates:
                continue
            # Títulos repetidos entre partes ("MODULO 04 - OUTROS GENEROS" nas duas):
            # vale o menu com a mesma letra de tag do índice, depois a tag exata,
            # depois o primeiro depois do índice.
            filters = (
                lambda m: prefix(m.key) == prefix(entry.key),
                lambda m: m.key == entry.key,
                lambda m: m.id > index.id,
            )
            for keep in filters:
                candidates = [m for m in candidates if keep(m)] or candidates
            chosen = min(candidates, key=lambda m: m.id)
            placed[chosen.id] = index
            listed[index.id].append(chosen)
    loose_before: list[MenuBlock] = []
    for module in modules:
        if module.id in placed:
            continue
        before = [i for i in indexes if i.id < module.id]
        if before:
            owner = max(before, key=lambda i: i.id)
            placed[module.id] = owner
            listed[owner.id].append(module)
        else:
            loose_before.append(module)
    ordered = [(m, None) for m in loose_before]
    for index in indexes:
        ordered.extend((m, index) for m in listed[index.id])
    return ordered


def build(assembly: Assembly, refs: RefExtractor, *, title: str, total_messages: int,
          messages: Sequence[SourceMessage]) -> Built:
    builder = _Builder(assembly, refs)
    report = builder.report
    report.summary.parser = "module_menu"
    report.summary.message_ids = assembly.menu_ids
    report.summary.warnings.extend(assembly.warnings)

    groups_by_module: dict[int | None, list[LessonGroup]] = {}
    for (menu_id, _), group in assembly.groups.items():
        groups_by_module.setdefault(menu_id, []).append(group)

    course = CourseStructure(title=title, strategy=Strategy.MODULE_MENU)
    outline = Outline(format="module_menu")
    order = _module_order(assembly)
    parts = {index.id for _, index in order if index is not None}
    for menu, index in order:
        name = menu.title or f"#{menu.raw}"
        # Com mais de uma parte no canal, o nome da parte vem antes do módulo.
        section_title = f"{index.title} · {name}" if len(parts) > 1 and index and index.title else name
        course.sections.append(builder.module(menu, groups_by_module.get(menu.id, []), title=section_title))
        outline.sections.append(Section(
            title=section_title, level=1, location=Location(str(menu.id), 1),
            refs=[RefEntry(e.key, e.raw, Location(str(menu.message_ids[-1]), e.line), e.label or None)
                  for e in menu.entries],
        ))
    loose = groups_by_module.get(None, [])
    if loose:
        report.summary.warnings.append(
            f"{len(loose)} aula(s) com cabeçalho antes de qualquer menu; agrupadas em "
            f"'{NO_MODULE_TITLE}'"
        )
        course.sections.append(builder.module(None, loose, title=NO_MODULE_TITLE))

    for position, lesson in enumerate(course.lessons(), start=1):
        lesson.position = position
    _fill_report(report, course, assembly, refs, total_messages, messages)
    return Built(course, report, outline)


def _fill_report(report: IndexingReport, course: CourseStructure, assembly: Assembly,
                 refs: RefExtractor, total_messages: int, messages: Sequence[SourceMessage]) -> None:
    seen_albums: set[int] = set()
    by_album: dict[int, list[SourceMessage]] = {}
    for message in assembly.orphans:
        if message.grouped_id is not None:
            by_album.setdefault(message.grouped_id, []).append(message)
    for message in assembly.orphans:
        if message.grouped_id is not None:
            if message.grouped_id in seen_albums:
                continue
            seen_albums.add(message.grouped_id)
            items = by_album[message.grouped_id]
        else:
            items = [message]
        caption = next((clean_caption(m.text, refs) for m in items if clean_caption(m.text, refs)), "")
        keys = sorted({k for m in items for k in refs.keys(m.text)})
        report.orphans.append(OrphanMaterial([m.id for m in items], message.grouped_id, keys, caption))

    stats = report.stats
    stats.messages = total_messages
    stats.media_messages = sum(1 for m in messages if m.has_media)
    lessons = course.lessons()
    stats.lessons = len(lessons)
    stats.resolved_lessons = sum(1 for lesson in lessons if lesson.resolved)
    stats.unresolved_lessons = stats.lessons - stats.resolved_lessons
    stats.materials = sum(1 for lesson in lessons for m in lesson.materials if m.media)
    stats.orphan_media_messages = len(assembly.orphans)
