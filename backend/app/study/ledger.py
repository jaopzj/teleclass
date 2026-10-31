"""Livro-razão do tempo de estudo: sessões, trechos relatados e intervalos creditados.

Fluxo de um trecho (ver docs/metricas-de-estudo.md):

1. **Sessão.** O cliente abre uma sessão (id gerado por ele, para que repetir a
   abertura seja inofensivo). O servidor grava o instante da abertura pelo
   próprio relógio (`opened_at`). Esse é o único "relógio de parede" usado.
2. **Trecho.** O cliente relata trechos contínuos de estudo com início e fim
   em milissegundos desde a abertura, medidos com o relógio monotônico do
   navegador (`performance.now()`), e um número de sequência.
3. **Validação.** Duplicados (mesma sessão e sequência) devolvem a resposta já
   gravada. Trechos no futuro, longos demais, de sessões vencidas ou que se
   sobrepõem a outro trecho da mesma sessão são recusados. A origem (vídeo,
   temporizador) decide quanto creditar (`sources.py`).
4. **Ancoragem.** O trecho vira um intervalo real: `opened_at + fim` menos o
   tempo creditado. Como o cliente marca a origem só depois de receber a
   resposta da abertura, o intervalo nunca fica adiantado em relação ao real.
5. **União.** O que já foi creditado ao usuário no mesmo intervalo (outra aba,
   outro dispositivo, outra origem) é descontado: tempo cronológico conta uma
   vez só. Os intervalos do usuário no livro-razão nunca se sobrepõem.
6. **Dia local.** Cada pedaço é dividido na meia-noite do fuso da pessoa e
   somado ao total diário (`study_daily`), que as métricas leem.

Tudo isso acontece numa transação `BEGIN IMMEDIATE`: pedidos simultâneos são
serializados, e uma falha no meio não deixa nada gravado pela metade.
"""

from __future__ import annotations

import sqlite3
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Callable, Iterable

from ..errors import AppError
from ..learning.db import Database
from .days import DEFAULT_TIMEZONE, load_timezone, split_by_day
from .preferences import read_timezone
from .sources import POLICIES, Credit, SegmentClaim, SessionContext, StudySource

# Limites gerais, valem para qualquer origem.
MAX_SEGMENT_SECONDS = 300  # o cliente fecha trechos a cada ~15 s; aba em segundo plano pode atrasar
MAX_SESSION_SECONDS = 12 * 3600  # depois disso o cliente abre outra sessão
MAX_REPORT_DELAY_SECONDS = 7 * 24 * 3600  # trechos guardados no navegador e enviados depois
CLOCK_TOLERANCE_SECONDS = 2.0
MAX_SEGMENTS_PER_REQUEST = 50
# Pedaços menores que isso (restos de sobreposição) não são gravados.
MIN_PIECE_SECONDS = 0.001


class SessionNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "study_session_not_found", "Sessão de estudo não encontrada.")


class SourceUnavailable(AppError):
    def __init__(self) -> None:
        super().__init__(400, "study_source_unavailable", "Esta origem de estudo não está disponível.")


@dataclass(frozen=True, slots=True)
class StudySession:
    id: str
    user_id: str
    source: StudySource
    course_id: str | None
    lesson_key: str | None
    opened_at: float
    credited_seconds: float

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source": self.source.value,
            "course_id": self.course_id,
            "lesson_key": self.lesson_key,
            "opened_at": self.opened_at,
            "credited_seconds": round(self.credited_seconds, 3),
        }


@dataclass(frozen=True, slots=True)
class SegmentResult:
    seq: int
    status: str  # accepted | adjusted | rejected
    credited_seconds: float
    reason: str | None = None
    duplicate: bool = False

    def to_dict(self) -> dict:
        return {
            "seq": self.seq,
            "status": self.status,
            "credited_seconds": round(self.credited_seconds, 3),
            "reason": self.reason,
            "duplicate": self.duplicate,
        }


def _session(row: sqlite3.Row) -> StudySession:
    return StudySession(
        row["id"],
        row["user_id"],
        StudySource(row["source"]),
        row["course_id"],
        row["lesson_key"],
        row["opened_at"],
        row["credited_seconds"],
    )


def _uncovered(start: float, end: float, covered: Iterable[tuple[float, float]]) -> list[tuple[float, float]]:
    """Partes de [start, end) que não estão em nenhum dos intervalos `covered`."""
    pieces: list[tuple[float, float]] = []
    cursor = start
    for c_start, c_end in sorted(covered):
        if c_end <= cursor:
            continue
        if c_start >= end:
            break
        if c_start > cursor:
            pieces.append((cursor, c_start))
        cursor = max(cursor, c_end)
        if cursor >= end:
            break
    if cursor < end:
        pieces.append((cursor, end))
    return [(s, e) for s, e in pieces if e - s >= MIN_PIECE_SECONDS]


class StudyLedger:
    def __init__(self, db: Database, clock: Callable[[], float] = time.time) -> None:
        self.db = db
        self.clock = clock

    # --- sessões ------------------------------------------------------------------

    def open_session(
        self,
        user_id: str,
        session_id: str,
        source: StudySource,
        context: SessionContext,
    ) -> StudySession:
        """Abre a sessão. Repetir a abertura devolve a sessão já gravada."""
        if not POLICIES[source].enabled:
            raise SourceUnavailable()
        with self.db.transaction() as conn:
            row = conn.execute("SELECT * FROM study_sessions WHERE id = ?", (session_id,)).fetchone()
            if row is not None:
                same = (
                    row["user_id"] == user_id
                    and row["source"] == source.value
                    and row["course_id"] == context.course_id
                    and row["lesson_key"] == context.lesson_key
                )
                if not same:  # id de outra pessoa ou de outra aula: não revela nada
                    raise SessionNotFound()
                return _session(row)
            conn.execute(
                "INSERT INTO study_sessions (id, user_id, source, course_id, lesson_key, opened_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, user_id, source.value, context.course_id, context.lesson_key, self.clock()),
            )
            return _session(conn.execute("SELECT * FROM study_sessions WHERE id = ?", (session_id,)).fetchone())

    def get_session(self, user_id: str, session_id: str) -> StudySession:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM study_sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
            ).fetchone()
        if row is None:
            raise SessionNotFound()
        return _session(row)

    # --- trechos ------------------------------------------------------------------

    def record(
        self,
        user_id: str,
        session_id: str,
        claims: list[SegmentClaim],
        context: SessionContext,
    ) -> tuple[StudySession, list[SegmentResult]]:
        results: list[SegmentResult] = []
        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM study_sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
            ).fetchone()
            if row is None:
                raise SessionNotFound()
            session = _session(row)
            policy = POLICIES[session.source]
            tz_name = read_timezone(conn, user_id) or DEFAULT_TIMEZONE
            tz = load_timezone(tz_name)
            now = self.clock()

            for claim in claims:
                stored = conn.execute(
                    "SELECT status, credited_seconds, reason FROM study_segments WHERE session_id = ? AND seq = ?",
                    (session_id, claim.seq),
                ).fetchone()
                if stored is not None:
                    results.append(
                        SegmentResult(claim.seq, stored["status"], stored["credited_seconds"], stored["reason"], True)
                    )
                    continue
                credit = self._check(conn, session, claim, now) if policy.enabled else Credit(0, "source_unavailable")
                if not credit.rejected:
                    credit = self._merge(policy.credit(claim, context), credit)
                credited = 0.0
                if not credit.rejected:
                    end = session.opened_at + claim.end_ms / 1000
                    start = end - credit.seconds
                    credited = self._credit(conn, session, claim.seq, start, end, tz, tz_name)
                    if credited < credit.seconds - MIN_PIECE_SECONDS and credit.reason is None:
                        credit = Credit(credit.seconds, "overlap")  # já contado por outra aba ou origem
                status = "rejected" if credit.rejected else ("accepted" if credit.reason is None else "adjusted")
                conn.execute(
                    "INSERT INTO study_segments (session_id, seq, start_ms, end_ms, media_from, media_to, rate, "
                    "claimed_seconds, credited_seconds, status, reason, received_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        session_id, claim.seq, claim.start_ms, claim.end_ms, claim.media_from, claim.media_to,
                        claim.rate, claim.seconds, credited, status, credit.reason, now,
                    ),
                )
                results.append(SegmentResult(claim.seq, status, credited, credit.reason))

            total = sum(r.credited_seconds for r in results if not r.duplicate)
            conn.execute(
                "UPDATE study_sessions SET credited_seconds = credited_seconds + ?, last_activity_at = ? WHERE id = ?",
                (total, now, session_id),
            )
            session = _session(conn.execute("SELECT * FROM study_sessions WHERE id = ?", (session_id,)).fetchone())
        return session, results

    @staticmethod
    def _merge(by_source: Credit, general: Credit) -> Credit:
        return by_source if by_source.rejected or by_source.seconds < general.seconds else general

    @staticmethod
    def _check(conn: sqlite3.Connection, session: StudySession, claim: SegmentClaim, now: float) -> Credit:
        """Regras gerais, independentes da origem."""
        if claim.start_ms < 0 or claim.end_ms <= claim.start_ms:
            return Credit(0, "invalid_interval")
        if claim.seconds > MAX_SEGMENT_SECONDS:
            return Credit(0, "segment_too_long")
        if claim.end_ms / 1000 > MAX_SESSION_SECONDS:
            return Credit(0, "session_expired")
        end = session.opened_at + claim.end_ms / 1000
        if end > now + CLOCK_TOLERANCE_SECONDS:
            return Credit(0, "in_future")
        if now - end > MAX_REPORT_DELAY_SECONDS:
            return Credit(0, "too_late")
        overlap = conn.execute(
            "SELECT 1 FROM study_segments WHERE session_id = ? AND status != 'rejected' "
            "AND start_ms < ? AND end_ms > ? LIMIT 1",
            (session.id, claim.end_ms, claim.start_ms),
        ).fetchone()
        if overlap:
            return Credit(0, "overlap")
        return Credit(claim.seconds)

    @staticmethod
    def _credit(
        conn: sqlite3.Connection,
        session: StudySession,
        seq: int,
        start: float,
        end: float,
        tz,
        tz_name: str,
    ) -> float:
        """Grava as partes de [start, end) ainda não creditadas ao usuário; devolve o total."""
        covered = conn.execute(
            "SELECT start_at, end_at FROM study_intervals WHERE user_id = ? "
            "AND start_at < ? AND start_at > ? AND end_at > ?",
            (session.user_id, end, start - MAX_SEGMENT_SECONDS - 1, start),
        ).fetchall()
        total = 0.0
        for piece_start, piece_end in _uncovered(start, end, [(r[0], r[1]) for r in covered]):
            for day, day_from, day_to in split_by_day(piece_start, piece_end, tz):
                seconds = day_to - day_from
                if seconds < MIN_PIECE_SECONDS:
                    continue
                conn.execute(
                    "INSERT INTO study_intervals (user_id, session_id, seq, source, start_at, end_at, local_day, timezone) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (session.user_id, session.id, seq, session.source.value, day_from, day_to, day.isoformat(), tz_name),
                )
                conn.execute(
                    "INSERT INTO study_daily (user_id, day, source, seconds) VALUES (?, ?, ?, ?) "
                    "ON CONFLICT (user_id, day, source) DO UPDATE SET seconds = seconds + excluded.seconds",
                    (session.user_id, day.isoformat(), session.source.value, seconds),
                )
                total += seconds
        return total

    # --- tempo medido pelo próprio servidor (temporizador) ------------------------------

    def credit_server_interval(
        self,
        conn: sqlite3.Connection,
        user_id: str,
        session_id: str,
        source: StudySource,
        start: float,
        end: float,
        *,
        course_id: str | None = None,
        lesson_key: str | None = None,
    ) -> float:
        """Credita [start, end) medido pelo relógio do servidor, dentro da transação `conn`.

        Usado pelo temporizador (app/focus): ali os instantes já são do servidor,
        então não há trecho do cliente para validar. Passa pelas mesmas regras de
        união (nada conta duas vezes, nem com um vídeo tocando junto) e de dia
        local. O intervalo é gravado em pedaços de até `MAX_SEGMENT_SECONDS`,
        que é o que a busca de sobreposição pressupõe.
        """
        if end - start < MIN_PIECE_SECONDS:
            return 0.0
        row = conn.execute("SELECT * FROM study_sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO study_sessions (id, user_id, source, course_id, lesson_key, opened_at) VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, user_id, source.value, course_id, lesson_key, start),
            )
            row = conn.execute("SELECT * FROM study_sessions WHERE id = ?", (session_id,)).fetchone()
        session = _session(row)
        if session.user_id != user_id:
            raise SessionNotFound()
        tz_name = read_timezone(conn, user_id) or DEFAULT_TIMEZONE
        tz = load_timezone(tz_name)
        seq = conn.execute(
            "SELECT COALESCE(MAX(seq), -1) + 1 FROM study_segments WHERE session_id = ?", (session_id,)
        ).fetchone()[0]
        total = 0.0
        cursor = start
        while end - cursor >= MIN_PIECE_SECONDS:
            piece_end = min(end, cursor + MAX_SEGMENT_SECONDS)
            credited = self._credit(conn, session, seq, cursor, piece_end, tz, tz_name)
            start_ms = int(round((cursor - session.opened_at) * 1000))
            end_ms = max(start_ms + 1, int(round((piece_end - session.opened_at) * 1000)))
            claimed = piece_end - cursor
            reason = None if credited >= claimed - MIN_PIECE_SECONDS else "overlap"
            conn.execute(
                "INSERT INTO study_segments (session_id, seq, start_ms, end_ms, claimed_seconds, credited_seconds, "
                "status, reason, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (session_id, seq, start_ms, end_ms, claimed, credited, "accepted" if reason is None else "adjusted",
                 reason, end),
            )
            total += credited
            seq += 1
            cursor = piece_end
        conn.execute(
            "UPDATE study_sessions SET credited_seconds = credited_seconds + ?, last_activity_at = ? WHERE id = ?",
            (total, end, session_id),
        )
        return total

    # --- leitura --------------------------------------------------------------------

    def daily_totals(self, user_id: str) -> dict[date, dict[str, float]]:
        """Segundos por dia local e por origem (a partir do consolidado diário)."""
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT day, source, seconds FROM study_daily WHERE user_id = ?", (user_id,)
            ).fetchall()
        totals: dict[date, dict[str, float]] = defaultdict(dict)
        for row in rows:
            totals[date.fromisoformat(row["day"])][row["source"]] = row["seconds"]
        return dict(totals)

    def rebuild_daily(self, user_id: str) -> None:
        """Refaz o consolidado diário a partir do livro-razão (fonte da verdade)."""
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM study_daily WHERE user_id = ?", (user_id,))
            conn.execute(
                "INSERT INTO study_daily (user_id, day, source, seconds) "
                "SELECT user_id, local_day, source, SUM(end_at - start_at) FROM study_intervals "
                "WHERE user_id = ? GROUP BY user_id, local_day, source",
                (user_id,),
            )
