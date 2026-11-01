"""Metas de concentração (diária e semanal) e o progresso de cada uma.

O progresso soma o tempo de foco do temporizador (`focus_daily`) no dia local
de hoje, ou de segunda até hoje. Uma meta cumprida gera XP e um aviso uma vez
por período (`rewards.Rewards.goals`). Mudar o alvo depois não apaga uma meta
já cumprida, e uma meta não cumprida não gera cobrança nem penalidade.
"""

from __future__ import annotations

import math
from datetime import date, timedelta

from ..errors import AppError
from ..learning.db import Database, utcnow
from ..study.days import week_start
from .rewards import GOAL_XP

LIMITS = {"daily": (15 * 60, 12 * 3600), "weekly": (60 * 60, 80 * 3600)}
PERIODS = tuple(LIMITS)


class InvalidGoal(AppError):
    def __init__(self, message: str) -> None:
        super().__init__(422, "invalid_goal", message, field="minutes")


def _label(seconds: int) -> str:
    h, m = divmod(seconds // 60, 60)
    return f"{h} h" + (f" {m} min" if m else "") if h else f"{m} min"


class GoalStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    def set(self, user_id: str, period: str, minutes: int | None) -> None:
        if period not in LIMITS:
            raise InvalidGoal("Período desconhecido.")
        with self.db.connect() as conn:
            if minutes is None:
                conn.execute("DELETE FROM focus_goals WHERE user_id = ? AND period = ?", (user_id, period))
                return
            low, high = LIMITS[period]
            seconds = minutes * 60
            if not (low <= seconds <= high):
                raise InvalidGoal(f"Escolha entre {_label(low)} e {_label(high)}.")
            conn.execute(
                "INSERT INTO focus_goals (user_id, period, target_seconds, updated_at) VALUES (?, ?, ?, ?) "
                "ON CONFLICT (user_id, period) DO UPDATE SET target_seconds = excluded.target_seconds, "
                "updated_at = excluded.updated_at",
                (user_id, period, seconds, utcnow()),
            )

    def view(self, user_id: str, today: date) -> dict:
        monday = week_start(today)
        with self.db.connect() as conn:
            targets = {
                r["period"]: r["target_seconds"]
                for r in conn.execute("SELECT period, target_seconds FROM focus_goals WHERE user_id = ?", (user_id,))
            }
            daily = {
                r["day"]: r["seconds"]
                for r in conn.execute(
                    "SELECT day, seconds FROM focus_daily WHERE user_id = ? AND day BETWEEN ? AND ?",
                    (user_id, monday.isoformat(), (monday + timedelta(days=6)).isoformat()),
                )
            }
            achieved = {
                r["ref"]
                for r in conn.execute(
                    "SELECT ref FROM xp_events WHERE user_id = ? AND ref IN (?, ?)",
                    (user_id, f"goal:daily:{today.isoformat()}", f"goal:weekly:{monday.isoformat()}"),
                )
            }
            history = conn.execute(
                "SELECT kind, COUNT(*) AS n FROM xp_events WHERE user_id = ? AND kind IN ('goal_daily', 'goal_weekly') GROUP BY kind",
                (user_id,),
            ).fetchall()
        done = {
            "daily": daily.get(today.isoformat(), 0.0),
            "weekly": sum(daily.values()),
        }
        starts = {"daily": today, "weekly": monday}
        counts = {r["kind"].removeprefix("goal_"): r["n"] for r in history}
        goals = {}
        for period in PERIODS:
            target = targets.get(period)
            seconds = done[period]
            goals[period] = {
                "period": period,
                "target_seconds": target,
                "done_seconds": round(seconds, 1),
                "remaining_seconds": max(0.0, round(target - seconds, 1)) if target else None,
                "percent": min(100, math.floor(seconds * 100 / target)) if target else None,
                "achieved": f"goal:{period}:{starts[period].isoformat()}" in achieved,
                "start": starts[period].isoformat(),
                "times_achieved": counts.get(period, 0),
                "xp": GOAL_XP[period],
                "limits": {"min_minutes": LIMITS[period][0] // 60, "max_minutes": LIMITS[period][1] // 60},
            }
        return goals
