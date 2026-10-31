"""Temporizador de estudos (`/api/focus`).

Contrato e regras em docs/temporizador.md. Toda rota exige login, só enxerga
dados do próprio usuário (o id vem da sessão, nunca do corpo) e nenhum
instante vem do cliente: início, fim e pausas usam o relógio do servidor.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..courses import CourseNotFound
from ..errors import AppError
from ..focus import Target
from ..focus.methods import build_plan
from ..focus.plans import (
    BREAK_RANGE, CYCLES_RANGE, FOCUS_RANGE, PRESETS, STOPWATCH_LIMIT_SECONDS, Technique, preset_plan,
)
from ..focus.rewards import (
    CYCLE_MIN_FOCUS_SECONDS, CYCLE_XP, DAILY_CYCLE_BONUS_CAP, DAILY_FOCUS_XP_CAP, GOAL_XP, RARITY_XP,
    SESSION_MIN_FOCUS_SECONDS, SESSION_XP, achievements_view, ladder, progression, total_xp,
)
from ..focus.notices import NOTICE_KINDS
from ..study import InvalidTimezone
from ..study.days import load_timezone
from .deps import AppState, get_state, get_user_id

router = APIRouter(prefix="/api/focus", tags=["temporizador"])

REQUEST_ID = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
ACTION_LIMIT, ACTION_WINDOW = 60, 60
WRITE_LIMIT, WRITE_WINDOW = 30, 60


class TargetNotFound(AppError):
    def __init__(self, field: str) -> None:
        super().__init__(404, "focus_target_not_found", "Curso ou aula não encontrados na sua biblioteca.", field=field)


def _target(state: AppState, user: str, course_id: str | None, lesson_key: str | None) -> Target:
    if not course_id:
        if lesson_key:
            raise TargetNotFound("course_id")
        return Target()
    try:
        course = state.libraries.catalog(user).get(course_id)
    except (CourseNotFound, ValueError) as exc:
        raise TargetNotFound("course_id") from exc
    if not lesson_key:
        return Target(course.id, None, course.title, None)
    lesson = course.lesson(lesson_key)
    if lesson is None:
        raise TargetNotFound("lesson_key")
    return Target(course.id, lesson.key, course.title, lesson.title)


def _set_timezone_if_missing(state: AppState, user: str, timezone: str | None) -> None:
    if not timezone:
        return
    try:
        state.preferences.set_timezone(user, timezone, only_if_missing=True)
    except InvalidTimezone:
        pass


def _progress_summary(state: AppState, user: str) -> dict:
    with state.focus.db.connect() as conn:
        return progression(total_xp(conn, user))


# --- catálogo ------------------------------------------------------------------------


@router.get("/catalog")
def catalog(state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    return {
        "presets": [p.to_dict() for p in PRESETS.values()],
        "methods": [m.to_dict() for m in state.focus_methods.list(user)],
        "limits": {
            "focus_minutes": [FOCUS_RANGE[0] // 60, FOCUS_RANGE[1] // 60],
            "break_minutes": [BREAK_RANGE[0] // 60, BREAK_RANGE[1] // 60],
            "cycles": list(CYCLES_RANGE),
            "stopwatch_limit_seconds": STOPWATCH_LIMIT_SECONDS,
        },
        "rules": {
            "focus_xp_per_minute": 1,
            "daily_focus_xp_cap": DAILY_FOCUS_XP_CAP,
            "cycle_xp": CYCLE_XP,
            "cycle_min_focus_seconds": CYCLE_MIN_FOCUS_SECONDS,
            "daily_cycle_bonus_cap": DAILY_CYCLE_BONUS_CAP,
            "session_xp": SESSION_XP,
            "session_min_focus_seconds": SESSION_MIN_FOCUS_SECONDS,
            "goal_xp": GOAL_XP,
            "rarity_xp": RARITY_XP,
        },
        "ladder": ladder(),
    }


# --- sessão -----------------------------------------------------------------------------


@router.get("/state")
def get_focus_state(
    after: int | None = Query(default=None, ge=0),
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
) -> dict:
    snapshot = state.focus.state(user)
    notices, cursor = state.focus_notices.after(user, after)
    return {**snapshot, "notices": notices, "notice_cursor": cursor, "progress": _progress_summary(state, user)}


class PlanBody(BaseModel):
    focus_minutes: int = Field(ge=1, le=600)
    short_break_minutes: int = Field(ge=0, le=600)
    long_break_minutes: int = Field(default=0, ge=0, le=600)
    long_break_every: int | None = Field(default=None, ge=1, le=12)
    cycles: int = Field(ge=1, le=12)


class StartBody(BaseModel):
    request_id: str = Field(pattern=REQUEST_ID)
    technique: Literal["pomodoro", "52_17", "deep_work", "custom", "stopwatch"]
    method_id: str | None = Field(default=None, max_length=64)
    focus_minutes: int | None = Field(default=None, ge=1, le=600)  # variação do Deep Work
    cycles: int | None = Field(default=None, ge=1, le=12)
    custom: PlanBody | None = None  # "Personalizado" sem salvar como método
    intention: str | None = Field(default=None, max_length=280)
    course_id: str | None = Field(default=None, max_length=200)
    lesson_key: str | None = Field(default=None, max_length=200)
    timezone: str | None = Field(default=None, max_length=64)


@router.post("/sessions")
def start_session(body: StartBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    state.limiter.hit(f"focus-action:{user}", ACTION_LIMIT, ACTION_WINDOW)
    technique = Technique(body.technique)
    method_id = None
    if body.method_id:
        method = state.focus_methods.get(user, body.method_id)
        plan, name, method_id = method.plan, method.name, method.id
    elif technique is Technique.CUSTOM:
        custom = body.custom
        if custom is None:
            plan = PRESETS[Technique.CUSTOM].plan
        else:
            plan = build_plan(custom.focus_minutes, custom.short_break_minutes, custom.long_break_minutes,
                              custom.long_break_every, custom.cycles)
        name = PRESETS[Technique.CUSTOM].name
    else:
        plan = preset_plan(technique, body.focus_minutes, body.cycles)
        name = PRESETS[technique].name
    target = _target(state, user, body.course_id, body.lesson_key)
    _set_timezone_if_missing(state, user, body.timezone)
    return state.focus.start(user, body.request_id, plan, method_id=method_id, method_name=name,
                             intention=body.intention, target=target)


class ActionBody(BaseModel):
    action: Literal["pause", "resume", "start_next", "unlock_break", "stop"]
    request_id: str = Field(pattern=REQUEST_ID)
    version: int = Field(ge=0)
    confirm: bool = False


@router.post("/sessions/{session_id}/actions")
def session_action(
    session_id: str, body: ActionBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)
) -> dict:
    state.limiter.hit(f"focus-action:{user}", ACTION_LIMIT, ACTION_WINDOW)
    return state.focus.act(user, session_id, body.action, body.request_id, body.version, confirm=body.confirm)


# --- métodos ------------------------------------------------------------------------------


class MethodBody(PlanBody):
    name: str = Field(max_length=80)


def _method_plan(body: MethodBody):
    return build_plan(body.focus_minutes, body.short_break_minutes, body.long_break_minutes, body.long_break_every, body.cycles)


@router.get("/methods")
def list_methods(state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> list[dict]:
    return [m.to_dict() for m in state.focus_methods.list(user)]


@router.post("/methods", status_code=201)
def create_method(body: MethodBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    state.limiter.hit(f"focus-write:{user}", WRITE_LIMIT, WRITE_WINDOW)
    return state.focus_methods.create(user, body.name, _method_plan(body)).to_dict()


@router.put("/methods/{method_id}")
def update_method(
    method_id: str, body: MethodBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)
) -> dict:
    state.limiter.hit(f"focus-write:{user}", WRITE_LIMIT, WRITE_WINDOW)
    return state.focus_methods.update(user, method_id, body.name, _method_plan(body)).to_dict()


@router.delete("/methods/{method_id}", status_code=204)
def delete_method(method_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> Response:
    state.focus_methods.delete(user, method_id)
    return Response(status_code=204)


# --- progressão, metas, histórico e estatísticas ---------------------------------------------


def _today(state: AppState, user: str):
    tz = load_timezone(state.preferences.effective_timezone(user))
    return datetime.fromtimestamp(state.focus.clock(), tz).date()


@router.get("/progress")
def get_progress(state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    state.focus.sync(user)
    with state.focus.db.connect() as conn:
        xp = total_xp(conn, user)
        achievements = achievements_view(conn, user)
        recent = conn.execute(
            "SELECT kind, xp, at, ref FROM xp_events WHERE user_id = ? ORDER BY id DESC LIMIT 12", (user,)
        ).fetchall()
        by_kind = {
            r["kind"]: r["xp"]
            for r in conn.execute("SELECT kind, SUM(xp) AS xp FROM xp_events WHERE user_id = ? GROUP BY kind", (user,))
        }
    return {
        "progress": progression(xp),
        "ladder": ladder(),
        "achievements": achievements,
        "recent_xp": [dict(r) for r in recent],
        "xp_by_kind": by_kind,
    }


class GoalsBody(BaseModel):
    daily_minutes: int | None = Field(default=None, ge=0, le=24 * 60)
    weekly_minutes: int | None = Field(default=None, ge=0, le=7 * 24 * 60)


@router.get("/goals")
def get_goals(state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    state.focus.sync(user)
    return state.focus_goals.view(user, _today(state, user))


@router.put("/goals")
def set_goals(body: GoalsBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    state.limiter.hit(f"focus-write:{user}", WRITE_LIMIT, WRITE_WINDOW)
    # 0 ou ausente desliga a meta.
    state.focus_goals.set(user, "daily", body.daily_minutes or None)
    state.focus_goals.set(user, "weekly", body.weekly_minutes or None)
    return state.focus_goals.view(user, _today(state, user))


@router.get("/history")
def get_history(
    before: float | None = None,
    technique: str | None = Query(default=None, max_length=20),
    course_id: str | None = Query(default=None, max_length=200),
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
) -> dict:
    state.focus.sync(user)
    return state.focus_stats.history(user, before, technique, course_id)


class SessionGone(AppError):
    def __init__(self) -> None:
        super().__init__(404, "focus_session_not_found", "Sessão não encontrada.")


@router.get("/history/{session_id}")
def get_history_item(session_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    state.focus.sync(user)
    detail = state.focus_stats.session_detail(user, session_id)
    if detail is None:
        raise SessionGone()
    return detail


@router.get("/stats")
def get_stats(
    range: str = Query(default="30d", pattern=r"^(7d|30d|90d|365d|all)$"),
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
) -> dict:
    state.focus.sync(user)
    tz_name = state.preferences.effective_timezone(user)
    return state.focus_stats.stats(user, tz_name, state.focus.clock(), range)


class PreferencesBody(BaseModel):
    in_app: bool | None = None
    system: bool | None = None
    sound: bool | None = None
    kinds: dict[str, bool] | None = None
    break_ending_seconds: Literal[0, 30, 60, 120] | None = None


@router.get("/preferences")
def get_preferences(state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    return {**state.focus_notices.preferences(user), "available_kinds": list(NOTICE_KINDS)}


@router.put("/preferences")
def set_preferences(body: PreferencesBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    return {**state.focus_notices.set_preferences(user, data), "available_kinds": list(NOTICE_KINDS)}

