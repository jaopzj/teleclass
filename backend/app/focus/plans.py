"""Técnicas de estudo e o plano de etapas de uma sessão.

Um plano é a receita de uma sessão: duração da concentração, das pausas curta
e longa, de quantos em quantos ciclos vem a pausa longa e quantos ciclos há.
As técnicas prontas são fixas no código; os métodos que o aluno cria
(`methods.py`) são planos da técnica `custom` com nome próprio.

Sequência de etapas (funções puras, testadas sem banco):

    foco 1 → pausa → foco 2 → pausa → ... → foco N [→ pausa longa final]

- Depois do ciclo `c` (c < N) vem a pausa longa se `c` é múltiplo de
  `long_break_every`, senão a curta. Pausa de 0 minutos = sem pausa.
- Depois do último ciclo a sessão termina, exceto quando cabe ali uma pausa
  longa (o Pomodoro clássico termina com o descanso prolongado depois do 4º).
- O cronômetro livre (`stopwatch`) tem uma etapa de foco sem duração, até o
  aluno encerrar ou chegar ao limite `STOPWATCH_LIMIT_SECONDS`.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import StrEnum

from ..errors import AppError

MIN = 60
STOPWATCH_LIMIT_SECONDS = 4 * 3600  # cronômetro esquecido aberto não vira um dia de estudo

# Limites de qualquer plano (técnicas prontas e métodos do aluno).
FOCUS_RANGE = (5 * MIN, 180 * MIN)
BREAK_RANGE = (0, 60 * MIN)
CYCLES_RANGE = (1, 12)


class Technique(StrEnum):
    POMODORO = "pomodoro"
    FIFTY_TWO = "52_17"
    DEEP_WORK = "deep_work"
    CUSTOM = "custom"
    STOPWATCH = "stopwatch"


class Stage(StrEnum):
    FOCUS = "focus"
    SHORT_BREAK = "short_break"
    LONG_BREAK = "long_break"


class InvalidPlan(AppError):
    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(422, "invalid_plan", message, field=field)


@dataclass(frozen=True, slots=True)
class Plan:
    technique: Technique
    focus_seconds: int | None  # None: cronômetro livre
    short_break_seconds: int = 0
    long_break_seconds: int = 0
    long_break_every: int | None = None
    cycles: int = 1

    @property
    def is_stopwatch(self) -> bool:
        return self.focus_seconds is None

    def to_dict(self) -> dict:
        data = asdict(self)
        data["technique"] = self.technique.value
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "Plan":
        return cls(
            Technique(data["technique"]),
            data.get("focus_seconds"),
            int(data.get("short_break_seconds") or 0),
            int(data.get("long_break_seconds") or 0),
            data.get("long_break_every"),
            int(data.get("cycles") or 1),
        )

    def break_after(self, cycle: int) -> tuple[Stage, int] | None:
        """Pausa que vem depois do ciclo de foco `cycle` (1, 2, ...), ou None."""
        if self.is_stopwatch:
            return None
        is_long = bool(self.long_break_every) and cycle % self.long_break_every == 0 and self.long_break_seconds > 0
        if cycle >= self.cycles:
            return (Stage.LONG_BREAK, self.long_break_seconds) if is_long else None
        if is_long:
            return Stage.LONG_BREAK, self.long_break_seconds
        if self.short_break_seconds > 0:
            return Stage.SHORT_BREAK, self.short_break_seconds
        return None

    def timeline(self) -> list[dict]:
        """Todas as etapas, na ordem, para a interface mostrar o caminho da sessão."""
        if self.is_stopwatch:
            return [{"stage": Stage.FOCUS.value, "cycle": 1, "seconds": None}]
        steps = []
        for cycle in range(1, self.cycles + 1):
            steps.append({"stage": Stage.FOCUS.value, "cycle": cycle, "seconds": self.focus_seconds})
            pause = self.break_after(cycle)
            if pause:
                steps.append({"stage": pause[0].value, "cycle": cycle, "seconds": pause[1]})
        return steps

    @property
    def planned_focus_seconds(self) -> int | None:
        return None if self.focus_seconds is None else self.focus_seconds * self.cycles


def _minutes(value: int) -> str:
    return f"{value // MIN} min"


def validate_plan(plan: Plan) -> Plan:
    """Confere os limites; levanta `InvalidPlan` com o campo do problema."""
    if plan.technique is Technique.STOPWATCH:
        return Plan(Technique.STOPWATCH, None, 0, 0, None, 1)
    if plan.focus_seconds is None or not (FOCUS_RANGE[0] <= plan.focus_seconds <= FOCUS_RANGE[1]):
        raise InvalidPlan(
            f"A concentração precisa ter entre {_minutes(FOCUS_RANGE[0])} e {_minutes(FOCUS_RANGE[1])}.", "focus_minutes"
        )
    if plan.focus_seconds % MIN:
        raise InvalidPlan("Use minutos inteiros.", "focus_minutes")
    for name, value in (("short_break_minutes", plan.short_break_seconds), ("long_break_minutes", plan.long_break_seconds)):
        if not (BREAK_RANGE[0] <= value <= BREAK_RANGE[1]) or value % MIN:
            raise InvalidPlan(f"As pausas precisam ter de 0 a {_minutes(BREAK_RANGE[1])}, em minutos inteiros.", name)
    if not (CYCLES_RANGE[0] <= plan.cycles <= CYCLES_RANGE[1]):
        raise InvalidPlan(f"Escolha de {CYCLES_RANGE[0]} a {CYCLES_RANGE[1]} ciclos.", "cycles")
    every = plan.long_break_every
    if every is not None and not (1 <= every <= CYCLES_RANGE[1]):
        raise InvalidPlan("A pausa longa precisa vir a cada 1 a 12 ciclos.", "long_break_every")
    if every is not None and plan.long_break_seconds == 0:
        every = None
    return Plan(plan.technique, plan.focus_seconds, plan.short_break_seconds, plan.long_break_seconds, every, plan.cycles)


@dataclass(frozen=True, slots=True)
class Preset:
    """Técnica pronta. `options` são variações oferecidas na interface (ex.: Deep Work 60/90/120)."""

    technique: Technique
    name: str
    description: str
    plan: Plan
    focus_options: tuple[int, ...] = ()
    configurable: bool = False  # o aluno ajusta ciclos e durações antes de começar

    def to_dict(self) -> dict:
        return {
            "technique": self.technique.value,
            "name": self.name,
            "description": self.description,
            "plan": self.plan.to_dict(),
            "timeline": self.plan.timeline(),
            "focus_options": [s // MIN for s in self.focus_options],
            "configurable": self.configurable,
        }


PRESETS: dict[Technique, Preset] = {
    p.technique: p
    for p in (
        Preset(
            Technique.POMODORO,
            "Pomodoro",
            "25 min de concentração e 5 de descanso. Depois do 4º ciclo, uma pausa longa.",
            Plan(Technique.POMODORO, 25 * MIN, 5 * MIN, 15 * MIN, 4, 4),
        ),
        Preset(
            Technique.FIFTY_TWO,
            "52/17",
            "Blocos de 52 min de concentração com 17 min de descanso.",
            Plan(Technique.FIFTY_TWO, 52 * MIN, 17 * MIN, 0, None, 3),
        ),
        Preset(
            Technique.DEEP_WORK,
            "Deep Work",
            "Um bloco longo e sem interrupções para conteúdos que pedem imersão.",
            Plan(Technique.DEEP_WORK, 90 * MIN, 20 * MIN, 0, None, 1),
            focus_options=(60 * MIN, 90 * MIN, 120 * MIN),
        ),
        Preset(
            Technique.CUSTOM,
            "Personalizado",
            "Você define a concentração, as pausas e a quantidade de ciclos.",
            Plan(Technique.CUSTOM, 40 * MIN, 10 * MIN, 20 * MIN, 3, 3),
            configurable=True,
        ),
        Preset(
            Technique.STOPWATCH,
            "Cronômetro livre",
            "Conta o tempo sem duração definida. Você encerra quando quiser.",
            Plan(Technique.STOPWATCH, None),
        ),
    )
}


def preset_plan(technique: Technique, focus_minutes: int | None = None, cycles: int | None = None) -> Plan:
    """Plano de uma técnica pronta, com as variações permitidas por ela."""
    preset = PRESETS[technique]
    plan = preset.plan
    focus = plan.focus_seconds
    if focus_minutes is not None and preset.focus_options:
        if focus_minutes * MIN not in preset.focus_options:
            raise InvalidPlan("Duração não disponível para esta técnica.", "focus_minutes")
        focus = focus_minutes * MIN
    total = plan.cycles
    if cycles is not None and not plan.is_stopwatch:
        total = cycles
    return validate_plan(Plan(plan.technique, focus, plan.short_break_seconds, plan.long_break_seconds, plan.long_break_every, total))
