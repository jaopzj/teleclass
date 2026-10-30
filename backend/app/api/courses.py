"""Área de membros: biblioteca, página do curso, aula, progresso e anotações.

As rotas são síncronas de propósito: usam SQLite e a indexação (CPU), e o
FastAPI as executa em threads, sem travar o streaming dos vídeos.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..courses import Course, CourseLesson, CourseNotFound
from ..courses.catalog import CourseNode
from ..learning import CourseProgress, LessonProgress, NoteConflict, summarize
from ..learning.notes import MAX_NOTE_LENGTH
from ..learning.summary import is_valid_lesson
from .deps import AppState, get_state, get_user_id

router = APIRouter(prefix="/api/courses", tags=["cursos"])


# --- serialização -----------------------------------------------------------


def _lesson_ref(lesson: CourseLesson | None) -> dict | None:
    if lesson is None:
        return None
    return {"key": lesson.key, "number": lesson.index + 1, "title": lesson.title, "path": lesson.path}


def _lesson_summary(lesson: CourseLesson, progress: LessonProgress | None) -> dict:
    video = lesson.video
    media = video.media if video else None
    return {
        "key": lesson.key,
        "number": lesson.index + 1,
        "title": lesson.title,
        "ref": lesson.lesson.ref_raw,
        "kind": lesson.kind.value,
        "duration": lesson.duration,
        "video": (
            {
                "message_id": video.message_id,
                "mime_type": media.mime_type,
                "size": media.size,
                "width": media.width,
                "height": media.height,
                "duration": media.duration,
            }
            if video and media
            else None
        ),
        "progress": progress.to_dict() if progress else None,
    }


def _node(node: CourseNode, progress: dict[str, LessonProgress]) -> dict:
    keys = [lesson.key for lesson in node.walk_lessons() if is_valid_lesson(lesson)]
    return {
        "id": node.id,
        "title": node.title,
        "level": node.level,
        "implicit": node.implicit,
        "total": len(keys),
        "completed": sum(1 for k in keys if (p := progress.get(k)) and p.completed),
        "lessons": [_lesson_summary(lesson, progress.get(lesson.key)) for lesson in node.lessons],
        "children": [_node(child, progress) for child in node.children],
    }


def _progress(summary: CourseProgress, progress: dict[str, LessonProgress]) -> dict:
    resume = _lesson_ref(summary.resume)
    if resume and summary.resume:
        p = progress.get(summary.resume.key)
        resume["position_seconds"] = p.position_seconds if p and not p.completed else 0
        resume["duration"] = summary.resume.duration
    last = _lesson_ref(summary.last_watched)
    if last and summary.last_watched:
        last["watched_at"] = progress[summary.last_watched.key].last_watched_at
    return {
        "completed": summary.completed,
        "total": summary.total,
        "percent": summary.percent,
        "started": summary.started,
        "last_watched": last,
        "resume": resume,
    }


def _stats(course: Course) -> dict:
    return {
        "lessons": len(course.lessons),
        "video_lessons": sum(1 for lesson in course.lessons if lesson.video),
        "modules": len(course.sections),
        "duration": course.total_duration,
    }


# --- acesso -------------------------------------------------------------------


def _course(state: AppState, user: str, course_id: str) -> Course:
    try:
        return state.libraries.catalog(user).get(course_id)
    except CourseNotFound as exc:
        raise HTTPException(404, "Curso não encontrado") from exc


def _lesson(course: Course, key: str) -> CourseLesson:
    lesson = course.lesson(key)
    if lesson is None:
        raise HTTPException(404, "Aula não encontrada")
    return lesson


# --- rotas --------------------------------------------------------------------


@router.get("")
def list_courses(state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> list[dict]:
    items = []
    for course in state.libraries.catalog(user).all():
        progress = state.progress.for_course(user, course.id)
        summary = summarize(course, progress)
        items.append(
            {
                "id": course.id,
                "title": course.title,
                "stats": _stats(course),
                "progress": _progress(summary, progress),
            }
        )
    # Cursos com atividade recente primeiro; depois, por título.
    items.sort(key=lambda c: (c["progress"]["last_watched"] or {}).get("watched_at") or "", reverse=True)
    return items


@router.get("/{course_id}")
def get_course(
    course_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)
) -> dict:
    course = _course(state, user, course_id)
    progress = state.progress.for_course(user, course.id)
    return {
        "id": course.id,
        "title": course.title,
        "strategy": course.strategy,
        "stats": _stats(course),
        "progress": _progress(summarize(course, progress), progress),
        "sections": [_node(node, progress) for node in course.sections],
    }


@router.get("/{course_id}/lessons/{key}")
def get_lesson(
    course_id: str, key: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)
) -> dict:
    course = _course(state, user, course_id)
    lesson = _lesson(course, key)
    progress = state.progress.get(user, course.id, lesson.key)
    return {
        "course": {"id": course.id, "title": course.title, "total": len(course.lessons)},
        "lesson": {
            **_lesson_summary(lesson, progress),
            "path": lesson.path,
            "description": lesson.lesson.description,
            "materials": [
                {
                    "message_id": m.message_id,
                    "kind": m.media.kind.value,
                    "file_name": m.media.file_name,
                    "mime_type": m.media.mime_type,
                    "size": m.media.size,
                }
                for m in lesson.lesson.materials
                if m.media
            ],
        },
        "previous": _lesson_ref(course.previous(lesson)),
        "next": _lesson_ref(course.next(lesson)),
        "note": state.notes.get(user, course.id, lesson.key).to_dict(),
    }


class PositionBody(BaseModel):
    position_seconds: float = Field(ge=0)
    duration_seconds: float | None = Field(default=None, gt=0)


@router.put("/{course_id}/lessons/{key}/progress")
def save_position(
    course_id: str,
    key: str,
    body: PositionBody,
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
) -> dict:
    lesson = _lesson(_course(state, user, course_id), key)
    position = body.position_seconds
    if body.duration_seconds:
        position = min(position, body.duration_seconds)
    return state.progress.save_position(user, course_id, lesson.key, position, body.duration_seconds).to_dict()


class CompletionBody(BaseModel):
    completed: bool


@router.put("/{course_id}/lessons/{key}/completion")
def set_completion(
    course_id: str,
    key: str,
    body: CompletionBody,
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
) -> dict:
    course = _course(state, user, course_id)
    lesson = _lesson(course, key)
    saved = state.progress.set_completed(user, course.id, lesson.key, body.completed)
    summary = summarize(course, state.progress.for_course(user, course.id))
    return {
        "progress": saved.to_dict(),
        "course": {"completed": summary.completed, "total": summary.total, "percent": summary.percent},
    }


@router.get("/{course_id}/lessons/{key}/notes")
def get_notes(
    course_id: str, key: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)
) -> dict:
    lesson = _lesson(_course(state, user, course_id), key)
    return state.notes.get(user, course_id, lesson.key).to_dict()


class NoteBody(BaseModel):
    body: str = Field(max_length=MAX_NOTE_LENGTH)
    base_revision: int = Field(ge=0)


@router.put("/{course_id}/lessons/{key}/notes")
def save_notes(
    course_id: str,
    key: str,
    body: NoteBody,
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
):
    lesson = _lesson(_course(state, user, course_id), key)
    try:
        note = state.notes.save(user, course_id, lesson.key, body.body, body.base_revision)
    except NoteConflict as conflict:
        return JSONResponse(
            status_code=409,
            content={"detail": str(conflict), "current": conflict.current.to_dict()},
        )
    return note.to_dict()
