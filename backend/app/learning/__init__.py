"""Acompanhamento do aprendizado: progresso e anotações por usuário e por aula.

Tudo é gravado em SQLite (`data/teleaula.db`) e identificado por
`(usuário, curso, chave da aula)`. A chave da aula vem do catálogo
(`app.courses`) e não muda quando o canal é reindexado.
"""

from .db import Database
from .notes import Note, NoteConflict, NotesStore
from .progress import LessonProgress, ProgressStore
from .summary import CourseProgress, summarize

__all__ = [
    "CourseProgress",
    "Database",
    "LessonProgress",
    "Note",
    "NoteConflict",
    "NotesStore",
    "ProgressStore",
    "summarize",
]
