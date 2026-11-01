"""Acompanhamento do aprendizado: progresso por usuário e por aula.

As anotações ficam no Caderno Digital (`app.notebook`).

Tudo é gravado em SQLite (`data/teleaula.db`) e identificado por
`(usuário, curso, chave da aula)`. A chave da aula vem do catálogo
(`app.courses`) e não muda quando o canal é reindexado.
"""

from .db import Database
from .progress import LessonProgress, ProgressStore
from .summary import CourseProgress, summarize

__all__ = [
    "CourseProgress",
    "Database",
    "LessonProgress",
    "ProgressStore",
    "summarize",
]
