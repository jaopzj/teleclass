"""Progresso por aula.

Posição de reprodução e conclusão são independentes: salvar a posição nunca
marca a aula como concluída, e marcar como concluída não depende da posição.
"""

from __future__ import annotations

from dataclasses import dataclass

from .db import Database, utcnow


@dataclass(frozen=True, slots=True)
class LessonProgress:
    lesson_key: str
    position_seconds: float = 0.0
    duration_seconds: float | None = None
    completed: bool = False
    completed_at: str | None = None
    last_watched_at: str | None = None

    def to_dict(self) -> dict:
        return {
            "position_seconds": self.position_seconds,
            "duration_seconds": self.duration_seconds,
            "completed": self.completed,
            "completed_at": self.completed_at,
            "last_watched_at": self.last_watched_at,
        }


def _row(row) -> LessonProgress:
    return LessonProgress(
        lesson_key=row["lesson_key"],
        position_seconds=row["position_seconds"],
        duration_seconds=row["duration_seconds"],
        completed=bool(row["completed"]),
        completed_at=row["completed_at"],
        last_watched_at=row["last_watched_at"],
    )


class ProgressStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    def for_course(self, user_id: str, course_id: str) -> dict[str, LessonProgress]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM lesson_progress WHERE user_id = ? AND course_id = ?",
                (user_id, course_id),
            ).fetchall()
        return {row["lesson_key"]: _row(row) for row in rows}

    def delete_course(self, user_id: str, course_id: str) -> int:
        with self.db.connect() as conn:
            cursor = conn.execute(
                "DELETE FROM lesson_progress WHERE user_id = ? AND course_id = ?", (user_id, course_id)
            )
        return cursor.rowcount

    def get(self, user_id: str, course_id: str, lesson_key: str) -> LessonProgress:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM lesson_progress WHERE user_id = ? AND course_id = ? AND lesson_key = ?",
                (user_id, course_id, lesson_key),
            ).fetchone()
        return _row(row) if row else LessonProgress(lesson_key)

    def save_position(
        self,
        user_id: str,
        course_id: str,
        lesson_key: str,
        position_seconds: float,
        duration_seconds: float | None,
    ) -> LessonProgress:
        now = utcnow()
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO lesson_progress
                    (user_id, course_id, lesson_key, position_seconds, duration_seconds,
                     last_watched_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id, course_id, lesson_key) DO UPDATE SET
                    position_seconds = excluded.position_seconds,
                    duration_seconds = COALESCE(excluded.duration_seconds, duration_seconds),
                    last_watched_at = excluded.last_watched_at,
                    updated_at = excluded.updated_at
                """,
                (user_id, course_id, lesson_key, position_seconds, duration_seconds, now, now),
            )
        return self.get(user_id, course_id, lesson_key)

    def set_completed(
        self, user_id: str, course_id: str, lesson_key: str, completed: bool
    ) -> LessonProgress:
        now = utcnow()
        completed_at = now if completed else None
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO lesson_progress
                    (user_id, course_id, lesson_key, completed, completed_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id, course_id, lesson_key) DO UPDATE SET
                    completed = excluded.completed,
                    completed_at = CASE
                        WHEN excluded.completed AND completed THEN completed_at
                        ELSE excluded.completed_at END,
                    updated_at = excluded.updated_at
                """,
                (user_id, course_id, lesson_key, int(completed), completed_at, now),
            )
        return self.get(user_id, course_id, lesson_key)
