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
    # 3: rastreamento de estudo (docs/metricas-de-estudo.md)
    """
    CREATE TABLE user_preferences (
        user_id     TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
        timezone    TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
    CREATE TABLE study_sessions (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        source            TEXT NOT NULL,
        course_id         TEXT,
        lesson_key        TEXT,
        opened_at         REAL NOT NULL,
        last_activity_at  REAL,
        credited_seconds  REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX study_sessions_user ON study_sessions (user_id, opened_at);
    CREATE TABLE study_segments (
        session_id        TEXT NOT NULL REFERENCES study_sessions (id) ON DELETE CASCADE,
        seq               INTEGER NOT NULL,
        start_ms          INTEGER NOT NULL,
        end_ms            INTEGER NOT NULL,
        media_from        REAL,
        media_to          REAL,
        rate              REAL,
        claimed_seconds   REAL NOT NULL,
        credited_seconds  REAL NOT NULL,
        status            TEXT NOT NULL,
        reason            TEXT,
        received_at       REAL NOT NULL,
        PRIMARY KEY (session_id, seq)
    );
    CREATE TABLE study_intervals (
        id          INTEGER PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        session_id  TEXT NOT NULL REFERENCES study_sessions (id) ON DELETE CASCADE,
        seq         INTEGER NOT NULL,
        source      TEXT NOT NULL,
        start_at    REAL NOT NULL,
        end_at      REAL NOT NULL,
        local_day   TEXT NOT NULL,
        timezone    TEXT NOT NULL
    );
    CREATE INDEX study_intervals_user_time ON study_intervals (user_id, start_at);
    CREATE TABLE study_daily (
        user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        day      TEXT NOT NULL,
        source   TEXT NOT NULL,
        seconds  REAL NOT NULL,
        PRIMARY KEY (user_id, day, source)
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

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Transação com trava de escrita desde o início (`BEGIN IMMEDIATE`).

        Para operações que leem e depois gravam com base no que leram: dois
        pedidos simultâneos são serializados e o segundo enxerga o que o
        primeiro gravou.
        """
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")
        finally:
            conn.close()
