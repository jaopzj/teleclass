"""Anotações pessoais: um texto por aula e por usuário.

Cada gravação informa a revisão em que o texto foi baseado. Se outra aba ou
outro dispositivo gravou antes, a gravação é recusada com o texto atual
(`NoteConflict`) em vez de sobrescrevê-lo, e o frontend decide o que fazer.
"""

from __future__ import annotations

from dataclasses import dataclass

from .db import Database, utcnow

MAX_NOTE_LENGTH = 200_000


@dataclass(frozen=True, slots=True)
class Note:
    body: str = ""
    revision: int = 0  # 0 = ainda não existe
    updated_at: str | None = None

    def to_dict(self) -> dict:
        return {"body": self.body, "revision": self.revision, "updated_at": self.updated_at}


class NoteConflict(Exception):
    def __init__(self, current: Note) -> None:
        super().__init__("A anotação foi alterada em outro lugar")
        self.current = current


class NotesStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    def get(self, user_id: str, course_id: str, lesson_key: str) -> Note:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT body, revision, updated_at FROM lesson_notes "
                "WHERE user_id = ? AND course_id = ? AND lesson_key = ?",
                (user_id, course_id, lesson_key),
            ).fetchone()
        return Note(row["body"], row["revision"], row["updated_at"]) if row else Note()

    def save(
        self, user_id: str, course_id: str, lesson_key: str, body: str, base_revision: int
    ) -> Note:
        now = utcnow()
        key = (user_id, course_id, lesson_key)
        with self.db.connect() as conn:
            if base_revision == 0:
                cursor = conn.execute(
                    "INSERT OR IGNORE INTO lesson_notes "
                    "(user_id, course_id, lesson_key, body, revision, updated_at) "
                    "VALUES (?, ?, ?, ?, 1, ?)",
                    (*key, body, now),
                )
            else:
                cursor = conn.execute(
                    "UPDATE lesson_notes SET body = ?, revision = revision + 1, updated_at = ? "
                    "WHERE user_id = ? AND course_id = ? AND lesson_key = ? AND revision = ?",
                    (body, now, *key, base_revision),
                )
        if cursor.rowcount == 0:
            raise NoteConflict(self.get(*key))
        return self.get(*key)
