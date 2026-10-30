"""Resumo do progresso de um curso: percentual, última aula e onde continuar."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from ..courses import Course, CourseLesson
from .progress import LessonProgress


@dataclass(frozen=True, slots=True)
class CourseProgress:
    completed: int
    total: int
    last_watched: CourseLesson | None
    resume: CourseLesson | None

    @property
    def percent(self) -> int:
        return round(100 * self.completed / self.total) if self.total else 0

    @property
    def started(self) -> bool:
        return self.last_watched is not None or self.completed > 0


def summarize(course: Course, progress: Mapping[str, LessonProgress]) -> CourseProgress:
    """Só conta aulas que existem no curso, cada uma uma única vez.

    Onde continuar: a última aula assistida, se não estiver concluída; senão, a
    próxima não concluída depois dela; senão, a primeira não concluída do curso.
    """
    lessons = course.lessons
    done = {lesson.key for lesson in lessons if (p := progress.get(lesson.key)) and p.completed}

    watched = [
        (p.last_watched_at, lesson)
        for lesson in lessons
        if (p := progress.get(lesson.key)) and p.last_watched_at
    ]
    last = max(watched, key=lambda item: item[0])[1] if watched else None

    def first_pending(start: int) -> CourseLesson | None:
        return next((item for item in lessons[start:] if item.key not in done), None)

    if last is None:
        resume = first_pending(0)
    elif last.key not in done:
        resume = last
    else:
        resume = first_pending(last.index + 1) or first_pending(0)
    if resume is None and lessons:
        resume = last or lessons[0]  # curso concluído: volta à última aula
    return CourseProgress(len(done), len(lessons), last, resume)
