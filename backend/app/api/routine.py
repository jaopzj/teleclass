"""Minha Rotina (`/api/routine`): rotinas, agenda, ocorrências e cronômetro.

Contrato e decisões em docs/minha-rotina.md. Toda rota exige login e só
enxerga dados do próprio usuário (o id vem da sessão, nunca do corpo). Datas
são datas de calendário (`YYYY-MM-DD`) no fuso da pessoa; instantes do
cronômetro usam o relógio do servidor.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import AfterValidator, BaseModel, Field, field_validator

from ..errors import AppError
from ..routine import ActivityInput, Link, RoutineInput
from ..routine import rules
from ..routine.rules import LinkType, Mode, RoutineStatus, Status
from .deps import AppState, get_state, get_user_id

router = APIRouter(prefix="/api/routine", tags=["rotina"])

ID = r"^[0-9a-f]{32}$"
WRITE_LIMIT, WRITE_WINDOW = 240, 60


class BadRange(AppError):
    def __init__(self) -> None:
        super().__init__(422, "invalid_range", f"Escolha um intervalo de até {rules.MAX_RANGE_DAYS} dias.")


class BadDate(AppError):
    def __init__(self) -> None:
        super().__init__(422, "invalid_date", "Data inválida.", field="date")


def _limit(state: AppState, user: str) -> None:
    state.limiter.hit(f"routine:{user}", WRITE_LIMIT, WRITE_WINDOW, "Muitas alterações seguidas. Espere um instante.")


def _date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise BadDate() from exc


def _clean(text: str) -> str:
    """Texto livre: sem caracteres de controle (exceto quebras de linha) e sem espaços nas pontas."""
    return "".join(ch for ch in text if ch in "\n\t" or ch.isprintable()).strip()


# --- corpos ----------------------------------------------------------------------------


def _check_icon(v: str | None) -> str | None:
    if v is not None and v not in rules.ICONS:
        raise ValueError("Ícone desconhecido.")
    return v


def _check_color(v: str | None) -> str | None:
    if v is not None and v not in rules.COLORS:
        raise ValueError("Cor fora da paleta.")
    return v


def _check_time(v: str | None) -> str | None:
    if v is not None and not rules.TIME.match(v):
        raise ValueError("Horário no formato HH:MM.")
    return v


IconKey = Annotated[str | None, AfterValidator(_check_icon)]
ColorKey = Annotated[str | None, AfterValidator(_check_color)]
ClockTime = Annotated[str | None, AfterValidator(_check_time)]


class LinkBody(BaseModel):
    type: LinkType
    course_id: str = Field(min_length=1, max_length=200)
    section_id: str | None = Field(default=None, max_length=200)
    lesson_key: str | None = Field(default=None, max_length=200)

    def to_link(self) -> Link:
        return Link(self.type, self.course_id, self.section_id, self.lesson_key)


class ActivityFields(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    icon_key: IconKey = None
    color: ColorKey = None
    duration_minutes: int | None = Field(default=None, ge=1, le=rules.MAX_DURATION_MINUTES)
    start_time: ClockTime = None
    period: rules.Period | None = None
    priority: rules.Priority = rules.Priority.NORMAL
    is_optional: bool = False
    notes: str = Field(default="", max_length=2000)
    link: LinkBody | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = " ".join(_clean(v).split())
        if not v:
            raise ValueError("Dê um nome à atividade.")
        return v

    @field_validator("description", "notes")
    @classmethod
    def _text(cls, v: str) -> str:
        return _clean(v)

    def to_input(self, id: str | None = None) -> ActivityInput:
        return ActivityInput(
            title=self.title, description=self.description, icon_key=self.icon_key, color=self.color,
            duration_minutes=self.duration_minutes, start_time=self.start_time,
            period=self.period.value if self.period else None, priority=self.priority.value,
            is_optional=self.is_optional, notes=self.notes, link=self.link.to_link() if self.link else None, id=id,
        )


class RoutineActivityBody(ActivityFields):
    id: str | None = Field(default=None, pattern=ID)


Weekday = Literal[0, 1, 2, 3, 4, 5, 6]


class RoutineBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=1000)
    icon_key: IconKey = None
    color: ColorKey = None
    mode: Mode = Mode.SCHEDULED
    preferred_start_time: ClockTime = None
    weekdays: list[Weekday] = Field(default_factory=list, max_length=7)
    activities: list[RoutineActivityBody] = Field(default_factory=list, max_length=60)


    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(_clean(v).split())
        if not v:
            raise ValueError("Dê um nome à rotina.")
        return v

    @field_validator("description")
    @classmethod
    def _desc(cls, v: str) -> str:
        return _clean(v)

    def to_input(self) -> RoutineInput:
        return RoutineInput(
            name=self.name, description=self.description, icon_key=self.icon_key, color=self.color, mode=self.mode,
            preferred_start_time=self.preferred_start_time, weekdays=list(self.weekdays),
            activities=[a.to_input(a.id) for a in self.activities],
        )


class StatusBody(BaseModel):
    status: RoutineStatus


class OccurrenceBody(ActivityFields):
    date: str
    repeat_weekdays: list[Weekday] | None = Field(default=None, max_length=7)


class OccurrencePatch(BaseModel):
    """Só os campos enviados mudam. `scope` define o alcance (docs/minha-rotina.md)."""

    scope: Literal["occurrence", "following", "routine"] = "occurrence"
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    icon_key: IconKey = None
    color: ColorKey = None
    duration_minutes: int | None = Field(default=None, ge=1, le=rules.MAX_DURATION_MINUTES)
    start_time: ClockTime = None
    period: rules.Period | None = None
    priority: rules.Priority | None = None
    is_optional: bool | None = None
    notes: str | None = Field(default=None, max_length=2000)
    link: LinkBody | None = None


    def changes(self) -> dict:
        data = {}
        for key in self.model_fields_set - {"scope"}:
            value = getattr(self, key)
            if key == "title":
                value = " ".join(_clean(value or "").split())
                if not value:
                    raise AppError(422, "invalid_title", "Dê um nome à atividade.", field="title")
            elif key in ("description", "notes"):
                value = _clean(value or "")
            elif key in ("period", "priority"):
                value = value.value if value is not None else (None if key == "period" else "normal")
            elif key == "link":
                value = value.to_link() if value else None
            elif key == "is_optional":
                value = bool(value)
            data[key] = value
        return data


class OccurrenceStatusBody(BaseModel):
    status: Literal["pending", "completed", "skipped", "cancelled"]
    actual_minutes: int | None = Field(default=None, ge=1, le=rules.MAX_DURATION_MINUTES)
    reason: str | None = Field(default=None, max_length=200)


class RescheduleBody(BaseModel):
    date: str
    start_time: ClockTime = None



class ReorderBody(BaseModel):
    date: str
    ids: list[str] = Field(max_length=300)


class ApplyBody(BaseModel):
    routine_id: str = Field(pattern=ID)
    date: str
    start_time: ClockTime = None
    skip_duplicates: bool = False



# --- rotinas ---------------------------------------------------------------------------


@router.get("/routines")
def list_routines(state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> list[dict]:
    return state.routine.list_routines(user)


@router.post("/routines", status_code=201)
def create_routine(body: RoutineBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    _limit(state, user)
    return state.routine.create_routine(user, body.to_input())


@router.get("/routines/{routine_id}")
def get_routine(routine_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    return state.routine.get_routine(user, routine_id)


@router.put("/routines/{routine_id}")
def save_routine(routine_id: str, body: RoutineBody, state: AppState = Depends(get_state),
                 user: str = Depends(get_user_id)) -> dict:
    _limit(state, user)
    return state.routine.save_routine(user, routine_id, body.to_input())


@router.post("/routines/{routine_id}/status")
def set_routine_status(routine_id: str, body: StatusBody, state: AppState = Depends(get_state),
                       user: str = Depends(get_user_id)) -> dict:
    _limit(state, user)
    return state.routine.set_routine_status(user, routine_id, body.status)


@router.delete("/routines/{routine_id}", status_code=204)
def delete_routine(routine_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> Response:
    _limit(state, user)
    state.routine.delete_routine(user, routine_id)
    return Response(status_code=204)


# --- agenda ----------------------------------------------------------------------------


@router.get("/agenda")
def agenda(
    start: str = Query(alias="from"),
    end: str = Query(alias="to"),
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
) -> dict:
    first, last = _date(start), _date(end)
    if last < first or (last - first).days >= rules.MAX_RANGE_DAYS:
        raise BadRange()
    return state.routine.agenda(user, first, last)


@router.get("/day/{day}")
def day(day: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    return state.routine.day(user, _date(day))


@router.get("/stats")
def stats(
    start: str | None = Query(default=None, alias="from"),
    end: str | None = Query(default=None, alias="to"),
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
) -> dict:
    last = _date(end) if end else state.routine.today(user)
    first = _date(start) if start else last - timedelta(days=27)
    if last < first or (last - first).days >= 92:
        raise BadRange()
    return state.routine.stats(user, first, last)


@router.post("/apply/preview")
def preview_apply(body: ApplyBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    return state.routine.preview_apply(user, body.routine_id, _date(body.date), body.start_time)


@router.post("/apply")
def apply_routine(body: ApplyBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    _limit(state, user)
    return state.routine.apply_routine(
        user, body.routine_id, _date(body.date), start_time=body.start_time, skip_duplicates=body.skip_duplicates
    )


@router.delete("/apply/{routine_id}/{day}")
def unapply_routine(routine_id: str, day: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    _limit(state, user)
    return state.routine.unapply_routine(user, routine_id, _date(day))


# --- ocorrências -------------------------------------------------------------------------


@router.post("/occurrences", status_code=201)
def create_occurrence(body: OccurrenceBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    _limit(state, user)
    return state.routine.create_occurrence(user, _date(body.date), body.to_input(),
                                           list(body.repeat_weekdays) if body.repeat_weekdays else None)


@router.get("/occurrences/{occurrence_id}")
def get_occurrence(occurrence_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    return state.routine.get_occurrence(user, occurrence_id)


@router.patch("/occurrences/{occurrence_id}")
def update_occurrence(occurrence_id: str, body: OccurrencePatch, state: AppState = Depends(get_state),
                      user: str = Depends(get_user_id)) -> dict:
    _limit(state, user)
    return state.routine.update_occurrence(user, occurrence_id, body.changes(), body.scope)


@router.post("/occurrences/{occurrence_id}/status")
def set_occurrence_status(occurrence_id: str, body: OccurrenceStatusBody, state: AppState = Depends(get_state),
                          user: str = Depends(get_user_id)) -> dict:
    _limit(state, user)
    reason = _clean(body.reason) if body.reason else None
    return state.routine.set_status(user, occurrence_id, Status(body.status), actual_minutes=body.actual_minutes,
                                    reason=reason or None)


@router.post("/occurrences/{occurrence_id}/reschedule")
def reschedule(occurrence_id: str, body: RescheduleBody, state: AppState = Depends(get_state),
               user: str = Depends(get_user_id)) -> dict:
    _limit(state, user)
    return state.routine.reschedule(user, occurrence_id, _date(body.date), body.start_time)


@router.post("/occurrences/reorder", status_code=204)
def reorder(body: ReorderBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> Response:
    _limit(state, user)
    state.routine.reorder(user, _date(body.date), body.ids)
    return Response(status_code=204)


@router.delete("/occurrences/{occurrence_id}", status_code=204)
def remove_occurrence(occurrence_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> Response:
    _limit(state, user)
    state.routine.remove_occurrence(user, occurrence_id)
    return Response(status_code=204)

