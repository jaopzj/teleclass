"""Métricas de estudo: definições únicas, usadas por todas as telas.

As funções puras (`compute_*`) recebem dados já consolidados e uma data de
referência, então são testadas sem banco e sem relógio. `StudyMetrics` junta o
livro-razão, o progresso das aulas (`lesson_progress`, a fonte da verdade de
conclusão) e o catálogo de cursos.

Definições (detalhes em docs/metricas-de-estudo.md):

- **Hoje**: soma dos intervalos creditados no dia local de hoje.
- **Semana**: soma de segunda-feira até hoje (semana de segunda a domingo).
- **Dia ativo**: dia com pelo menos `ACTIVE_DAY_SECONDS` de estudo creditado.
- **Sequência**: dias ativos consecutivos terminando hoje; se hoje ainda não é
  ativo, terminando ontem (a sequência só quebra quando um dia termina sem
  atingir o mínimo).
- **Média diária** (indicador principal): total dos últimos 7 dias completos
  (ontem e os 6 anteriores) dividido pelo número desses dias, sem contar dias
  anteriores ao primeiro estudo. Hoje fica de fora por estar incompleto.
  A média por dia ativo usa a mesma janela.
- **Aulas concluídas**: aulas marcadas como concluídas que existem nos cursos
  da pessoa, cada uma uma vez.
- **Progresso geral**: aulas concluídas ÷ aulas válidas, somando todos os
  cursos iniciados (cada aula pesa igual, não é média de percentuais).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Iterable, Mapping

from ..learning import ProgressStore, summarize
from ..learning.summary import percent_of
from ..libraries import Libraries
from .days import load_timezone, week_start
from .ledger import StudyLedger
from .preferences import PreferencesStore
from .sources import StudySource

ACTIVE_DAY_SECONDS = 10 * 60
AVERAGE_WINDOW_DAYS = 7


def _total(day_sources: Mapping[str, float] | None) -> float:
    return sum(day_sources.values()) if day_sources else 0.0


def is_active(seconds: float) -> bool:
    return seconds >= ACTIVE_DAY_SECONDS


def compute_time(daily: Mapping[date, Mapping[str, float]], today: date) -> dict:
    totals = {day: _total(sources) for day, sources in daily.items()}
    seconds = lambda day: totals.get(day, 0.0)  # noqa: E731

    monday = week_start(today)
    week_days = [monday + timedelta(days=i) for i in range(7)]
    week_seconds = sum(seconds(d) for d in week_days if d <= today)
    previous = sum(seconds(d - timedelta(days=7)) for d in week_days if d <= today)

    # Sequência atual e melhor sequência.
    anchor = today if is_active(seconds(today)) else today - timedelta(days=1)
    current = 0
    cursor = anchor
    while is_active(seconds(cursor)):
        current += 1
        cursor -= timedelta(days=1)
    best, run, last = 0, 0, None
    for day in sorted(d for d, s in totals.items() if is_active(s) and d <= today):
        run = run + 1 if last is not None and day - last == timedelta(days=1) else 1
        best = max(best, run)
        last = day

    # Média: dias completos da janela, a partir do primeiro dia com estudo.
    studied = [d for d, s in totals.items() if s > 0 and d <= today]
    first = min(studied) if studied else None
    window_end = today - timedelta(days=1)
    window_start = today - timedelta(days=AVERAGE_WINDOW_DAYS)
    if first is not None and first > window_start:
        window_start = first
    average = None
    if first is not None and window_start <= window_end:
        days = [window_start + timedelta(days=i) for i in range((window_end - window_start).days + 1)]
        total = sum(seconds(d) for d in days)
        active_days = [d for d in days if is_active(seconds(d))]
        average = {
            "window_start": window_start.isoformat(),
            "window_end": window_end.isoformat(),
            "days": len(days),
            "seconds_per_day": total / len(days),
            "active_days": len(active_days),
            "seconds_per_active_day": (
                sum(seconds(d) for d in active_days) / len(active_days) if active_days else None
            ),
        }

    by_source: dict[str, float] = {source.value: 0.0 for source in StudySource}
    for sources in daily.values():
        for source, value in sources.items():
            by_source[source] = by_source.get(source, 0.0) + value

    return {
        "today": {"date": today.isoformat(), "seconds": seconds(today), "active": is_active(seconds(today))},
        "week": {
            "start": monday.isoformat(),
            "end": week_days[-1].isoformat(),
            "seconds": week_seconds,
            "previous_to_date_seconds": previous,
            "days": [
                {
                    "date": d.isoformat(),
                    "seconds": seconds(d) if d <= today else None,
                    "active": is_active(seconds(d)),
                }
                for d in week_days
            ],
        },
        "streak": {"current": current, "includes_today": anchor == today and current > 0, "best": best},
        "daily_average": average,
        "total": {"seconds": sum(totals.values()), "by_source": by_source, "first_day": first.isoformat() if first else None},
    }


def compute_month(daily: Mapping[date, Mapping[str, float]], year: int, month: int, today: date) -> dict:
    """Dias de um mês do calendário: segundos estudados e se o dia foi ativo.

    Dias depois de hoje vêm com `seconds = None` (ainda não aconteceram).
    """
    first = date(year, month, 1)
    next_first = date(year + (month == 12), month % 12 + 1, 1)
    days = []
    cursor = first
    while cursor < next_first:
        seconds = _total(daily.get(cursor))
        days.append({
            "date": cursor.isoformat(),
            "seconds": seconds if cursor <= today else None,
            "active": cursor <= today and is_active(seconds),
        })
        cursor += timedelta(days=1)
    return {"month": f"{year:04d}-{month:02d}", "today": today.isoformat(), "days": days}


@dataclass(frozen=True, slots=True)
class CourseTally:
    completed: int  # aulas válidas concluídas
    total: int  # aulas válidas
    started: bool
    completed_at: tuple[str, ...] = ()  # quando cada aula concluída foi concluída (UTC, ISO)


def compute_courses(courses: Iterable[CourseTally], week_from: datetime) -> dict:
    tallies = list(courses)
    started = [c for c in tallies if c.started and c.total > 0]
    completed = sum(c.completed for c in tallies)
    this_week = sum(
        1 for c in tallies for moment in c.completed_at if moment and datetime.fromisoformat(moment) >= week_from
    )
    done = sum(c.completed for c in started)
    total = sum(c.total for c in started)
    return {
        "lessons": {"completed": completed, "completed_this_week": this_week},
        "courses": {
            "started": len(started),
            "finished": sum(1 for c in started if c.completed >= c.total),
            "completed_lessons": done,
            "total_lessons": total,
            "percent": percent_of(done, total),
            "without_lessons": sum(1 for c in tallies if c.started and c.total == 0),
        },
    }


class StudyMetrics:
    def __init__(
        self,
        ledger: StudyLedger,
        preferences: PreferencesStore,
        progress: ProgressStore,
        libraries: Libraries,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self.ledger = ledger
        self.preferences = preferences
        self.progress = progress
        self.libraries = libraries
        self._clock = clock

    def clock(self) -> float:
        return (self._clock or self.ledger.clock)()

    def for_user(self, user_id: str) -> dict:
        configured = self.preferences.timezone(user_id)
        tz_name = self.preferences.effective_timezone(user_id)
        tz = load_timezone(tz_name)
        now = datetime.fromtimestamp(self.clock(), tz)
        today = now.date()
        monday_start = datetime.combine(week_start(today), datetime.min.time(), tzinfo=tz).astimezone(timezone.utc)

        tallies = []
        for course in self.libraries.catalog(user_id).all():
            progress = self.progress.for_course(user_id, course.id)
            summary = summarize(course, progress)
            tallies.append(
                CourseTally(
                    summary.completed,
                    summary.total,
                    summary.started,
                    tuple(
                        p.completed_at
                        for lesson in course.lessons
                        if (p := progress.get(lesson.key)) and p.completed and lesson.key in summary.valid_keys
                    ),
                )
            )

        return {
            "timezone": tz_name,
            "timezone_configured": configured is not None,
            "generated_at": now.isoformat(timespec="seconds"),
            "rules": {"active_day_seconds": ACTIVE_DAY_SECONDS, "average_window_days": AVERAGE_WINDOW_DAYS, "week_starts_on": "monday"},
            **compute_time(self.ledger.daily_totals(user_id), today),
            **compute_courses(tallies, monday_start),
        }

    def month(self, user_id: str, year: int, month: int) -> dict:
        tz = load_timezone(self.preferences.effective_timezone(user_id))
        today = datetime.fromtimestamp(self.clock(), tz).date()
        return compute_month(self.ledger.daily_totals(user_id), year, month, today)
