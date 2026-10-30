"""Formato de sumário com marcadores `=`, `==` e `#`.

    = 01. Introdução
    #A001
    = 02. Conceitos
    == 02.1. Variáveis
    #A002 #A003

O número de sinais de igual no início da linha define o nível (1 = módulo,
2 = subtópico; níveis mais profundos funcionam da mesma forma). Cada
identificador `#` pertence à última seção aberta, inclusive quando o sumário
continua em outra mensagem.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Sequence

from ..refs import RefExtractor, RefMatch
from .base import Signal, SignalStrength
from .models import Location, Outline, OutlineSource, RefEntry, Section

_HEADING = re.compile(r"^\s*(=+)\s*(.*?)\s*=*\s*$")
# Separadores que costumam ficar entre um identificador e seu rótulo: "#A001 - Boas-vindas"
_LABEL_TRIM = " \t-–—:|•·.,;"


class LineKind(Enum):
    HEADING = "heading"
    REFS = "refs"
    TEXT = "text"
    BLANK = "blank"


@dataclass(frozen=True, slots=True)
class ParsedLine:
    kind: LineKind
    level: int = 0
    title: str = ""
    refs: tuple[RefMatch, ...] = ()
    rest: str = ""  # texto da linha sem os identificadores


class MarkerOutlineParser:
    name = "markers"

    def __init__(
        self,
        refs: RefExtractor | None = None,
        *,
        min_structural_ratio: float = 0.5,
    ) -> None:
        self._refs = refs or RefExtractor()
        self._min_ratio = min_structural_ratio

    # ------------------------------------------------------------------ linhas
    def parse_line(self, line: str) -> ParsedLine:
        if not line.strip():
            return ParsedLine(LineKind.BLANK)
        refs = tuple(self._refs.find(line))
        heading = _HEADING.match(line)
        if heading:
            title = self._refs.strip(heading.group(2)) if refs else heading.group(2)
            if title:
                return ParsedLine(
                    LineKind.HEADING, level=len(heading.group(1)), title=title, refs=refs
                )
            if not refs:
                # Linha só com "=====": separador visual, não é título.
                return ParsedLine(LineKind.BLANK)
        if refs:
            return ParsedLine(LineKind.REFS, refs=refs, rest=self._refs.strip(line))
        return ParsedLine(LineKind.TEXT)

    # ---------------------------------------------------------------- detecção
    def signal(self, text: str) -> Signal:
        headings = ref_lines = refs = other = 0
        for line in (text or "").splitlines():
            parsed = self.parse_line(line)
            if parsed.kind is LineKind.HEADING:
                headings += 1
                refs += len(parsed.refs)
            elif parsed.kind is LineKind.REFS:
                ref_lines += 1
                refs += len(parsed.refs)
            elif parsed.kind is LineKind.TEXT:
                other += 1
        structural = headings + ref_lines
        if structural == 0 or structural / (structural + other) < self._min_ratio:
            return Signal.none()
        if (headings >= 1 and headings + refs >= 2) or refs >= 3:
            strength = SignalStrength.STRONG
        else:
            strength = SignalStrength.WEAK
        return Signal(strength, headings=headings, refs=refs)

    # ----------------------------------------------------------- interpretação
    def parse(self, sources: Sequence[OutlineSource]) -> Outline:
        outline = Outline(format=self.name)
        stack: list[Section] = []

        def current_section(location: Location) -> Section:
            if stack:
                return stack[-1]
            implicit = Section(title="(sem módulo)", level=1, location=location, implicit=True)
            outline.sections.append(implicit)
            outline.warnings.append(
                f"{location}: referências antes do primeiro módulo; "
                "agrupadas em uma seção implícita"
            )
            stack.append(implicit)
            return implicit

        for source in sources:
            for number, line in enumerate(source.text.splitlines(), start=1):
                parsed = self.parse_line(line)
                location = Location(source.source_id, number)

                if parsed.kind is LineKind.HEADING:
                    while stack and stack[-1].level >= parsed.level:
                        stack.pop()
                    section = Section(parsed.title, parsed.level, location)
                    if stack:
                        if parsed.level > stack[-1].level + 1:
                            outline.warnings.append(
                                f"{location}: nível {parsed.level} logo após nível "
                                f"{stack[-1].level}; vinculado à seção anterior"
                            )
                        stack[-1].children.append(section)
                    else:
                        if parsed.level > 1:
                            outline.warnings.append(
                                f"{location}: subtópico '{parsed.title}' sem módulo "
                                "anterior; tratado como seção de primeiro nível"
                            )
                        outline.sections.append(section)
                    stack.append(section)
                    section.refs.extend(self._entries(parsed, location, label=None))

                elif parsed.kind is LineKind.REFS:
                    label = parsed.rest.strip(_LABEL_TRIM) or None
                    if len(parsed.refs) > 1:
                        label = None  # um rótulo só faz sentido para uma referência
                    current_section(location).refs.extend(
                        self._entries(parsed, location, label=label)
                    )

        return outline

    @staticmethod
    def _entries(parsed: ParsedLine, location: Location, label: str | None) -> list[RefEntry]:
        return [RefEntry(m.key, m.raw, location, label) for m in parsed.refs]
