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
    # 4: temporizador de estudos, metas e gamificação (docs/temporizador.md)
    """
    CREATE TABLE focus_methods (
        id                   TEXT PRIMARY KEY,
        user_id              TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        name                 TEXT NOT NULL,
        focus_seconds        INTEGER NOT NULL,
        short_break_seconds  INTEGER NOT NULL,
        long_break_seconds   INTEGER NOT NULL,
        long_break_every     INTEGER,
        cycles               INTEGER NOT NULL,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL,
        deleted_at           TEXT
    );
    CREATE INDEX focus_methods_user ON focus_methods (user_id, deleted_at);
    CREATE TABLE focus_sessions (
        id                   TEXT PRIMARY KEY,
        user_id              TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        technique            TEXT NOT NULL,
        method_id            TEXT,
        method_name          TEXT NOT NULL,
        plan                 TEXT NOT NULL,
        intention            TEXT,
        course_id            TEXT,
        lesson_key           TEXT,
        course_title         TEXT,
        lesson_title         TEXT,
        status               TEXT NOT NULL,
        stage                TEXT NOT NULL,
        phase_index          INTEGER NOT NULL,
        cycle                INTEGER NOT NULL,
        phase_started_at     REAL,
        phase_ends_at        REAL,
        run_started_at       REAL,
        paused_at            REAL,
        phase_focus_seconds  REAL NOT NULL DEFAULT 0,
        phase_pause_seconds  REAL NOT NULL DEFAULT 0,
        focus_seconds        REAL NOT NULL DEFAULT 0,
        break_seconds        REAL NOT NULL DEFAULT 0,
        pause_seconds        REAL NOT NULL DEFAULT 0,
        cycles_completed     INTEGER NOT NULL DEFAULT 0,
        cycles_invalidated   INTEGER NOT NULL DEFAULT 0,
        breaks_completed     INTEGER NOT NULL DEFAULT 0,
        breaks_unlocked      INTEGER NOT NULL DEFAULT 0,
        pending_cycle        INTEGER,
        ledger_seq           INTEGER NOT NULL DEFAULT 0,
        version              INTEGER NOT NULL DEFAULT 1,
        timezone             TEXT NOT NULL,
        started_at           REAL NOT NULL,
        ended_at             REAL,
        end_reason           TEXT,
        xp                   INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX focus_sessions_one_active ON focus_sessions (user_id) WHERE status = 'active';
    CREATE INDEX focus_sessions_user ON focus_sessions (user_id, started_at);
    CREATE TABLE focus_phases (
        session_id       TEXT NOT NULL REFERENCES focus_sessions (id) ON DELETE CASCADE,
        idx              INTEGER NOT NULL,
        stage            TEXT NOT NULL,
        cycle            INTEGER NOT NULL,
        planned_seconds  REAL,
        started_at       REAL NOT NULL,
        ended_at         REAL NOT NULL,
        focus_seconds    REAL NOT NULL DEFAULT 0,
        pause_seconds    REAL NOT NULL DEFAULT 0,
        outcome          TEXT NOT NULL,
        PRIMARY KEY (session_id, idx)
    );
    CREATE TABLE focus_events (
        id          INTEGER PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        session_id  TEXT NOT NULL REFERENCES focus_sessions (id) ON DELETE CASCADE,
        type        TEXT NOT NULL,
        at          REAL NOT NULL,
        request_id  TEXT,
        detail      TEXT
    );
    CREATE UNIQUE INDEX focus_events_request ON focus_events (user_id, request_id) WHERE request_id IS NOT NULL;
    CREATE INDEX focus_events_session ON focus_events (session_id, id);
    CREATE TABLE focus_daily (
        user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        day      TEXT NOT NULL,
        seconds  REAL NOT NULL DEFAULT 0,
        cycles   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
    );
    CREATE TABLE focus_goals (
        user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        period          TEXT NOT NULL,
        target_seconds  INTEGER NOT NULL,
        updated_at      TEXT NOT NULL,
        PRIMARY KEY (user_id, period)
    );
    CREATE TABLE xp_events (
        id      INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        ref     TEXT NOT NULL,
        kind    TEXT NOT NULL,
        xp      INTEGER NOT NULL,
        day     TEXT NOT NULL,
        at      REAL NOT NULL,
        detail  TEXT,
        UNIQUE (user_id, ref)
    );
    CREATE INDEX xp_events_user_day ON xp_events (user_id, day, kind);
    CREATE TABLE user_achievements (
        user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        code         TEXT NOT NULL,
        unlocked_at  REAL NOT NULL,
        PRIMARY KEY (user_id, code)
    );
    CREATE TABLE focus_notices (
        id       INTEGER PRIMARY KEY,
        user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        kind     TEXT NOT NULL,
        payload  TEXT NOT NULL,
        at       REAL NOT NULL
    );
    CREATE INDEX focus_notices_user ON focus_notices (user_id, id);
    CREATE TABLE focus_preferences (
        user_id     TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
        data        TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
    """,
    # 5: Caderno Digital (docs/caderno.md). As anotações por aula (lesson_notes)
    # são convertidas em notas rápidas por `NotebookStore.import_legacy`.
    """
    CREATE TABLE note_folders (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        parent_id   TEXT REFERENCES note_folders (id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        position    REAL NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
    CREATE INDEX note_folders_user ON note_folders (user_id, parent_id);
    CREATE TABLE notes (
        id                 TEXT PRIMARY KEY,
        seq                INTEGER NOT NULL UNIQUE,  -- chave da busca (notes_fts.rowid)
        user_id            TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        kind               TEXT NOT NULL,
        title              TEXT NOT NULL DEFAULT '',
        doc                TEXT NOT NULL,
        text               TEXT NOT NULL DEFAULT '',
        words              INTEGER NOT NULL DEFAULT 0,
        folder_id          TEXT REFERENCES note_folders (id) ON DELETE SET NULL,
        course_id          TEXT,
        section_id         TEXT,
        lesson_key         TEXT,
        timestamp_seconds  REAL,
        favorite           INTEGER NOT NULL DEFAULT 0,
        pinned_at          TEXT,
        archived_at        TEXT,
        deleted_at         TEXT,
        revision           INTEGER NOT NULL DEFAULT 1,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        content_updated_at TEXT NOT NULL,
        opened_at          TEXT
    );
    CREATE INDEX notes_user_updated ON notes (user_id, deleted_at, updated_at);
    CREATE INDEX notes_user_folder ON notes (user_id, folder_id);
    CREATE INDEX notes_user_lesson ON notes (user_id, course_id, lesson_key);
    CREATE VIRTUAL TABLE notes_fts USING fts5 (
        title, body, tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE note_tags (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        color       TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        UNIQUE (user_id, name COLLATE NOCASE)
    );
    CREATE TABLE note_tag_links (
        note_id  TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
        tag_id   TEXT NOT NULL REFERENCES note_tags (id) ON DELETE CASCADE,
        PRIMARY KEY (note_id, tag_id)
    );
    CREATE INDEX note_tag_links_tag ON note_tag_links (tag_id);
    CREATE TABLE note_refs (
        note_id     TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL,
        course_id   TEXT NOT NULL,
        kind        TEXT NOT NULL,
        section_id  TEXT,
        lesson_key  TEXT,
        seconds     REAL
    );
    CREATE INDEX note_refs_note ON note_refs (note_id);
    CREATE INDEX note_refs_target ON note_refs (user_id, course_id, lesson_key);
    CREATE TABLE note_revisions (
        id          INTEGER PRIMARY KEY,
        note_id     TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
        revision    INTEGER NOT NULL,
        title       TEXT NOT NULL,
        doc         TEXT NOT NULL,
        words       INTEGER NOT NULL,
        reason      TEXT NOT NULL,
        created_at  TEXT NOT NULL
    );
    CREATE INDEX note_revisions_note ON note_revisions (note_id, id);
    CREATE TABLE note_files (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        name        TEXT NOT NULL,
        mime        TEXT NOT NULL,
        size        INTEGER NOT NULL,
        sha256      TEXT NOT NULL,
        width       INTEGER,
        height      INTEGER,
        created_at  TEXT NOT NULL
    );
    CREATE INDEX note_files_user ON note_files (user_id, created_at);
    CREATE TABLE note_file_links (
        note_id  TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
        file_id  TEXT NOT NULL REFERENCES note_files (id) ON DELETE CASCADE,
        PRIMARY KEY (note_id, file_id)
    );
    CREATE INDEX note_file_links_file ON note_file_links (file_id);
    """,
    # 6: Minha Rotina (docs/minha-rotina.md). Rotina = modelo; ocorrência = o que
    # foi planejado para uma data; sessão = o que foi executado; log = o que mudou.
    """
    CREATE TABLE routines (
        id                    TEXT PRIMARY KEY,
        user_id               TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        name                  TEXT NOT NULL,
        description           TEXT NOT NULL DEFAULT '',
        icon_key              TEXT,
        color                 TEXT,
        mode                  TEXT NOT NULL,
        preferred_start_time  TEXT,
        status                TEXT NOT NULL,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        archived_at           TEXT,
        deleted_at            TEXT
    );
    CREATE INDEX routines_user ON routines (user_id, deleted_at, status);
    CREATE TABLE routine_schedules (
        id          TEXT PRIMARY KEY,
        routine_id  TEXT NOT NULL UNIQUE REFERENCES routines (id) ON DELETE CASCADE,
        frequency   TEXT NOT NULL DEFAULT 'weekly',
        weekdays    TEXT NOT NULL DEFAULT '',
        starts_on   TEXT NOT NULL,
        ends_on     TEXT,
        timezone    TEXT NOT NULL,
        is_enabled  INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
    CREATE TABLE routine_activities (
        id                TEXT PRIMARY KEY,
        routine_id        TEXT NOT NULL REFERENCES routines (id) ON DELETE CASCADE,
        user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        title             TEXT NOT NULL,
        description       TEXT NOT NULL DEFAULT '',
        icon_key          TEXT,
        color             TEXT,
        duration_minutes  INTEGER,
        preferred_time    TEXT,
        period            TEXT,
        priority          TEXT NOT NULL DEFAULT 'normal',
        is_optional       INTEGER NOT NULL DEFAULT 0,
        notes             TEXT NOT NULL DEFAULT '',
        link_type         TEXT,
        course_id         TEXT,
        section_id        TEXT,
        lesson_key        TEXT,
        position          REAL NOT NULL,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        deleted_at        TEXT
    );
    CREATE INDEX routine_activities_routine ON routine_activities (routine_id, deleted_at, position);
    -- Uma linha por rotina e data em que ela foi aplicada (pela programação ou à mão).
    -- É a chave de idempotência da geração: com a linha, a data nunca é gerada de novo.
    CREATE TABLE routine_days (
        user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        routine_id  TEXT NOT NULL REFERENCES routines (id) ON DELETE CASCADE,
        day         TEXT NOT NULL,
        origin      TEXT NOT NULL,
        status      TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (user_id, routine_id, day)
    );
    CREATE INDEX routine_days_day ON routine_days (user_id, day);
    CREATE TABLE activity_occurrences (
        id                   TEXT PRIMARY KEY,
        user_id              TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        routine_id           TEXT REFERENCES routines (id) ON DELETE SET NULL,
        routine_activity_id  TEXT REFERENCES routine_activities (id) ON DELETE SET NULL,
        origin_date          TEXT,
        scheduled_date       TEXT NOT NULL,
        start_time           TEXT,
        duration_minutes     INTEGER,
        period               TEXT,
        position             REAL NOT NULL,
        title                TEXT NOT NULL,
        description          TEXT NOT NULL DEFAULT '',
        icon_key             TEXT,
        color                TEXT,
        priority             TEXT NOT NULL DEFAULT 'normal',
        is_optional          INTEGER NOT NULL DEFAULT 0,
        notes                TEXT NOT NULL DEFAULT '',
        link_type            TEXT,
        course_id            TEXT,
        section_id           TEXT,
        lesson_key           TEXT,
        status               TEXT NOT NULL,
        source               TEXT NOT NULL,
        customized           INTEGER NOT NULL DEFAULT 0,
        rescheduled_from     TEXT,
        skip_reason          TEXT,
        manual_seconds       INTEGER,
        completed_at         TEXT,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL,
        deleted_at           TEXT
    );
    CREATE INDEX activity_occurrences_day ON activity_occurrences (user_id, scheduled_date, deleted_at);
    CREATE INDEX activity_occurrences_routine ON activity_occurrences (routine_id, scheduled_date);
    CREATE UNIQUE INDEX activity_occurrences_generated
        ON activity_occurrences (user_id, routine_activity_id, origin_date) WHERE routine_activity_id IS NOT NULL;
    CREATE TABLE activity_logs (
        id             INTEGER PRIMARY KEY,
        user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        occurrence_id  TEXT NOT NULL REFERENCES activity_occurrences (id) ON DELETE CASCADE,
        event_type     TEXT NOT NULL,
        event_data     TEXT,
        created_at     TEXT NOT NULL
    );
    CREATE INDEX activity_logs_occurrence ON activity_logs (occurrence_id, id);
    """,
    # 7: o tempo das atividades da rotina passa a vir do cronômetro do Foco. A sessão
    # do Foco guarda qual atividade estava sendo feita; a tabela própria sai.
    """
    DROP TABLE IF EXISTS activity_sessions;
    UPDATE activity_occurrences SET status = 'pending' WHERE status = 'in_progress';
    ALTER TABLE focus_sessions ADD COLUMN activity_id TEXT;
    CREATE INDEX focus_sessions_activity ON focus_sessions (activity_id) WHERE activity_id IS NOT NULL;
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
