"""Sessões do temporizador: estado guardado no servidor e derivado dos instantes.

O servidor é a fonte da verdade. Uma sessão guarda instantes do relógio do
servidor (`phase_started_at`, `phase_ends_at`, `run_started_at`, `paused_at`)
e nenhum processo roda a cada segundo: sempre que alguém consulta ou altera a
sessão, `_advance` "alcança" o presente aplicando, em ordem, as transições que
já deveriam ter acontecido (fim do foco no instante `phase_ends_at`, fim da
pausa, sessão esquecida). O resultado é o mesmo se a consulta vier um segundo
ou três horas depois, de qualquer dispositivo.

Estados (`stage`):

    focus ──fim──▶ short_break | long_break ──fim──▶ ready ──start_next──▶ focus
      │  ▲                │                            │
    pause resume       unlock (cancela a pausa,      (30 min sem começar:
      ▼  │              invalida o ciclo)             sessão expira)
    focus (pausado; 45 min pausado: expira)

Regras de contabilização (docs/temporizador.md):

- Tempo de foco é creditado no livro-razão do estudo (`StudyLedger`) a cada
  trecho sem pausa, com instantes do servidor. Pausas e descansos não contam.
- Um ciclo de foco só é **concluído** quando a pausa seguinte é cumprida (ou
  quando não há pausa depois dele). Desbloquear a pausa antes da hora invalida
  aquele ciclo; o tempo de foco já registrado, os ciclos anteriores e o XP já
  concedido continuam valendo.
- Uma sessão por usuário: índice único parcial (`status = 'active'`).
- Toda alteração roda numa transação `BEGIN IMMEDIATE`, traz um `request_id`
  (repetir o mesmo pedido devolve o estado atual sem aplicar de novo) e a
  `version` que o cliente viu (outra aba ou dispositivo alterou antes: 409).
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Callable

from ..errors import AppError
from ..learning.db import Database
from ..study.days import DEFAULT_TIMEZONE, load_timezone, local_day, split_by_day
from ..study.ledger import StudyLedger
from ..study.preferences import read_timezone
from ..study.sources import StudySource
from .plans import STOPWATCH_LIMIT_SECONDS, Plan, Stage, Technique
from .rewards import Rewards, notify

READY_TIMEOUT_SECONDS = 30 * 60  # pausa terminou e o próximo ciclo não começou
PAUSE_TIMEOUT_SECONDS = 45 * 60  # foco pausado por tempo demais
INTENTION_MAX = 140

BREAKS = (Stage.SHORT_BREAK.value, Stage.LONG_BREAK.value)
READY = "ready"
ENDED = "ended"


class FocusError(AppError):
    pass


class SessionActive(FocusError):
    def __init__(self, state: dict) -> None:
        super().__init__(409, "focus_session_active", "Já existe uma sessão em andamento.", extra={"state": state})


class SessionNotFound(FocusError):
    def __init__(self) -> None:
        super().__init__(404, "focus_session_not_found", "Sessão não encontrada ou já encerrada.")


class VersionConflict(FocusError):
    def __init__(self, state: dict) -> None:
        super().__init__(
            409, "focus_conflict", "A sessão mudou em outro lugar. O estado foi atualizado.", extra={"state": state}
        )


class InvalidTransition(FocusError):
    def __init__(self, message: str, state: dict) -> None:
        super().__init__(409, "focus_invalid_transition", message, extra={"state": state})


class ConfirmationRequired(FocusError):
    def __init__(self) -> None:
        super().__init__(
            422,
            "focus_confirmation_required",
            "Sair da pausa antes da hora invalida a conclusão deste ciclo. Confirme para continuar.",
        )


@dataclass(slots=True)
class Target:
    """O que a sessão estuda (já validado contra a biblioteca do usuário)."""

    course_id: str | None = None
    lesson_key: str | None = None
    course_title: str | None = None
    lesson_title: str | None = None


@dataclass(slots=True)
class _Ctx:
    conn: sqlite3.Connection
    user_id: str
    now: float
    tz_name: str
    rewards: Rewards
    days: set[date] = field(default_factory=set)
    changed: bool = False


ACTIONS = {"pause", "resume", "start_next", "unlock_break", "stop"}


class FocusService:
    def __init__(self, db: Database, ledger: StudyLedger, clock: Callable[[], float] = time.time) -> None:
        self.db = db
        self.ledger = ledger
        self.clock = clock

    # --- leitura ----------------------------------------------------------------

    def state(self, user_id: str) -> dict:
        """Estado atual (aplicando as transições pendentes)."""
        with self.db.transaction() as conn:
            ctx = self._ctx(conn, user_id)
            session = self._active(ctx)
            return self._snapshot(ctx, session)

    def sync(self, user_id: str) -> None:
        """Aplica transições pendentes antes de ler histórico, metas ou estatísticas."""
        self.state(user_id)

    def is_resting(self, user_id: str) -> bool:
        """O usuário está numa pausa programada agora? Leitura rápida; só grava se há transição pendente."""
        now = self.clock()
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT stage, phase_ends_at FROM focus_sessions WHERE user_id = ? AND status = 'active'", (user_id,)
            ).fetchone()
        if row is None or row["phase_ends_at"] is None:
            return False
        if row["stage"] in BREAKS and now < row["phase_ends_at"]:
            return True
        if row["stage"] == Stage.FOCUS.value and now >= row["phase_ends_at"]:
            # O foco já acabou, mas ninguém consultou ainda: aplica a transição e confere de novo.
            return bool(self.state(user_id)["locked"])
        return False

    # --- alterações ----------------------------------------------------------------

    def start(
        self,
        user_id: str,
        request_id: str,
        plan: Plan,
        *,
        method_id: str | None,
        method_name: str,
        intention: str | None,
        target: Target,
    ) -> dict:
        with self.db.transaction() as conn:
            ctx = self._ctx(conn, user_id)
            if self._replayed(ctx, request_id):
                return self._snapshot(ctx, self._active(ctx), replayed=True)
            current = self._active(ctx)
            if current is not None:
                raise SessionActive(self._snapshot(ctx, current))
            session_id = str(uuid.uuid4())
            now = ctx.now
            ends = None if plan.is_stopwatch else now + plan.focus_seconds
            conn.execute(
                """
                INSERT INTO focus_sessions (
                    id, user_id, technique, method_id, method_name, plan, intention, course_id, lesson_key,
                    course_title, lesson_title, status, stage, phase_index, cycle, phase_started_at, phase_ends_at,
                    run_started_at, timezone, started_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'focus', 0, 1, ?, ?, ?, ?, ?)
                """,
                (
                    session_id, user_id, plan.technique.value, method_id, method_name, json.dumps(plan.to_dict()),
                    (intention or "").strip()[:INTENTION_MAX] or None, target.course_id, target.lesson_key,
                    target.course_title, target.lesson_title, now, ends, now, ctx.tz_name, now,
                ),
            )
            self._event(ctx, session_id, "start", request_id, {"technique": plan.technique.value})
            return self._snapshot(ctx, self._load(conn, session_id))

    def act(
        self,
        user_id: str,
        session_id: str,
        action: str,
        request_id: str,
        version: int,
        *,
        confirm: bool = False,
    ) -> dict:
        if action not in ACTIONS:
            raise FocusError(422, "focus_unknown_action", "Ação desconhecida.")
        with self.db.transaction() as conn:
            ctx = self._ctx(conn, user_id)
            if self._replayed(ctx, request_id):
                return self._snapshot(ctx, self._active(ctx), replayed=True)
            row = conn.execute(
                "SELECT * FROM focus_sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
            ).fetchone()
            if row is None:
                raise SessionNotFound()
            s = dict(row)
            seen_version = s["version"]
            if s["status"] == "active":
                self._advance(ctx, s)
                self._save(ctx, s)
            if s["status"] != "active":
                raise InvalidTransition("Esta sessão já terminou.", self._snapshot(ctx, None))
            if seen_version != version:
                raise VersionConflict(self._snapshot(ctx, s))
            getattr(self, f"_do_{action}")(ctx, s, confirm)
            ctx.changed = True
            self._event(ctx, session_id, action, request_id, None)
            self._save(ctx, s)
            active = s if s["status"] == "active" else None
            return self._snapshot(ctx, active, ended=None if active else self._summary(s))

    # --- ações -------------------------------------------------------------------------

    def _do_pause(self, ctx: _Ctx, s: dict, confirm: bool) -> None:
        if s["stage"] != Stage.FOCUS.value or s["paused_at"] is not None:
            raise InvalidTransition("Só é possível pausar durante a concentração.", self._snapshot(ctx, s))
        self._close_run(ctx, s, ctx.now)
        s["paused_at"] = ctx.now

    def _do_resume(self, ctx: _Ctx, s: dict, confirm: bool) -> None:
        if s["stage"] != Stage.FOCUS.value or s["paused_at"] is None:
            raise InvalidTransition("A sessão não está pausada.", self._snapshot(ctx, s))
        paused = ctx.now - s["paused_at"]
        s["phase_pause_seconds"] += paused
        s["pause_seconds"] += paused
        if s["phase_ends_at"] is not None:
            s["phase_ends_at"] += paused
        s["paused_at"] = None
        s["run_started_at"] = ctx.now

    def _do_start_next(self, ctx: _Ctx, s: dict, confirm: bool) -> None:
        if s["stage"] != READY:
            raise InvalidTransition("O próximo ciclo ainda não pode começar.", self._snapshot(ctx, s))
        plan = _plan(s)
        s.update(stage=Stage.FOCUS.value, phase_started_at=ctx.now, phase_ends_at=ctx.now + plan.focus_seconds,
                 run_started_at=ctx.now, paused_at=None, phase_focus_seconds=0, phase_pause_seconds=0)

    def _do_unlock_break(self, ctx: _Ctx, s: dict, confirm: bool) -> None:
        if s["stage"] not in BREAKS:
            raise InvalidTransition("Não há pausa em andamento.", self._snapshot(ctx, s))
        if not confirm:
            raise ConfirmationRequired()
        self._unlock(ctx, s)

    def _do_stop(self, ctx: _Ctx, s: dict, confirm: bool) -> None:
        plan = _plan(s)
        if s["stage"] in BREAKS:
            if not confirm:
                raise ConfirmationRequired()
            self._unlock(ctx, s)
            if s["status"] != "active":
                return
        if s["stage"] == Stage.FOCUS.value:
            end = s["paused_at"] if s["paused_at"] is not None else ctx.now
            self._close_run(ctx, s, end)
            if s["paused_at"] is not None:
                s["phase_pause_seconds"] += ctx.now - s["paused_at"]
                s["pause_seconds"] += ctx.now - s["paused_at"]
            if plan.is_stopwatch:
                self._finish_phase(ctx, s, ctx.now, "completed")
                self._end(ctx, s, ctx.now, "completed" if s["focus_seconds"] >= 60 else "stopped", "user")
                return
            self._finish_phase(ctx, s, ctx.now, "stopped")
        self._end(ctx, s, ctx.now, "stopped", "user")

    # --- motor de transições ------------------------------------------------------------

    def _advance(self, ctx: _Ctx, s: dict) -> None:
        """Aplica, em ordem, tudo o que já deveria ter acontecido até `ctx.now`."""
        plan = _plan(s)
        for _ in range(4 * 12 + 4):  # cada volta consome uma etapa; o limite só protege contra laço
            if s["status"] != "active":
                return
            now = ctx.now
            stage = s["stage"]
            if stage == Stage.FOCUS.value:
                if s["paused_at"] is not None:
                    if now - s["paused_at"] >= PAUSE_TIMEOUT_SECONDS:
                        end = s["paused_at"] + PAUSE_TIMEOUT_SECONDS
                        s["phase_pause_seconds"] += PAUSE_TIMEOUT_SECONDS
                        s["pause_seconds"] += PAUSE_TIMEOUT_SECONDS
                        self._finish_phase(ctx, s, end, "expired")
                        self._end(ctx, s, end, "expired", "paused_too_long")
                        continue
                    return
                if plan.is_stopwatch:
                    limit_at = s["run_started_at"] + (STOPWATCH_LIMIT_SECONDS - s["phase_focus_seconds"])
                    if now >= limit_at:
                        self._close_run(ctx, s, limit_at)
                        self._finish_phase(ctx, s, limit_at, "completed")
                        self._end(ctx, s, limit_at, "completed", "limit")
                        continue
                    return
                if now < s["phase_ends_at"]:
                    return
                self._focus_done(ctx, s, plan, s["phase_ends_at"])
            elif stage in BREAKS:
                if now < s["phase_ends_at"]:
                    return
                self._break_done(ctx, s, plan, s["phase_ends_at"])
            elif stage == READY:
                if now - s["phase_started_at"] < READY_TIMEOUT_SECONDS:
                    return
                self._end(ctx, s, s["phase_started_at"], "expired", "not_resumed")
            else:
                return

    def _focus_done(self, ctx: _Ctx, s: dict, plan: Plan, at: float) -> None:
        cycle = s["cycle"]
        self._close_run(ctx, s, at)
        focus_in_phase = s["phase_focus_seconds"]
        self._finish_phase(ctx, s, at, "completed")
        pause = plan.break_after(cycle)
        if pause:
            stage, seconds = pause
            s.update(stage=stage.value, phase_started_at=at, phase_ends_at=at + seconds, pending_cycle=cycle)
            notify(ctx.conn, ctx.user_id, "focus_completed",
                   {"session_id": s["id"], "cycle": cycle, "break": stage.value, "break_seconds": seconds}, at)
            return
        self._validate_cycle(ctx, s, cycle, focus_in_phase, at)
        if cycle < plan.cycles:
            self._ready(s, at, cycle + 1)
            notify(ctx.conn, ctx.user_id, "focus_completed", {"session_id": s["id"], "cycle": cycle, "break": None}, at)
        else:
            self._end(ctx, s, at, "completed", "plan_done")

    def _break_done(self, ctx: _Ctx, s: dict, plan: Plan, at: float) -> None:
        s["break_seconds"] += at - s["phase_started_at"]
        s["breaks_completed"] += 1
        self._finish_phase(ctx, s, at, "completed")
        cycle = s["pending_cycle"] or s["cycle"]
        focus = ctx.conn.execute(
            "SELECT focus_seconds FROM focus_phases WHERE session_id = ? AND stage = 'focus' AND cycle = ? "
            "ORDER BY idx DESC LIMIT 1",
            (s["id"], cycle),
        ).fetchone()
        self._validate_cycle(ctx, s, cycle, focus[0] if focus else 0, at)
        s["pending_cycle"] = None
        if cycle < plan.cycles:
            self._ready(s, at, cycle + 1)
            notify(ctx.conn, ctx.user_id, "break_completed", {"session_id": s["id"], "next_cycle": cycle + 1}, at)
        else:
            self._end(ctx, s, at, "completed", "plan_done")

    def _unlock(self, ctx: _Ctx, s: dict) -> None:
        """Sai da pausa antes da hora: cancela a pausa e invalida o ciclo que ela fechava."""
        plan = _plan(s)
        now = ctx.now
        s["break_seconds"] += max(0.0, now - s["phase_started_at"])
        s["breaks_unlocked"] += 1
        self._finish_phase(ctx, s, now, "unlocked")
        cycle = s["pending_cycle"] or s["cycle"]
        ctx.conn.execute(
            "UPDATE focus_phases SET outcome = 'invalidated' WHERE session_id = ? AND stage = 'focus' AND cycle = ?",
            (s["id"], cycle),
        )
        s["cycles_invalidated"] += 1
        s["pending_cycle"] = None
        if cycle < plan.cycles:
            self._ready(s, now, cycle + 1)
        else:
            self._end(ctx, s, now, "stopped", "break_unlocked")

    @staticmethod
    def _ready(s: dict, at: float, next_cycle: int) -> None:
        s.update(stage=READY, cycle=next_cycle, phase_started_at=at, phase_ends_at=None, run_started_at=None,
                 paused_at=None, phase_focus_seconds=0, phase_pause_seconds=0)

    def _validate_cycle(self, ctx: _Ctx, s: dict, cycle: int, focus_seconds: float, at: float) -> None:
        s["cycles_completed"] += 1
        day = local_day(at, load_timezone(ctx.tz_name)).isoformat()
        ctx.conn.execute(
            "INSERT INTO focus_daily (user_id, day, seconds, cycles) VALUES (?, ?, 0, 1) "
            "ON CONFLICT (user_id, day) DO UPDATE SET cycles = cycles + 1",
            (ctx.user_id, day),
        )
        s["xp"] += ctx.rewards.cycle(s["id"], cycle, focus_seconds, at)

    def _close_run(self, ctx: _Ctx, s: dict, end: float) -> None:
        """Fecha o trecho de foco sem pausa e credita [início, fim) no livro-razão e no total diário."""
        start = s["run_started_at"]
        s["run_started_at"] = None
        if start is None or end <= start:
            return
        seconds = end - start
        s["phase_focus_seconds"] += seconds
        s["focus_seconds"] += seconds
        self.ledger.credit_server_interval(
            ctx.conn, ctx.user_id, s["id"], StudySource.TIMER, start, end,
            course_id=s["course_id"], lesson_key=s["lesson_key"],
        )
        tz = load_timezone(ctx.tz_name)
        for day, a, b in split_by_day(start, end, tz):
            ctx.days.add(day)
            ctx.conn.execute(
                "INSERT INTO focus_daily (user_id, day, seconds) VALUES (?, ?, ?) "
                "ON CONFLICT (user_id, day) DO UPDATE SET seconds = seconds + excluded.seconds",
                (ctx.user_id, day.isoformat(), b - a),
            )

    def _finish_phase(self, ctx: _Ctx, s: dict, end: float, outcome: str) -> None:
        plan = _plan(s)
        stage = s["stage"]
        planned = None
        if stage == Stage.FOCUS.value:
            planned = plan.focus_seconds
        elif stage in BREAKS:
            planned = s["phase_ends_at"] - s["phase_started_at"] if s["phase_ends_at"] else None
        ctx.conn.execute(
            "INSERT INTO focus_phases (session_id, idx, stage, cycle, planned_seconds, started_at, ended_at, "
            "focus_seconds, pause_seconds, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (s["id"], s["phase_index"], stage, s["pending_cycle"] or s["cycle"], planned, s["phase_started_at"], end,
             s["phase_focus_seconds"] if stage == Stage.FOCUS.value else 0, s["phase_pause_seconds"], outcome),
        )
        if stage == Stage.FOCUS.value:
            s["xp"] += ctx.rewards.focus_time(s["id"], s["phase_index"], s["phase_focus_seconds"], end)
        s["phase_index"] += 1
        s.update(phase_focus_seconds=0, phase_pause_seconds=0, paused_at=None, run_started_at=None)
        ctx.changed = True

    def _end(self, ctx: _Ctx, s: dict, at: float, status: str, reason: str) -> None:
        s.update(status=status, stage=ENDED, ended_at=at, end_reason=reason, phase_ends_at=None,
                 run_started_at=None, paused_at=None, pending_cycle=None)
        if status == "completed":
            s["xp"] += ctx.rewards.session(s["id"], s["focus_seconds"], at)
        notify(ctx.conn, ctx.user_id, "session_ended", self._summary(s), at)
        ctx.changed = True

    # --- persistência ---------------------------------------------------------------------

    def _ctx(self, conn: sqlite3.Connection, user_id: str) -> _Ctx:
        tz_name = read_timezone(conn, user_id) or DEFAULT_TIMEZONE
        tz = load_timezone(tz_name)
        now = self.clock()
        return _Ctx(conn, user_id, now, tz_name, Rewards(conn, user_id, now, lambda t: local_day(t, tz)))

    def _active(self, ctx: _Ctx) -> dict | None:
        row = ctx.conn.execute(
            "SELECT * FROM focus_sessions WHERE user_id = ? AND status = 'active'", (ctx.user_id,)
        ).fetchone()
        if row is None:
            return None
        s = dict(row)
        self._advance(ctx, s)
        self._save(ctx, s)
        return s if s["status"] == "active" else None

    def _save(self, ctx: _Ctx, s: dict) -> None:
        if not ctx.changed and not self._dirty(ctx.conn, s):
            return
        s["version"] += 1
        columns = [k for k in s if k not in ("id", "user_id")]
        ctx.conn.execute(
            f"UPDATE focus_sessions SET {', '.join(f'{c} = ?' for c in columns)} WHERE id = ?",
            [s[c] for c in columns] + [s["id"]],
        )
        if ctx.days:
            ctx.rewards.goals(ctx.days)
        ctx.rewards.achievements()
        ctx.changed = False
        ctx.days = set()

    @staticmethod
    def _dirty(conn: sqlite3.Connection, s: dict) -> bool:
        row = conn.execute("SELECT * FROM focus_sessions WHERE id = ?", (s["id"],)).fetchone()
        return any(row[k] != v for k, v in s.items() if k != "version")

    @staticmethod
    def _load(conn: sqlite3.Connection, session_id: str) -> dict:
        return dict(conn.execute("SELECT * FROM focus_sessions WHERE id = ?", (session_id,)).fetchone())

    @staticmethod
    def _replayed(ctx: _Ctx, request_id: str) -> bool:
        return ctx.conn.execute(
            "SELECT 1 FROM focus_events WHERE user_id = ? AND request_id = ?", (ctx.user_id, request_id)
        ).fetchone() is not None

    @staticmethod
    def _event(ctx: _Ctx, session_id: str, kind: str, request_id: str | None, detail: dict | None) -> None:
        ctx.conn.execute(
            "INSERT INTO focus_events (user_id, session_id, type, at, request_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
            (ctx.user_id, session_id, kind, ctx.now, request_id, json.dumps(detail) if detail else None),
        )

    # --- serialização ------------------------------------------------------------------------

    def _snapshot(self, ctx: _Ctx, s: dict | None, *, replayed: bool = False, ended: dict | None = None) -> dict:
        return {
            "server_now": ctx.now,
            "session": _session_view(s) if s else None,
            "locked": bool(s and s["stage"] in BREAKS),
            "replayed": replayed,
            "ended": ended,
        }

    @staticmethod
    def _summary(s: dict) -> dict:
        return {
            "session_id": s["id"],
            "status": s["status"],
            "end_reason": s["end_reason"],
            "technique": s["technique"],
            "method_name": s["method_name"],
            "focus_seconds": round(s["focus_seconds"], 1),
            "cycles_completed": s["cycles_completed"],
            "cycles_invalidated": s["cycles_invalidated"],
            "xp": s["xp"],
        }


def _plan(s: dict) -> Plan:
    return Plan.from_dict(json.loads(s["plan"]))


def _session_view(s: dict) -> dict:
    plan = _plan(s)
    stage = s["stage"]
    running = stage == Stage.FOCUS.value and s["paused_at"] is None
    view = {
        "id": s["id"],
        "version": s["version"],
        "technique": s["technique"],
        "method_id": s["method_id"],
        "method_name": s["method_name"],
        "plan": plan.to_dict(),
        "timeline": plan.timeline(),
        "intention": s["intention"],
        "course": {"id": s["course_id"], "title": s["course_title"]} if s["course_id"] else None,
        "lesson": {"key": s["lesson_key"], "title": s["lesson_title"]} if s["lesson_key"] else None,
        "status": s["status"],
        "stage": stage,
        "paused": s["paused_at"] is not None,
        "running": running,
        "cycle": s["pending_cycle"] or s["cycle"],
        "cycles_total": plan.cycles,
        "cycles_completed": s["cycles_completed"],
        "cycles_invalidated": s["cycles_invalidated"],
        "phase_index": s["phase_index"],
        "phase_started_at": s["phase_started_at"],
        "phase_ends_at": s["phase_ends_at"],
        "run_started_at": s["run_started_at"],
        "paused_at": s["paused_at"],
        "phase_focus_seconds": round(s["phase_focus_seconds"], 3),
        "focus_seconds": round(s["focus_seconds"], 3),
        "break_seconds": round(s["break_seconds"], 3),
        "started_at": s["started_at"],
        "xp": s["xp"],
        "next": None,
        "deadline_at": None,  # instante em que o servidor encerra a sessão por inatividade ou limite
    }
    if stage == READY:
        view["deadline_at"] = s["phase_started_at"] + READY_TIMEOUT_SECONDS
    elif stage == Stage.FOCUS.value and s["paused_at"] is not None:
        view["deadline_at"] = s["paused_at"] + PAUSE_TIMEOUT_SECONDS
    elif stage == Stage.FOCUS.value and plan.is_stopwatch and s["run_started_at"] is not None:
        view["deadline_at"] = s["run_started_at"] + STOPWATCH_LIMIT_SECONDS - s["phase_focus_seconds"]
    # Próxima etapa, para a interface ("Depois: pausa de 5 min").
    cycle = view["cycle"]
    if stage == Stage.FOCUS.value and not plan.is_stopwatch:
        pause = plan.break_after(cycle)
        view["next"] = (
            {"stage": pause[0].value, "seconds": pause[1], "cycle": cycle}
            if pause
            else ({"stage": "focus", "seconds": plan.focus_seconds, "cycle": cycle + 1} if cycle < plan.cycles else {"stage": "end"})
        )
    elif stage in BREAKS:
        view["next"] = {"stage": "focus", "seconds": plan.focus_seconds, "cycle": cycle + 1} if cycle < plan.cycles else {"stage": "end"}
    elif stage == READY:
        view["next"] = {"stage": "focus", "seconds": plan.focus_seconds, "cycle": cycle}
    return view
