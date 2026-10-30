"""Extração dos metadados de uma aula a partir das suas mensagens (PLANO.md, 6.9).

- Título: primeira linha não vazia da legenda (sem os identificadores); senão,
  nome do arquivo sem extensão; senão, rótulo do sumário; senão, "Aula N".
- Descrição: restante da legenda, em Markdown quando disponível (preserva links).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePath
from typing import Sequence

from .models import SourceMessage
from .refs import RefExtractor
from .structure import TitleSource


@dataclass(frozen=True, slots=True)
class LessonMetadata:
    title: str
    title_source: TitleSource
    description: str


def _first_line_and_rest(text: str) -> tuple[str, str]:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if line.strip():
            return line.strip(), "\n".join(lines[index + 1 :]).strip()
    return "", ""


def clean_caption(text: str, refs: RefExtractor) -> str:
    """Remove identificadores e linhas que ficaram vazias por causa disso."""
    lines = [refs.strip(line) if refs.find(line) else line for line in text.splitlines()]
    return "\n".join(lines).strip()


def extract_metadata(
    messages: Sequence[SourceMessage],
    refs: RefExtractor,
    *,
    position: int,
    summary_label: str | None = None,
) -> LessonMetadata:
    """`messages` em ordem; a primeira com legenda útil define título e descrição."""
    for message in messages:
        caption = clean_caption(message.text, refs)
        title, _ = _first_line_and_rest(caption)
        if not title:
            continue
        source_md = message.markdown if message.markdown is not None else message.text
        _, description = _first_line_and_rest(clean_caption(source_md, refs))
        return LessonMetadata(title.strip(" -–—:|"), TitleSource.CAPTION, description)

    for message in messages:
        if message.media and message.media.file_name:
            stem = PurePath(message.media.file_name).stem.strip()
            if stem:
                return LessonMetadata(stem, TitleSource.FILE_NAME, "")

    if summary_label:
        return LessonMetadata(summary_label, TitleSource.SUMMARY_LABEL, "")
    return LessonMetadata(f"Aula {position}", TitleSource.GENERATED, "")
