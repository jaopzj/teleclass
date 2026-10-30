"""Banco SQLite local, com migrações simples numeradas (`PRAGMA user_version`).

Usa só a biblioteca padrão. Cada operação abre uma conexão curta: as rotas que
usam o banco são síncronas e o FastAPI as executa em threads separadas.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

MIGRATIONS: list[str] = [
    # 1: progresso e anotações por aula
    """
    CREATE TABLE lesson_progress (
        user_id          TEXT NOT NULL,
        course_id        TEXT NOT NULL,
        lesson_key       TEXT NOT NULL,
        position_seconds REAL NOT NULL DEFAULT 0,
        duration_seconds REAL,
        completed        INTEGER NOT NULL DEFAULT 0,
        completed_at     TEXT,
        last_watched_at  TEXT,
        updated_at       TEXT NOT NULL,
        PRIMARY KEY (user_id, course_id, lesson_key)
    );
    CREATE TABLE lesson_notes (
        user_id     TEXT NOT NULL,
        course_id   TEXT NOT NULL,
        lesson_key  TEXT NOT NULL,
        body        TEXT NOT NULL,
        revision    INTEGER NOT NULL,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (user_id, course_id, lesson_key)
    );
    """,
    # 2: contas da plataforma, sessões de login e conta do Telegram vinculada
    """
    CREATE TABLE users (
        id             TEXT PRIMARY KEY,
        username       TEXT NOT NULL UNIQUE,
        password_hash  TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        last_login_at  TEXT
    );
    CREATE TABLE auth_sessions (
        token_hash    TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at    TEXT NOT NULL,
        last_seen_at  TEXT NOT NULL,
        expires_at    TEXT NOT NULL
    );
    CREATE INDEX auth_sessions_user ON auth_sessions (user_id);
    CREATE TABLE telegram_accounts (
        user_id           TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
        telegram_user_id  INTEGER NOT NULL UNIQUE,
        phone_hmac        TEXT NOT NULL UNIQUE,
        phone_masked      TEXT NOT NULL,
        first_name        TEXT,
        last_name         TEXT,
        username          TEXT,
        linked_at         TEXT NOT NULL
    );
    """,
]


def utcnow(delta: timedelta | None = None) -> str:
    moment = datetime.now(timezone.utc) + (delta or timedelta())
    return moment.isoformat(timespec="milliseconds")


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    def migrate(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            for number, script in enumerate(MIGRATIONS[version:], start=version + 1):
                conn.executescript(f"BEGIN;\n{script}\nPRAGMA user_version = {number};\nCOMMIT;")

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA foreign_keys = ON")
            with conn:  # commit no fim, rollback em erro
                yield conn
        finally:
            conn.close()
