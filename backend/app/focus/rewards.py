"""Gamificação: XP, níveis, títulos e conquistas. Tudo decidido aqui, no servidor.

Regras (docs/temporizador.md, "Gamificação"):

- **XP de foco**: 1 XP por minuto inteiro de concentração em cada etapa de foco
  encerrada, até `DAILY_FOCUS_XP_CAP` por dia. Passar disso não rende mais XP:
  o sistema não premia jornadas excessivas.
- **Ciclo concluído**: +`CYCLE_XP` quando o ciclo é validado (a pausa seguinte
  foi cumprida, ou não havia pausa). Só ciclos com pelo menos
  `CYCLE_MIN_FOCUS_SECONDS` de foco e até `DAILY_CYCLE_BONUS_CAP` por dia.
- **Sessão concluída**: +`SESSION_XP` para sessões que chegaram ao fim do plano
  com pelo menos 25 min de foco.
- **Metas**: diária +`GOAL_XP["daily"]`, semanal +`GOAL_XP["weekly"]`, uma vez por período.
- **Conquistas**: XP conforme a raridade, uma vez.

Cada concessão tem uma referência única por usuário (`xp_events.ref`, ex.:
`cycle:<sessão>:2`). Repetir uma operação, reenviar um pedido ou recalcular um
estado não concede de novo: o `INSERT` é ignorado pela restrição única.
"""

from __future__ import annotations

import json
import math
import sqlite3
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable

from ..study.days import week_start
from ..study.metrics import is_active

DAILY_FOCUS_XP_CAP = 480  # 8 h de foco por dia
CYCLE_XP = 10
CYCLE_MIN_FOCUS_SECONDS = 15 * 60
DAILY_CYCLE_BONUS_CAP = 16
SESSION_XP = 25
SESSION_MIN_FOCUS_SECONDS = 25 * 60
GOAL_XP = {"daily": 30, "weekly": 100}

# --- níveis e títulos -----------------------------------------------------------

TITLES: list[tuple[int, str, str]] = [
    # (nível mínimo, título, descrição curta)
    (1, "Treineiro", "Os primeiros minutos de foco."),
    (3, "Novato", "Já sabe o caminho até o temporizador."),
    (5, "Aprendiz", "O hábito começa a tomar forma."),
    (8, "Dedicado", "Volta todos os dias."),
    (11, "Discípulo", "Estuda com método."),
    (14, "Estudioso", "Concentração já é rotina."),
    (17, "Especialista", "Domina o próprio ritmo."),
    (20, "Veterano", "Centenas de horas de prática."),
    (24, "Mentor", "Constância que serve de exemplo."),
    (28, "Mestre", "O topo da jornada."),
]


def xp_for_level(level: int) -> int:
    """XP acumulado necessário para chegar ao nível (nível 1 = 0 XP)."""
    if level <= 1:
        return 0
    return int(round(60 * (level - 1) ** 1.8 / 10) * 10)


def title_for(level: int) -> tuple[str, str]:
    current = TITLES[0]
    for entry in TITLES:
        if level >= entry[0]:
            current = entry
    return current[1], current[2]


def level_for(xp: int) -> int:
    level = 1
    while xp >= xp_for_level(level + 1):
        level += 1
    return level


def progression(xp: int) -> dict:
    level = level_for(xp)
    floor, ceiling = xp_for_level(level), xp_for_level(level + 1)
    title, description = title_for(level)
    next_title = next(((lvl, name) for lvl, name, _ in TITLES if lvl > level), None)
    return {
        "xp": xp,
        "level": level,
        "title": title,
        "title_description": description,
        "level_xp": floor,
        "next_level_xp": ceiling,
        "into_level": xp - floor,
        "level_span": ceiling - floor,
        "percent": math.floor((xp - floor) * 100 / (ceiling - floor)) if ceiling > floor else 100,
        "next_title": {"level": next_title[0], "title": next_title[1], "xp": xp_for_level(next_title[0])} if next_title else None,
    }


def ladder() -> list[dict]:
    return [
        {"level": lvl, "title": name, "description": desc, "xp": xp_for_level(lvl)} for lvl, name, desc in TITLES
    ]


# --- conquistas -------------------------------------------------------------------

RARITY_XP = {"comum": 20, "incomum": 50, "rara": 100, "épica": 250, "lendária": 500}


@dataclass(frozen=True, slots=True)
class Achievement:
    code: str
    name: str
    description: str
    category: str
    rarity: str
    metric: str
    target: int
    unit: str = "count"  # count | hours | days

    @property
    def xp(self) -> int:
        return RARITY_XP[self.rarity]


ACHIEVEMENTS: list[Achievement] = [
    Achievement("primeira_sessao", "Primeiro passo", "Conclua sua primeira sessão de estudo.", "Sessões", "comum", "sessions_completed", 1),
    Achievement("pomodoro_10", "Tomate maduro", "Complete 10 ciclos Pomodoro.", "Técnicas", "comum", "pomodoro_cycles", 10),
    Achievement("aula_5", "Foco na aula", "Conclua 5 sessões vinculadas a uma aula.", "Cursos", "comum", "lesson_sessions", 5),
    Achievement("metodo_proprio", "Do seu jeito", "Conclua uma sessão com um método criado por você.", "Técnicas", "comum", "custom_sessions", 1),
    Achievement("meta_diaria", "Meta do dia", "Cumpra sua meta diária pela primeira vez.", "Metas", "comum", "daily_goals", 1),
    Achievement("foco_10h", "Dez horas de foco", "Acumule 10 horas de concentração.", "Tempo", "incomum", "focus_hours", 10, "hours"),
    Achievement("sequencia_7", "Semana firme", "Estude 7 dias seguidos.", "Constância", "incomum", "best_streak", 7, "days"),
    Achievement("meta_semanal", "Semana cumprida", "Cumpra sua meta semanal pela primeira vez.", "Metas", "incomum", "weekly_goals", 1),
    Achievement("deep_work_5", "Mergulho profundo", "Conclua 5 sessões de Deep Work.", "Técnicas", "incomum", "deep_work_sessions", 5),
    Achievement("descanso_20", "Descanso respeitado", "Cumpra 20 pausas até o fim.", "Equilíbrio", "incomum", "breaks_completed", 20),
    Achievement("foco_50h", "Cinquenta horas", "Acumule 50 horas de concentração.", "Tempo", "rara", "focus_hours", 50, "hours"),
    Achievement("pomodoro_100", "Horta de tomates", "Complete 100 ciclos Pomodoro.", "Técnicas", "rara", "pomodoro_cycles", 100),
    Achievement("sessoes_50", "Rotina de estudos", "Conclua 50 sessões.", "Sessões", "rara", "sessions_completed", 50),
    Achievement("metas_semanais_8", "Dois meses de metas", "Cumpra a meta semanal 8 vezes.", "Metas", "rara", "weekly_goals", 8),
    Achievement("foco_100h", "Centenário", "Acumule 100 horas de concentração.", "Tempo", "épica", "focus_hours", 100, "hours"),
    Achievement("sequencia_30", "Mês de constância", "Estude 30 dias seguidos.", "Constância", "épica", "best_streak", 30, "days"),
    Achievement("deep_work_25", "Abissal", "Conclua 25 sessões de Deep Work.", "Técnicas", "épica", "deep_work_sessions", 25),
    Achievement("foco_500h", "Quinhentas horas", "Acumule 500 horas de concentração.", "Tempo", "lendária", "focus_hours", 500, "hours"),
]
ACHIEVEMENTS_BY_CODE = {a.code: a for a in ACHIEVEMENTS}


def _best_streak(conn: sqlite3.Connection, user_id: str) -> int:
    """Maior sequência de dias ativos (mesma regra do painel "Seu estudo": vídeo + temporizador)."""
    rows = conn.execute(
        "SELECT day, SUM(seconds) AS s FROM study_daily WHERE user_id = ? GROUP BY day", (user_id,)
    ).fetchall()
    days = sorted(date.fromisoformat(r["day"]) for r in rows if is_active(r["s"]))
    best = run = 0
    last = None
    for day in days:
        run = run + 1 if last is not None and day - last == timedelta(days=1) else 1
        best = max(best, run)
        last = day
    return best


def achievement_metrics(conn: sqlite3.Connection, user_id: str) -> dict[str, float]:
    s = conn.execute(
        """
        SELECT
          SUM(status = 'completed') AS sessions_completed,
          SUM(CASE WHEN technique = 'pomodoro' THEN cycles_completed ELSE 0 END) AS pomodoro_cycles,
          SUM(status = 'completed' AND technique = 'deep_work') AS deep_work_sessions,
          SUM(status = 'completed' AND method_id IS NOT NULL) AS custom_sessions,
          SUM(status = 'completed' AND lesson_key IS NOT NULL) AS lesson_sessions,
          SUM(breaks_completed) AS breaks_completed
        FROM focus_sessions WHERE user_id = ?
        """,
        (user_id,),
    ).fetchone()
    focus = conn.execute("SELECT COALESCE(SUM(seconds), 0) FROM focus_daily WHERE user_id = ?", (user_id,)).fetchone()[0]
    goals = {
        r["kind"]: r["n"]
        for r in conn.execute(
            "SELECT kind, COUNT(*) AS n FROM xp_events WHERE user_id = ? AND kind IN ('goal_daily', 'goal_weekly') GROUP BY kind",
            (user_id,),
        )
    }
    return {
        "sessions_completed": s["sessions_completed"] or 0,
        "pomodoro_cycles": s["pomodoro_cycles"] or 0,
        "deep_work_sessions": s["deep_work_sessions"] or 0,
        "custom_sessions": s["custom_sessions"] or 0,
        "lesson_sessions": s["lesson_sessions"] or 0,
        "breaks_completed": s["breaks_completed"] or 0,
        "focus_hours": focus / 3600,
        "best_streak": _best_streak(conn, user_id),
        "daily_goals": goals.get("goal_daily", 0),
        "weekly_goals": goals.get("goal_weekly", 0),
    }


# --- concessões -----------------------------------------------------------------------


def total_xp(conn: sqlite3.Connection, user_id: str) -> int:
    return conn.execute("SELECT COALESCE(SUM(xp), 0) FROM xp_events WHERE user_id = ?", (user_id,)).fetchone()[0]


def notify(conn: sqlite3.Connection, user_id: str, kind: str, payload: dict, at: float) -> None:
    conn.execute(
        "INSERT INTO focus_notices (user_id, kind, payload, at) VALUES (?, ?, ?, ?)",
        (user_id, kind, json.dumps(payload, ensure_ascii=False), at),
    )


class Rewards:
    """Concede XP e conquistas dentro da transação de quem chama."""

    def __init__(self, conn: sqlite3.Connection, user_id: str, at: float, day_of: Callable[[float], date]) -> None:
        self.conn = conn
        self.user_id = user_id
        self.at = at
        self.day_of = day_of

    def grant(self, ref: str, kind: str, xp: int, *, at: float | None = None, detail: dict | None = None) -> int:
        """Grava a concessão uma vez só. Devolve o XP concedido (0 se já existia)."""
        if xp <= 0:
            return 0
        at = self.at if at is None else at
        before = total_xp(self.conn, self.user_id)
        cursor = self.conn.execute(
            "INSERT OR IGNORE INTO xp_events (user_id, ref, kind, xp, day, at, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (self.user_id, ref, kind, xp, self.day_of(at).isoformat(), at,
             json.dumps(detail, ensure_ascii=False) if detail else None),
        )
        if cursor.rowcount == 0:
            return 0
        old, new = level_for(before), level_for(before + xp)
        if new > old:
            title, _ = title_for(new)
            old_title, _ = title_for(old)
            notify(self.conn, self.user_id, "level_up",
                   {"level": new, "title": title, "new_title": title != old_title}, at)
        return xp

    def _granted_today(self, kind: str, day: date) -> tuple[int, int]:
        row = self.conn.execute(
            "SELECT COALESCE(SUM(xp), 0), COUNT(*) FROM xp_events WHERE user_id = ? AND day = ? AND kind = ?",
            (self.user_id, day.isoformat(), kind),
        ).fetchone()
        return row[0], row[1]

    def focus_time(self, session_id: str, phase: int, seconds: float, at: float) -> int:
        minutes = int(seconds // 60)
        if minutes <= 0:
            return 0
        given, _ = self._granted_today("focus", self.day_of(at))
        xp = min(minutes, max(0, DAILY_FOCUS_XP_CAP - given))
        return self.grant(f"focus:{session_id}:{phase}", "focus", xp, at=at, detail={"minutes": minutes})

    def cycle(self, session_id: str, cycle: int, focus_seconds: float, at: float) -> int:
        if focus_seconds < CYCLE_MIN_FOCUS_SECONDS:
            return 0
        _, count = self._granted_today("cycle", self.day_of(at))
        if count >= DAILY_CYCLE_BONUS_CAP:
            return 0
        return self.grant(f"cycle:{session_id}:{cycle}", "cycle", CYCLE_XP, at=at)

    def session(self, session_id: str, focus_seconds: float, at: float) -> int:
        if focus_seconds < SESSION_MIN_FOCUS_SECONDS:
            return 0
        return self.grant(f"session:{session_id}", "session", SESSION_XP, at=at)

    def goals(self, days: set[date]) -> None:
        """Confere metas diárias e semanais dos dias que receberam foco."""
        targets = {
            r["period"]: r["target_seconds"]
            for r in self.conn.execute("SELECT period, target_seconds FROM focus_goals WHERE user_id = ?", (self.user_id,))
        }
        for day in sorted(days):
            daily = targets.get("daily")
            if daily:
                done = self._focus_between(day, day)
                if done >= daily:
                    self._goal("daily", day, daily)
            weekly = targets.get("weekly")
            if weekly:
                monday = week_start(day)
                done = self._focus_between(monday, monday + timedelta(days=6))
                if done >= weekly:
                    self._goal("weekly", monday, weekly)

    def _goal(self, period: str, start: date, target: int) -> None:
        ref = f"goal:{period}:{start.isoformat()}"
        if self.grant(ref, f"goal_{period}", GOAL_XP[period], detail={"target_seconds": target, "start": start.isoformat()}):
            notify(self.conn, self.user_id, "goal_reached",
                   {"period": period, "target_seconds": target, "start": start.isoformat(), "xp": GOAL_XP[period]}, self.at)

    def _focus_between(self, first: date, last: date) -> float:
        return self.conn.execute(
            "SELECT COALESCE(SUM(seconds), 0) FROM focus_daily WHERE user_id = ? AND day BETWEEN ? AND ?",
            (self.user_id, first.isoformat(), last.isoformat()),
        ).fetchone()[0]

    def achievements(self) -> None:
        unlocked = {
            r[0] for r in self.conn.execute("SELECT code FROM user_achievements WHERE user_id = ?", (self.user_id,))
        }
        pending = [a for a in ACHIEVEMENTS if a.code not in unlocked]
        if not pending:
            return
        metrics = achievement_metrics(self.conn, self.user_id)
        for achievement in pending:
            if metrics[achievement.metric] >= achievement.target:
                self.conn.execute(
                    "INSERT OR IGNORE INTO user_achievements (user_id, code, unlocked_at) VALUES (?, ?, ?)",
                    (self.user_id, achievement.code, self.at),
                )
                notify(self.conn, self.user_id, "achievement_unlocked",
                       {"code": achievement.code, "name": achievement.name, "rarity": achievement.rarity, "xp": achievement.xp},
                       self.at)
                self.grant(f"achievement:{achievement.code}", "achievement", achievement.xp)


def achievements_view(conn: sqlite3.Connection, user_id: str) -> list[dict]:
    unlocked = {
        r["code"]: r["unlocked_at"]
        for r in conn.execute("SELECT code, unlocked_at FROM user_achievements WHERE user_id = ?", (user_id,))
    }
    metrics = achievement_metrics(conn, user_id)
    items = []
    for a in ACHIEVEMENTS:
        current = metrics[a.metric]
        items.append(
            {
                "code": a.code,
                "name": a.name,
                "description": a.description,
                "category": a.category,
                "rarity": a.rarity,
                "xp": a.xp,
                "target": a.target,
                "unit": a.unit,
                "current": round(min(current, a.target), 2) if a.unit == "hours" else int(min(current, a.target)),
                "unlocked_at": unlocked.get(a.code),
            }
        )
    return items
