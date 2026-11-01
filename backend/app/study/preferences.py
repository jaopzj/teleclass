"""Preferências de estudo por usuário. Por enquanto, só o fuso horário."""

from __future__ import annotations

import sqlite3

from ..learning.db import Database, utcnow
from .days import DEFAULT_TIMEZONE, load_timezone


def read_timezone(conn: sqlite3.Connection, user_id: str) -> str | None:
    row = conn.execute("SELECT timezone FROM user_preferences WHERE user_id = ?", (user_id,)).fetchone()
    return row["timezone"] if row else None


class PreferencesStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    def timezone(self, user_id: str) -> str | None:
        """Fuso configurado, ou None se a pessoa ainda não tem um."""
        with self.db.connect() as conn:
            return read_timezone(conn, user_id)

    def effective_timezone(self, user_id: str) -> str:
        return self.timezone(user_id) or DEFAULT_TIMEZONE

    def set_timezone(self, user_id: str, name: str, *, only_if_missing: bool = False) -> str:
        """Grava o fuso (validado). Com `only_if_missing`, não troca um já existente."""
        load_timezone(name)
        conflict = "NOTHING" if only_if_missing else "UPDATE SET timezone = excluded.timezone, updated_at = excluded.updated_at"
        with self.db.connect() as conn:
            conn.execute(
                "INSERT INTO user_preferences (user_id, timezone, updated_at) VALUES (?, ?, ?) "
                f"ON CONFLICT (user_id) DO {conflict}",
                (user_id, name, utcnow()),
            )
            return read_timezone(conn, user_id) or name
