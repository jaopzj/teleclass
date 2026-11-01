"""Rastreamento de estudo e métricas do aluno (`/api/study`).

Contrato e regras em docs/metricas-de-estudo.md. Toda rota exige login e só
enxerga registros do próprio usuário: o id de usuário vem da sessão, nunca do
corpo do pedido.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..courses import CourseNotFound
from ..courses.catalog import LessonKind
from ..errors import AppError
from ..study import InvalidTimezone, SegmentClaim, SessionContext, StudySource
from ..study.ledger import MAX_SEGMENTS_PER_REQUEST
from .deps import AppState, get_state, get_user_id

router = APIRouter(prefix="/api/study", tags=["estudo"])

SESSION_LIMIT, SESSION_WINDOW = 60, 60  # aberturas por minuto (troca de aula, recarregar)
SEGMENT_LIMIT, SEGMENT_WINDOW = 120, 60  # envios por minuto (o normal é ~4)
SESSION_ID = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


class BadTimezone(AppError):
    def __init__(self) -> None:
        super().__init__(422, "invalid_timezone", "Fuso horário desconhecido.", field="timezone")


class LessonNotTrackable(AppError):
    def __init__(self) -> None:
        super().__init__(404, "lesson_not_trackable", "Aula sem vídeo ou inexistente.")


def _video_context(state: AppState, user: str, course_id: str | None, lesson_key: str | None) -> SessionContext:
    """A aula precisa existir na biblioteca do próprio usuário e ter vídeo."""
    if not course_id or not lesson_key:
        raise LessonNotTrackable()
    try:
        course = state.libraries.catalog(user).get(course_id)
    except (CourseNotFound, ValueError) as exc:
        raise LessonNotTrackable() from exc
    lesson = course.lesson(lesson_key)
    if lesson is None or lesson.kind is not LessonKind.VIDEO:
        raise LessonNotTrackable()
    return SessionContext(course.id, lesson.key, lesson.duration)


def _context(state: AppState, user: str, source: StudySource, course_id, lesson_key) -> SessionContext:
    if source is StudySource.VIDEO:
        return _video_context(state, user, course_id, lesson_key)
    return SessionContext()


def _set_timezone_if_missing(state: AppState, user: str, timezone: str | None) -> None:
    if not timezone:
        return
    try:
        state.preferences.set_timezone(user, timezone, only_if_missing=True)
    except InvalidTimezone:
        pass  # o fuso é só uma sugestão aqui; a métrica usa o padrão


# --- sessões e trechos ----------------------------------------------------------


class OpenSessionBody(BaseModel):
    id: str = Field(pattern=SESSION_ID)
    source: Literal["video", "timer"]
    course_id: str | None = Field(default=None, max_length=200)
    lesson_key: str | None = Field(default=None, max_length=200)
    timezone: str | None = Field(default=None, max_length=64)


@router.post("/sessions")
def open_session(body: OpenSessionBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    state.limiter.hit(f"study-open:{user}", SESSION_LIMIT, SESSION_WINDOW)
    source = StudySource(body.source)
    context = _context(state, user, source, body.course_id, body.lesson_key)
    _set_timezone_if_missing(state, user, body.timezone)
    session = state.study.open_session(user, body.id, source, context)
    return session.to_dict()


class SegmentBody(BaseModel):
    seq: int = Field(ge=0, le=1_000_000)
    start_ms: int = Field(ge=0, le=10**9)
    end_ms: int = Field(gt=0, le=10**9)
    media_from: float | None = Field(default=None, ge=0, le=10**6)
    media_to: float | None = Field(default=None, ge=0, le=10**6)
    rate: float | None = Field(default=None, gt=0, le=16)


class SegmentsBody(BaseModel):
    segments: list[SegmentBody] = Field(min_length=1, max_length=MAX_SEGMENTS_PER_REQUEST)


@router.post("/sessions/{session_id}/segments")
def record_segments(
    session_id: str,
    body: SegmentsBody,
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
) -> dict:
    state.limiter.hit(f"study-segments:{user}", SEGMENT_LIMIT, SEGMENT_WINDOW)
    session = state.study.get_session(user, session_id)  # 404 se não for do usuário
    try:
        context = _context(state, user, session.source, session.course_id, session.lesson_key)
    except LessonNotTrackable:
        context = None  # a aula saiu do curso depois da abertura: nada mais é creditado
    if context is None:
        return {
            "session": session.to_dict(),
            "results": [
                {"seq": s.seq, "status": "rejected", "credited_seconds": 0, "reason": "lesson_unavailable", "duplicate": False}
                for s in body.segments
            ],
        }
    # Repetições no mesmo pedido: vale a primeira.
    seen: set[int] = set()
    claims = []
    for s in body.segments:
        if s.seq in seen:
            continue
        seen.add(s.seq)
        claims.append(SegmentClaim(s.seq, s.start_ms, s.end_ms, s.media_from, s.media_to, s.rate))
    session, results = state.study.record(user, session_id, claims, context)
    return {"session": session.to_dict(), "results": [r.to_dict() for r in results]}


# --- métricas e preferências -------------------------------------------------------


@router.get("/metrics")
def metrics(state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    return state.metrics.for_user(user)


@router.get("/calendar")
def calendar(
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
) -> dict:
    """Dias estudados de um mês (`?month=2026-10`), para o calendário da tela inicial."""
    year, number = (int(part) for part in month.split("-"))
    if not 2000 <= year <= 2100:
        raise MonthOutOfRange()
    return state.metrics.month(user, year, number)


class MonthOutOfRange(AppError):
    def __init__(self) -> None:
        super().__init__(422, "month_out_of_range", "Mês fora do intervalo aceito.", field="month")


class PreferencesBody(BaseModel):
    timezone: str = Field(max_length=64)


@router.get("/preferences")
def get_preferences(state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    return {"timezone": state.preferences.timezone(user)}


@router.put("/preferences")
def set_preferences(
    body: PreferencesBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)
) -> dict:
    try:
        return {"timezone": state.preferences.set_timezone(user, body.timezone)}
    except InvalidTimezone as exc:
        raise BadTimezone() from exc
