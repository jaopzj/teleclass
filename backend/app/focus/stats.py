"""Histórico de sessões e estatísticas de produtividade do temporizador.

Fontes:

- `focus_daily`: segundos de foco e ciclos concluídos por dia local. É a base
  de totais, séries, calendário e metas, porque já está dividida por dia (uma
  sessão que atravessa a meia-noite conta nos dois dias).
- `focus_sessions` e `focus_phases`: contagem de sessões, média, melhor sessão,
  distribuição por curso, aula, técnica e horário. Aqui a sessão entra no
  período pelo dia em que começou.

"Dia ativo" usa a mesma regra do painel "Seu estudo" (10 min ou mais).
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import date, datetime, timedelta

from ..learning.db import Database
from ..study.days import day_start, load_timezone, week_start
from ..study.metrics import ACTIVE_DAY_SECONDS
from .plans import PRESETS, Technique

RANGES = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}
HISTORY_PAGE = 20
HEATMAP_WEEKS = 53


def _technique_name(technique: str, method_name: str | None = None) -> str:
    try:
        return PRESETS[Technique(technique)].name
    except ValueError:
        return method_name or technique


def history_item(row) -> dict:
    return {
        "id": row["id"],
        "technique": row["technique"],
        "technique_name": _technique_name(row["technique"]),
        "method_name": row["method_name"],
        "custom_method": row["method_id"] is not None,
        "intention": row["intention"],
        "course": {"id": row["course_id"], "title": row["course_title"]} if row["course_id"] else None,
        "lesson": {"key": row["lesson_key"], "title": row["lesson_title"]} if row["lesson_key"] else None,
        "status": row["status"],
        "end_reason": row["end_reason"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "focus_seconds": round(row["focus_seconds"], 1),
        "break_seconds": round(row["break_seconds"], 1),
        "pause_seconds": round(row["pause_seconds"], 1),
        "total_seconds": round((row["ended_at"] or row["started_at"]) - row["started_at"], 1),
        "cycles_completed": row["cycles_completed"],
        "cycles_invalidated": row["cycles_invalidated"],
        "breaks_completed": row["breaks_completed"],
        "breaks_unlocked": row["breaks_unlocked"],
        "xp": row["xp"],
    }


class FocusStats:
    def __init__(self, db: Database) -> None:
        self.db = db

    # --- histórico -----------------------------------------------------------------

    def history(self, user_id: str, before: float | None = None, technique: str | None = None,
                course_id: str | None = None) -> dict:
        sql = "SELECT * FROM focus_sessions WHERE user_id = ? AND status != 'active'"
        args: list = [user_id]
        if before is not None:
            sql += " AND started_at < ?"
            args.append(before)
        if technique:
            sql += " AND technique = ?"
            args.append(technique)
        if course_id:
            sql += " AND course_id = ?"
            args.append(course_id)
        sql += " ORDER BY started_at DESC LIMIT ?"
        args.append(HISTORY_PAGE + 1)
        with self.db.connect() as conn:
            rows = conn.execute(sql, args).fetchall()
            courses = conn.execute(
                "SELECT course_id, MAX(course_title) AS title FROM focus_sessions WHERE user_id = ? AND course_id IS NOT NULL "
                "GROUP BY course_id ORDER BY title",
                (user_id,),
            ).fetchall()
        more = len(rows) > HISTORY_PAGE
        rows = rows[:HISTORY_PAGE]
        items = []
        for row in rows:
            item = history_item(row)
            item["plan"] = json.loads(row["plan"])
            item["cycles_total"] = item["plan"].get("cycles", 1)
            items.append(item)
        return {
            "items": items,
            "next_before": rows[-1]["started_at"] if more and rows else None,
            "courses": [{"id": c["course_id"], "title": c["title"]} for c in courses],
        }

    def session_detail(self, user_id: str, session_id: str) -> dict | None:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM focus_sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
            ).fetchone()
            if row is None:
                return None
            phases = conn.execute(
                "SELECT idx, stage, cycle, planned_seconds, started_at, ended_at, focus_seconds, pause_seconds, outcome "
                "FROM focus_phases WHERE session_id = ? ORDER BY idx",
                (session_id,),
            ).fetchall()
        item = history_item(row)
        item["plan"] = json.loads(row["plan"])
        item["cycles_total"] = item["plan"].get("cycles", 1)
        item["phases"] = [dict(p) for p in phases]
        return item

    # --- estatísticas -------------------------------------------------------------------

    def stats(self, user_id: str, tz_name: str, now: float, range_key: str) -> dict:
        tz = load_timezone(tz_name)
        today = datetime.fromtimestamp(now, tz).date()
        with self.db.connect() as conn:
            daily_rows = conn.execute(
                "SELECT day, seconds, cycles FROM focus_daily WHERE user_id = ?", (user_id,)
            ).fetchall()
            sessions = conn.execute(
                "SELECT * FROM focus_sessions WHERE user_id = ? AND status != 'active'", (user_id,)
            ).fetchall()
            phases = conn.execute(
                "SELECT p.started_at, p.ended_at, p.focus_seconds FROM focus_phases p JOIN focus_sessions s "
                "ON s.id = p.session_id WHERE s.user_id = ? AND p.stage = 'focus' AND p.focus_seconds > 0",
                (user_id,),
            ).fetchall()
        daily = {date.fromisoformat(r["day"]): (r["seconds"], r["cycles"]) for r in daily_rows}
        first_day = min(daily) if daily else None

        if range_key == "all":
            start = first_day or today
        else:
            start = today - timedelta(days=RANGES.get(range_key, 30) - 1)
        days = (today - start).days + 1
        prev_end = start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=days - 1)

        def in_range(a: date, b: date):
            return [(d, v) for d, v in daily.items() if a <= d <= b]

        def local(ts: float) -> date:
            return datetime.fromtimestamp(ts, tz).date()

        current = in_range(start, today)
        previous = in_range(prev_start, prev_end)
        range_sessions = [s for s in sessions if start <= local(s["started_at"]) <= today]
        prev_sessions = [s for s in sessions if prev_start <= local(s["started_at"]) <= prev_end]

        def summary(entries, group):
            focused = [s for s in group if s["focus_seconds"] > 0]
            best = max(focused, key=lambda s: s["focus_seconds"], default=None)
            return {
                "focus_seconds": round(sum(v[0] for _, v in entries), 1),
                "cycles": sum(v[1] for _, v in entries),
                "sessions": len(group),
                "completed_sessions": sum(1 for s in group if s["status"] == "completed"),
                "average_session_seconds": round(sum(s["focus_seconds"] for s in focused) / len(focused), 1) if focused else None,
                "active_days": sum(1 for _, v in entries if v[0] >= ACTIVE_DAY_SECONDS),
                "best_session": (
                    {
                        "id": best["id"],
                        "focus_seconds": round(best["focus_seconds"], 1),
                        "started_at": best["started_at"],
                        "method_name": best["method_name"],
                        "course_title": best["course_title"],
                    }
                    if best
                    else None
                ),
            }

        # Distribuições (sessões que começaram no período).
        by_course: dict = defaultdict(lambda: {"seconds": 0.0, "sessions": 0, "title": None})
        by_lesson: dict = defaultdict(lambda: {"seconds": 0.0, "sessions": 0})
        by_technique: dict = defaultdict(lambda: {"seconds": 0.0, "sessions": 0})
        for s in range_sessions:
            key = s["course_id"] or ""
            entry = by_course[key]
            entry["seconds"] += s["focus_seconds"]
            entry["sessions"] += 1
            entry["title"] = s["course_title"] or entry["title"]
            if s["lesson_key"]:
                lesson = by_lesson[(s["course_id"], s["lesson_key"])]
                lesson.update(title=s["lesson_title"], course_title=s["course_title"])
                lesson["seconds"] += s["focus_seconds"]
                lesson["sessions"] += 1
            tech = by_technique[s["technique"]]
            tech["seconds"] += s["focus_seconds"]
            tech["sessions"] += 1

        # Horário do dia e dia da semana (padrões), pelo início de cada etapa de foco.
        by_hour = [0.0] * 24
        by_weekday = [0.0] * 7
        start_ts = day_start(start, tz)
        for p in phases:
            if p["started_at"] < start_ts:
                continue
            moment = datetime.fromtimestamp(p["started_at"], tz)
            by_hour[moment.hour] += p["focus_seconds"]
            by_weekday[moment.weekday()] += p["focus_seconds"]

        series_days = min(days, 90)
        day_series = [
            {"date": d.isoformat(), "seconds": round(daily.get(d, (0, 0))[0], 1), "cycles": daily.get(d, (0, 0))[1]}
            for d in (today - timedelta(days=i) for i in range(series_days - 1, -1, -1))
        ]
        this_monday = week_start(today)
        week_series = []
        for i in range(11, -1, -1):
            monday = this_monday - timedelta(weeks=i)
            total = sum(v[0] for d, v in daily.items() if monday <= d <= monday + timedelta(days=6))
            week_series.append({"start": monday.isoformat(), "seconds": round(total, 1)})
        month_series = []
        year, month = today.year, today.month
        months = []
        for _ in range(12):
            months.append((year, month))
            month -= 1
            if month == 0:
                year, month = year - 1, 12
        for y, m in reversed(months):
            total = sum(v[0] for d, v in daily.items() if d.year == y and d.month == m)
            month_series.append({"month": f"{y:04d}-{m:02d}", "seconds": round(total, 1)})

        heat_start = this_monday - timedelta(weeks=HEATMAP_WEEKS - 1)
        heatmap = [
            {"date": d.isoformat(), "seconds": round(daily.get(d, (0, 0))[0], 1)}
            for d in (heat_start + timedelta(days=i) for i in range((today - heat_start).days + 1))
        ]

        course_rows = sorted(
            ({"course_id": k or None, "title": v["title"] if k else None, "seconds": round(v["seconds"], 1),
              "sessions": v["sessions"]} for k, v in by_course.items()),
            key=lambda x: -x["seconds"],
        )
        lesson_rows = sorted(
            ({"course_id": k[0], "lesson_key": k[1], "title": v.get("title"), "course_title": v.get("course_title"),
              "seconds": round(v["seconds"], 1), "sessions": v["sessions"]} for k, v in by_lesson.items()),
            key=lambda x: -x["seconds"],
        )[:8]
        technique_rows = sorted(
            ({"technique": k, "name": _technique_name(k), "seconds": round(v["seconds"], 1), "sessions": v["sessions"]}
             for k, v in by_technique.items()),
            key=lambda x: -x["seconds"],
        )
        all_time = sum(v[0] for v in daily.values())
        return {
            "range": range_key if range_key in RANGES or range_key == "all" else "30d",
            "start": start.isoformat(),
            "end": today.isoformat(),
            "days": days,
            "timezone": tz_name,
            "active_day_seconds": ACTIVE_DAY_SECONDS,
            "summary": summary(current, range_sessions),
            "previous": summary(previous, prev_sessions) if range_key != "all" else None,
            "all_time": {"focus_seconds": round(all_time, 1), "first_day": first_day.isoformat() if first_day else None},
            "by_course": course_rows,
            "by_lesson": lesson_rows,
            "by_technique": technique_rows,
            "by_hour": [round(v, 1) for v in by_hour],
            "by_weekday": [round(v, 1) for v in by_weekday],
            "daily": day_series,
            "weekly": week_series,
            "monthly": month_series,
            "heatmap": heatmap,
            "heatmap_scale": _heat_scale([v[0] for v in daily.values()]),
        }


def _heat_scale(values: list[float]) -> list[float]:
    """Limites dos 4 níveis do calendário: o 1º é o mínimo do dia ativo; os outros, quartis dos dias com estudo."""
    studied = sorted(v for v in values if v > 0)
    if not studied:
        return [1, ACTIVE_DAY_SECONDS, 3600, 7200]
    def q(p: float) -> float:
        return studied[min(len(studied) - 1, math.floor(p * len(studied)))]
    return [1, ACTIVE_DAY_SECONDS, max(ACTIVE_DAY_SECONDS + 1, q(0.5)), max(ACTIVE_DAY_SECONDS + 2, q(0.85))]
