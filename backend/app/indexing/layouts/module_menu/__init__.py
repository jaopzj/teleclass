"""Layout de menus por módulo.

O canal não tem um sumário geral. Cada módulo tem um menu (`#I01`) que lista
as aulas (`#J01 - Título`); cada aula tem uma mensagem de cabeçalho (`#J01`)
seguida pelas mídias dela, que não carregam a tag. Ou seja, a ligação entre
aula e mídia é por posição no canal, não por identificador.

- `parsing`:  reconhece menus, cabeçalhos e marcadores em um texto;
- `assemble`: percorre o canal e agrupa as mídias de cada aula;
- `build`:    monta módulos, aulas, relatório e sumário.

A detecção é conservadora para não capturar canais do layout original: exige
menus e aulas cujo conteúdo venha *depois* de um cabeçalho só de texto.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ...models import ChannelSnapshot
from ...refs import RefExtractor
from ..base import LayoutMatch
from .assemble import Assembly, assemble
from .build import build
from .parsing import MenuParser

if TYPE_CHECKING:
    from ...pipeline import IndexingOptions, IndexingResult


class ModuleMenuLayout:
    name = "module_menu"

    def __init__(
        self,
        refs: RefExtractor | None = None,
        *,
        min_lessons: int = 2,
        min_coverage: float = 0.5,
    ) -> None:
        self.refs = refs or RefExtractor()
        self.min_lessons = min_lessons
        self.min_coverage = min_coverage

    def assemble(self, snapshot: ChannelSnapshot, refs: RefExtractor | None = None) -> Assembly:
        return assemble(snapshot.messages, MenuParser(refs or self.refs))

    def detect(self, snapshot: ChannelSnapshot) -> LayoutMatch:
        assembly = self.assemble(snapshot)
        if not assembly.modules:
            return LayoutMatch.rejected(menus=0)
        declared = {(menu.id, entry.key) for menu, entry in assembly.declared()}
        # Aulas cuja mídia veio depois de um cabeçalho só de texto (o traço deste layout).
        positional = {
            key
            for key, group in assembly.groups.items()
            if any(m.id not in group.header_ids for m in group.media)
        }
        attached = [m for g in assembly.groups.values() for m in g.media]
        after_header = [
            m for g in assembly.groups.values() for m in g.media if m.id not in g.header_ids
        ]
        found = len(positional & declared)
        coverage = found / len(declared) if declared else 0.0
        untagged = len(after_header) / len(attached) if attached else 0.0
        evidence = {
            "menus": len(assembly.modules),
            "index_menus": len(assembly.indexes),
            "declared_lessons": len(declared),
            "lessons_with_content": found,
            "coverage": round(coverage, 3),
            "media_after_header": round(untagged, 3),
        }
        accepted = found >= self.min_lessons and coverage >= self.min_coverage and untagged >= 0.5
        return LayoutMatch(coverage if accepted else 0.0, accepted, evidence)

    def index(self, snapshot: ChannelSnapshot, options: IndexingOptions) -> IndexingResult:
        from ...pipeline import IndexingResult

        assembly = self.assemble(snapshot, options.refs)
        built = build(
            assembly,
            options.refs,
            title=snapshot.title or "Curso sem título",
            total_messages=len(snapshot.messages),
            messages=snapshot.messages,
        )
        return IndexingResult(course=built.course, report=built.report, outline=built.outline)
