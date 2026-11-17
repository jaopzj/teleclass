"""Varredura do canal: menus, cabeçalhos e as mídias que vêm depois de cada um.

Duas passadas, em ordem de id:

1. menus. Cada menu é identificado pela mensagem, não pela tag: canais reais
   repetem a tag do menu em módulos diferentes. Um menu longo pode continuar
   na mensagem seguinte; um menu com a mesma tag *e* o mesmo título é uma
   repostagem e substitui o anterior. Menus cujas entradas são os títulos de
   outros menus ("Clique aqui para ir ao início do módulo") são **índices**:
   dividem o canal em partes e não viram módulos;
2. aulas. Um cabeçalho abre o grupo da aula, e as mídias seguintes entram nele
   até o próximo cabeçalho ou menu. Figurinhas (separadores visuais) são
   ignoradas, e textos soltos não fecham o grupo.

O cabeçalho é ligado à entrada do menu pelo **título** primeiro e pela tag
depois, porque as tags dos cabeçalhos às vezes estão erradas (`#A01` no lugar
de `#B01`, `#D010`, numeração deslocada em relação ao menu). Empates entre
títulos iguais em módulos diferentes são resolvidos pela tag e, depois, pelo
menu mais próximo antes do cabeçalho. Cabeçalhos sem entrada no menu entram no
módulo cujas aulas usam a mesma letra.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from ...models import MediaKind, SourceMessage
from .parsing import Entry, HeaderText, Marker, MenuParser, prefix, same_title

_STICKER_NAMES = {"sticker.webp", "sticker.tgs", "sticker.webm"}
_STICKER_MIMES = {"image/webp", "application/x-tgsticker"}


@dataclass(slots=True)
class MenuBlock:
    key: str
    raw: str
    title: str | None
    message_ids: list[int]
    entries: list[Entry]
    is_index: bool = False

    @property
    def id(self) -> int:
        """Identidade do menu: a mensagem em que apareceu pela primeira vez."""
        return self.message_ids[0]

    def entry_prefixes(self) -> set[str]:
        return {prefix(e.key) for e in self.entries}


@dataclass(slots=True)
class LessonGroup:
    key: str  # tag da entrada do menu (ou do cabeçalho, se não houver entrada)
    raw: str
    menu_id: int | None  # menu (módulo) ao qual a aula pertence
    in_menu: bool  # False: cabeçalho sem entrada correspondente no menu
    header_ids: list[int] = field(default_factory=list)
    header_tags: list[str] = field(default_factory=list)
    title: str | None = None
    body: str = ""
    markers: list[Marker] = field(default_factory=list)
    videos: list[SourceMessage] = field(default_factory=list)
    materials: list[SourceMessage] = field(default_factory=list)

    @property
    def first_id(self) -> int:
        return self.header_ids[0]

    @property
    def media(self) -> list[SourceMessage]:
        return sorted([*self.videos, *self.materials], key=lambda m: m.id)


@dataclass(slots=True)
class Assembly:
    menus: list[MenuBlock] = field(default_factory=list)  # em ordem de aparição
    groups: dict[tuple[int | None, str], LessonGroup] = field(default_factory=dict)
    orphans: list[SourceMessage] = field(default_factory=list)
    stickers: list[int] = field(default_factory=list)
    ignored_text_ids: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def modules(self) -> list[MenuBlock]:
        return [m for m in self.menus if not m.is_index]

    @property
    def indexes(self) -> list[MenuBlock]:
        return [m for m in self.menus if m.is_index]

    @property
    def menu_ids(self) -> list[int]:
        return sorted(i for menu in self.menus for i in menu.message_ids)

    def declared(self) -> list[tuple[MenuBlock, Entry]]:
        return [(m, e) for m in self.modules for e in m.entries]


def is_sticker(message: SourceMessage) -> bool:
    media = message.media
    if media is None or media.kind is not MediaKind.DOCUMENT and media.kind is not MediaKind.PHOTO:
        return False
    name = (media.file_name or "").lower()
    return name in _STICKER_NAMES or (media.mime_type in _STICKER_MIMES and (media.size or 0) < 512_000)


def _is_video(message: SourceMessage) -> bool:
    return message.media is not None and message.media.kind is MediaKind.VIDEO


def assemble(messages: Sequence[SourceMessage], parser: MenuParser) -> Assembly:
    result = Assembly()
    _read_menus(messages, parser, result)
    _classify_indexes(result)
    _read_lessons(messages, parser, result)
    return result


# ------------------------------------------------------------------------- menus
def _read_menus(messages: Sequence[SourceMessage], parser: MenuParser, result: Assembly) -> None:
    last: MenuBlock | None = None
    for message in messages:
        if message.has_media or not message.text.strip():
            if not (message.has_media and is_sticker(message)):
                last = None
            continue
        menu = parser.menu(message.text)
        if menu is not None:
            repost = next(
                (m for m in result.menus if m.key == menu.key and same_title(m.title, menu.title, min_ratio=1)),
                None,
            )
            if repost is not None:
                result.warnings.append(
                    f"menu #{menu.raw} repetido nas mensagens {repost.id} e {message.id}; vale o mais recente"
                )
                repost.entries = list(menu.entries)
                repost.message_ids.append(message.id)
                last = repost
            else:
                last = MenuBlock(menu.key, menu.raw, menu.title, [message.id], list(menu.entries))
                result.menus.append(last)
            continue
        if last is not None:
            more = parser.continuation(message.text)
            if more and all(prefix(e.key) != prefix(last.key) for e in more):
                last.entries.extend(more)
                last.message_ids.append(message.id)
                continue
        last = None


def _classify_indexes(result: Assembly) -> None:
    """Índice: a maioria das entradas tem o título de outro menu."""
    for menu in result.menus:
        others = [m.title for m in result.menus if m is not menu and m.title]
        hits = sum(1 for e in menu.entries if any(same_title(e.label, t) for t in others))
        menu.is_index = bool(menu.entries) and hits / len(menu.entries) >= 0.5


# ------------------------------------------------------------------------- aulas
def _header_of(message: SourceMessage, parser: MenuParser) -> HeaderText | None:
    header = parser.header(message.text) if message.text.strip() else None
    if header is not None and (header.title or header.marker or not message.has_media):
        return header
    return None


def _read_lessons(messages: Sequence[SourceMessage], parser: MenuParser, result: Assembly) -> None:
    menu_of_message = {i: m for m in result.menus for i in m.message_ids}
    headers = {
        m.id: h
        for m in messages
        if m.id not in menu_of_message and not is_sticker(m) and (h := _header_of(m, parser))
    }
    # Entradas já reivindicadas pelo título de algum cabeçalho não podem ser
    # tomadas pela tag de outro (tags deslocadas em relação ao menu).
    declared = result.declared()
    claimed = {
        (menu.id, entry.key)
        for h in headers.values() if h.title
        for menu, entry in declared if same_title(entry.label, h.title)
    }

    current_menu: MenuBlock | None = None
    current: LessonGroup | None = None
    for message in messages:
        if message.id in menu_of_message:
            menu = menu_of_message[message.id]
            current_menu = None if menu.is_index else menu
            current = None
            continue
        if message.has_media and is_sticker(message):
            result.stickers.append(message.id)
            continue
        header = headers.get(message.id)
        if header is not None:
            current = _open_group(result, header, message, current_menu, claimed)
            if message.has_media:  # cabeçalho na legenda da própria mídia
                _attach(current, message)
            continue
        if message.has_media:
            if current is not None:
                _attach(current, message)
            else:
                result.orphans.append(message)
            continue
        if message.text.strip():
            result.ignored_text_ids.append(message.id)


def _nearest(candidates: list[tuple[MenuBlock, Entry]], message_id: int) -> tuple[MenuBlock, Entry]:
    before = [c for c in candidates if c[0].id < message_id]
    return max(before, key=lambda c: c[0].id) if before else candidates[0]


def _pick(
    candidates: list[tuple[MenuBlock, Entry]], header: HeaderText, current: MenuBlock | None,
    message_id: int,
) -> tuple[MenuBlock, Entry]:
    if len(candidates) == 1:
        return candidates[0]
    for keep in (lambda c: c[1].key == header.key, lambda c: c[0] is current):
        candidates = [c for c in candidates if keep(c)] or candidates
        if len(candidates) == 1:
            return candidates[0]
    return _nearest(candidates, message_id)


def _match(
    result: Assembly, header: HeaderText, current: MenuBlock | None, message_id: int,
    claimed: set[tuple[int, str]],
) -> tuple[MenuBlock | None, Entry | None]:
    declared = result.declared()
    if header.title:
        by_title = [c for c in declared if same_title(c[1].label, header.title)]
        if by_title:
            return _pick(by_title, header, current, message_id)
    by_tag = [c for c in declared if c[1].key == header.key and (c[0].id, c[1].key) not in claimed]
    if by_tag:
        return _pick(by_tag, header, current, message_id)
    # Sem entrada no menu: o módulo cujas aulas usam a mesma letra; senão o atual.
    family = [m for m in result.modules if prefix(header.key) in m.entry_prefixes()]
    if family:
        before = [m for m in family if m.id < message_id]
        return (max(before, key=lambda m: m.id) if before else family[0]), None
    return current, None


def _open_group(
    result: Assembly, header: HeaderText, message: SourceMessage, current_menu: MenuBlock | None,
    claimed: set[tuple[int, str]],
) -> LessonGroup:
    menu, entry = _match(result, header, current_menu, message.id, claimed)
    menu_id = menu.id if menu else None
    key, raw = (entry.key, entry.raw) if entry else (header.key, header.raw)
    group: LessonGroup | None = None
    if entry is None:
        # Cabeçalho repetido (vídeos e depois materiais) de uma aula fora do menu.
        group = next(
            (g for (mid, _), g in result.groups.items()
             if mid == menu_id and not g.in_menu and header.key in g.header_tags
             and (not header.title or same_title(g.title, header.title))),
            None,
        )
        if group is None and any(e.key == key for m in result.modules if m.id == menu_id for e in m.entries):
            key = f"{key}-{message.id}"  # a tag do cabeçalho já é de outra aula deste módulo
    group = group or result.groups.get((menu_id, key))
    if group is None:
        group = LessonGroup(key, raw, menu_id, in_menu=entry is not None)
        result.groups[(menu_id, key)] = group
    group.header_ids.append(message.id)
    group.header_tags.append(header.key)
    if group.title is None and header.title:
        group.title = header.title
    if header.body and not group.body:
        group.body = header.body
    if header.marker:
        group.markers.append(header.marker)
    return group


def _attach(group: LessonGroup, message: SourceMessage) -> None:
    (group.videos if _is_video(message) else group.materials).append(message)
