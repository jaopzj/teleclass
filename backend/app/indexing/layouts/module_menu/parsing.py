"""Leitura dos textos do layout de menus por módulo, linha a linha.

Formatos reconhecidos (emojis, setas e aspas em volta são ignorados):

Menu do módulo (uma mensagem de texto, às vezes continuada na seguinte):

    ✳️ #I01
    ➡ MODULO 00 - AULAS ESSENCIAIS
    ► Conteúdo:
    #J01 - AULAS ESSENCIAIS PARA ENTENDER A ESTRUTURA
    #J02 - AULAS ESSENCIAIS PARA ENTENDER OS REPERTORIOS

Cabeçalho da aula (mensagem de texto antes das mídias da aula):

    #J01
    1 AULAS ESSENCIAIS PARA ENTENDER A ESTRUTURA
    ▶️ Vídeo aulas abaixo          (ou: ♻️ Materiais de apoio abaixo)

A letra do identificador do menu (`I`) é diferente da letra das aulas (`J`,
`L`...), que muda de um módulo para outro.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from enum import StrEnum

from ...refs import RefExtractor

# Primeira linha de um menu ou cabeçalho: lixo visual, a tag e, opcionalmente, um rótulo.
_REF_LINE = re.compile(r"^[^\w#]*#(\w*\d\w*)(?![\w])\s*[-–—:|•.]*\s*(.*?)\s*$")
_LEADING_JUNK = re.compile(r"^[^\w(\[\"'“]+")
_TRAILING_JUNK = re.compile(r"[\s\-–—:|•\"'”»]+$")
_CONTENT_LABEL = re.compile(r"^conteudos?\W*$")
_PREFIX = re.compile(r"^([^\d]*)\d")
_VIDEO_PREFIX = re.compile(r"^\s*v[ií]deo\s*-?\s*aula\s*[-–—:|]\s*", re.IGNORECASE)


class Marker(StrEnum):
    VIDEOS = "videos"
    MATERIALS = "materials"


@dataclass(frozen=True, slots=True)
class Entry:
    """Uma aula listada no menu (`#J01 - Título`)."""

    key: str
    raw: str
    label: str
    line: int  # 1-based, dentro do texto do menu


@dataclass(frozen=True, slots=True)
class MenuText:
    key: str
    raw: str
    title: str | None
    entries: tuple[Entry, ...]


@dataclass(frozen=True, slots=True)
class HeaderText:
    key: str
    raw: str
    title: str | None
    marker: Marker | None
    body: str


def fold(text: str) -> str:
    """Minúsculas e sem acentos, para comparar palavras-chave."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def prefix(key: str) -> str:
    """Parte do identificador antes do primeiro dígito: `J01` -> `J`."""
    match = _PREFIX.match(key)
    return match.group(1) if match else key


def clean_title(line: str) -> str:
    return _TRAILING_JUNK.sub("", _LEADING_JUNK.sub("", line)).strip()


def video_title(caption_line: str) -> str:
    """Tira o prefixo "Videoaula - " que se repete em todas as legendas."""
    return clean_title(_VIDEO_PREFIX.sub("", caption_line))


def marker_of(line: str) -> Marker | None:
    folded = fold(line)
    if not re.search(r"\b(abaixo|a seguir)\b", folded):
        return None
    if re.search(r"materia(l|is)\b", folded):
        return Marker.MATERIALS
    if re.search(r"v[i]deo\s*-?\s*aulas?|\bvideos?\b|\baulas?\b", folded):
        return Marker.VIDEOS
    return None


def _skip_as_title(line: str) -> bool:
    """Linhas que não servem de título: "Conteúdo:" e chamadas como "Clique aqui...". """
    folded = fold(clean_title(line))
    return bool(_CONTENT_LABEL.match(folded)) or folded.startswith(("clique aqui", "toque aqui", "dica"))


def normalize_title(text: str) -> str:
    """Forma comparável de um título: sem acentos, minúsculas, só letras e dígitos."""
    return " ".join(re.sub(r"[^0-9a-z]+", " ", fold(text or "")).split())


def same_title(a: str | None, b: str | None, *, min_ratio: float = 0.75) -> bool:
    """Títulos iguais, tolerando um prefixo/sufixo curto (ex.: "1 AULAS..." x "AULAS...")."""
    na, nb = normalize_title(a or ""), normalize_title(b or "")
    if not na or not nb:
        return False
    if na == nb:
        return True
    short, long = sorted((na, nb), key=len)
    return short in long and len(short) / len(long) >= min_ratio


def _nonblank(text: str) -> list[tuple[int, str]]:
    return [(n, line) for n, line in enumerate((text or "").splitlines(), start=1) if line.strip()]


class MenuParser:
    def __init__(self, refs: RefExtractor) -> None:
        self.refs = refs

    def ref_line(self, line: str) -> tuple[str, str, str] | None:
        """(chave, como apareceu, rótulo) se a linha começa por uma tag."""
        match = _REF_LINE.match(line)
        if not match:
            return None
        raw = match.group(1)
        return self.refs.normalize(raw), raw, clean_title(match.group(2))

    def menu(self, text: str) -> MenuText | None:
        lines = _nonblank(text)
        if not lines:
            return None
        head = self.ref_line(lines[0][1])
        if head is None:
            return None
        key, raw, label = head
        title = label or None
        entries: list[Entry] = []
        for number, line in lines[1:]:
            parsed = self.ref_line(line)
            if parsed:
                if prefix(parsed[0]) != prefix(key):
                    entries.append(Entry(parsed[0], parsed[1], parsed[2], number))
                continue
            if title is None and entries == [] and not _skip_as_title(line):
                title = clean_title(line) or None
        if not entries:
            return None
        return MenuText(key, raw, title, tuple(entries))

    def continuation(self, text: str) -> list[Entry] | None:
        """Mensagem só com linhas `#J07 - Título`: continuação de um menu longo."""
        entries: list[Entry] = []
        for number, line in _nonblank(text):
            parsed = self.ref_line(line)
            if parsed is None or not parsed[2]:
                if _CONTENT_LABEL.match(fold(clean_title(line))):
                    continue
                return None
            entries.append(Entry(parsed[0], parsed[1], parsed[2], number))
        return entries or None

    def header(self, text: str) -> HeaderText | None:
        lines = _nonblank(text)
        if not lines:
            return None
        head = self.ref_line(lines[0][1])
        if head is None:
            return None
        key, raw, label = head
        title = label or None
        marker: Marker | None = None
        body: list[str] = []
        for _, line in lines[1:]:
            found = marker_of(line)
            if found:
                marker = found
            elif title is None:
                title = clean_title(line) or None
            else:
                body.append(line.strip())
        return HeaderText(key, raw, title, marker, "\n".join(body))
