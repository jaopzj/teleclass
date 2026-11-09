"""Regras de domínio da Minha Rotina, sem banco (docs/minha-rotina.md).

Funções puras: validação de horários, cores e ícones, cálculo do progresso do
dia, da sequência de consistência, do tempo de uma sessão e dos conflitos de
horário. O `RoutineStore` usa estas funções; os testes as exercitam direto.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from enum import StrEnum
from typing import Iterable


class Mode(StrEnum):
    SCHEDULED = "scheduled"  # por horário
    SEQUENCE = "sequence"  # por sequência
    FLEXIBLE = "flexible"  # por período (manhã, tarde, noite)


class RoutineStatus(StrEnum):
    ACTIVE = "active"
    PAUSED = "paused"
    ARCHIVED = "archived"


class Status(StrEnum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"


class Period(StrEnum):
    MORNING = "morning"
    AFTERNOON = "afternoon"
    EVENING = "evening"


class Priority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"


class LinkType(StrEnum):
    COURSE = "course"
    MODULE = "module"
    LESSON = "lesson"


# Paleta controlada: o frontend mostra cada chave com tons de tema (ui/tokens.css).
COLORS = frozenset({"sky", "teal", "green", "amber", "coral", "rose", "violet", "slate"})

# Biblioteca de ícones (Phosphor). A lista espelha frontend/src/routine/icons.ts.
ICONS = frozenset(
    """
    book-open books graduation-cap pencil-simple notebook brain lightbulb exam translate calculator flask code
    monitor-play headphones briefcase laptop envelope phone calendar-check presentation-chart chart-line-up folder
    kanban users-three target clipboard-text currency-circle-dollar wallet barbell person-simple-run bicycle
    person-simple-walk swimming-pool person-arms-spread heartbeat pill first-aid-kit sneaker-move soccer-ball drop
    timer fork-knife coffee cooking-pot bowl-food carrot orange-slice bread shopping-cart egg house broom t-shirt
    washing-machine plant trash wrench bathtub dog cat baby key car bus moon bed sun-horizon alarm leaf wind
    hourglass couch tooth shower sparkle scissors heart smiley person eye flower-lotus game-controller film-slate
    television-simple music-notes guitar paint-brush camera puzzle-piece airplane-tilt tree users chat-circle gift
    hand-heart confetti handshake star flag check-circle bell map-pin globe lightning fire rocket calendar-blank
    list-checks note sun
    """.split()
)

TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
MAX_DURATION_MINUTES = 16 * 60
# Geração automática: só hoje e as próximas semanas (não materializa o infinito).
PLANNING_WINDOW_DAYS = 42
MAX_RANGE_DAYS = 62  # consultas da agenda por intervalo
STREAK_LOOKBACK_DAYS = 400

# Critério de consistência (decidido pelo produto em 2026-11-09; docs/minha-rotina.md):
# o dia conta quando a pessoa conclui ao menos metade das atividades elegíveis,
# e pelo menos uma. Dias sem planejamento não contam nem quebram a sequência.
CONSISTENCY_MIN_RATIO = 0.5
CONSISTENCY_MIN_COMPLETED = 1


def minutes(value: str | None) -> int | None:
    """"07:30" -> 450."""
    if value is None:
        return None
    h, m = value.split(":")
    return int(h) * 60 + int(m)


def hhmm(total: int) -> str:
    total = max(0, min(total, 23 * 60 + 59))
    return f"{total // 60:02d}:{total % 60:02d}"


def period_of(start_time: str | None, period: str | None) -> str | None:
    """Período de leitura na timeline: o do horário, se houver, senão o escolhido."""
    m = minutes(start_time)
    if m is None:
        return period
    if m < 12 * 60:
        return Period.MORNING.value
    if m < 18 * 60:
        return Period.AFTERNOON.value
    return Period.EVENING.value


def weekdays_from_text(text: str) -> list[int]:
    """Segunda = 0 ... domingo = 6 (padrão brasileiro e `date.weekday()`)."""
    return sorted({int(x) for x in text.split(",") if x != ""})


def weekdays_to_text(days: Iterable[int]) -> str:
    return ",".join(str(d) for d in sorted(set(days)))


def daterange(start: date, end: date) -> Iterable[date]:
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


# --- indicadores do dia --------------------------------------------------------------


@dataclass(slots=True)
class DaySummary:
    planned: int  # elegíveis: não canceladas e não opcionais
    completed: int
    skipped: int
    in_progress: int
    remaining: int  # pendentes ou em andamento
    cancelled: int
    optional_total: int
    optional_completed: int
    planned_minutes: int
    invested_seconds: int
    # Tempo feito ÷ tempo planejado, nas atividades obrigatórias com duração. Cada
    # atividade conta no máximo a própria duração: passar do tempo em uma não
    # esconde o que faltou em outra.
    time_done_seconds: int = 0

    @property
    def progress(self) -> float | None:
        """Concluídas ÷ elegíveis. None = dia sem planejamento (nunca 0% nem 100%)."""
        return self.completed / self.planned if self.planned else None

    @property
    def consistent(self) -> bool | None:
        """None = não conta (sem planejamento). Ver CONSISTENCY_*."""
        if not self.planned:
            return None
        return self.completed >= CONSISTENCY_MIN_COMPLETED and self.completed / self.planned >= CONSISTENCY_MIN_RATIO

    @property
    def time_progress(self) -> float | None:
        """None = nada planejado com duração."""
        planned = self.planned_minutes * 60
        return min(1.0, self.time_done_seconds / planned) if planned else None

    def to_dict(self) -> dict:
        return {
            "planned": self.planned,
            "completed": self.completed,
            "skipped": self.skipped,
            "in_progress": self.in_progress,
            "remaining": self.remaining,
            "cancelled": self.cancelled,
            "optional_total": self.optional_total,
            "optional_completed": self.optional_completed,
            "planned_minutes": self.planned_minutes,
            "invested_seconds": self.invested_seconds,
            "progress": self.progress,
            "time_progress": self.time_progress,
            "time_done_seconds": self.time_done_seconds,
            "consistent": self.consistent,
        }


def summarize(items: Iterable[dict]) -> DaySummary:
    """`items`: ocorrências do dia com `status`, `is_optional`, `duration_minutes` e `invested_seconds`."""
    s = DaySummary(0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    for item in items:
        status = item["status"]
        s.invested_seconds += int(item.get("invested_seconds") or 0)
        if status == Status.CANCELLED:
            s.cancelled += 1
            continue
        if item["is_optional"]:
            s.optional_total += 1
            s.optional_completed += status == Status.COMPLETED
            continue
        s.planned += 1
        duration = item.get("duration_minutes") or 0
        s.planned_minutes += duration
        if duration:
            s.time_done_seconds += int(min(item.get("invested_seconds") or 0, duration * 60))
        if status == Status.COMPLETED:
            s.completed += 1
        elif status == Status.SKIPPED:
            s.skipped += 1
        else:
            s.remaining += 1
            s.in_progress += status == Status.IN_PROGRESS
    return s


def streak(consistency: dict[date, bool | None], today: date) -> dict:
    """Sequência atual e melhor sequência.

    `consistency` traz só os dias com algo planejado. Dias ausentes (descanso)
    não contam nem interrompem. Hoje ainda em aberto não interrompe: a
    sequência mostra até ontem até o dia de hoje ficar consistente.
    """
    days = sorted(d for d, v in consistency.items() if v is not None and d <= today)
    current = 0
    for d in reversed(days):
        ok = consistency[d]
        if d == today and not ok:
            continue
        if not ok:
            break
        current += 1
    best = run = 0
    for d in days:
        if consistency[d]:
            run += 1
            best = max(best, run)
        elif d != today:
            run = 0
    return {"current": current, "best": max(best, current), "today_counted": bool(consistency.get(today))}


# --- sessões ----------------------------------------------------------------------------


def conflicts(items: Iterable[dict]) -> list[list[str]]:
    """Pares de ocorrências com horário que se sobrepõem (canceladas e puladas não contam).

    Sem duração, a atividade ocupa só o instante de início (duas no mesmo
    horário ainda conflitam).
    """
    timed = []
    for item in items:
        if item["status"] in (Status.CANCELLED, Status.SKIPPED) or item.get("start_time") is None:
            continue
        start = minutes(item["start_time"])
        timed.append((start, start + (item.get("duration_minutes") or 0), item["id"]))
    timed.sort()
    pairs: list[list[str]] = []
    for i, (a_start, a_end, a_id) in enumerate(timed):
        for b_start, b_end, b_id in timed[i + 1:]:
            if b_start >= max(a_end, a_start + 1):
                break
            pairs.append([a_id, b_id])
    return pairs


def overlaps(a_start: int, a_dur: int, b_start: int, b_dur: int) -> bool:
    a_end, b_end = a_start + max(a_dur, 1), b_start + max(b_dur, 1)
    return a_start < b_end and b_start < a_end


def normalized_title(title: str) -> str:
    return " ".join(title.casefold().split())
