"""Resumo do progresso de um curso: percentual, última aula e onde continuar.

Regra única de progresso, usada pela biblioteca, pela página do curso e pelas
métricas de estudo:

- só contam **aulas válidas**: as que existem hoje no curso e não estão
  indisponíveis (citadas no sumário, mas sem mensagem no canal);
- cada aula conta uma vez, mesmo concluída de novo ou em outro dispositivo;
- o percentual é arredondado para baixo e fica entre 0 e 100: 100% só quando
  todas as aulas válidas estão concluídas.

Se o curso mudar (aulas novas, removidas ou que ficaram indisponíveis), o
percentual é recalculado sobre a estrutura atual; conclusões de aulas que
saíram do curso continuam gravadas, mas deixam de contar.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from ..courses import Course, CourseLesson
from ..courses.catalog import LessonKind
from .progress import LessonProgress


def is_valid_lesson(lesson: CourseLesson) -> bool:
    return lesson.kind is not LessonKind.UNAVAILABLE


def percent_of(completed: int, total: int) -> int:
    if total <= 0:
        return 0
    return max(0, min(100, (100 * completed) // total))


@dataclass(frozen=True, slots=True)
class CourseProgress:
    completed: int
    total: int
    last_watched: CourseLesson | None
    resume: CourseLesson | None
    valid_keys: frozenset[str] = frozenset()

    @property
    def percent(self) -> int:
        return percent_of(self.completed, self.total)

    @property
    def started(self) -> bool:
        return self.last_watched is not None or self.completed > 0


def summarize(course: Course, progress: Mapping[str, LessonProgress]) -> CourseProgress:
    """Só conta aulas que existem no curso, cada uma uma única vez.

    Onde continuar: a última aula assistida, se não estiver concluída; senão, a
    próxima não concluída depois dela; senão, a primeira não concluída do curso.
    """
    lessons = course.lessons
    valid = frozenset(lesson.key for lesson in lessons if is_valid_lesson(lesson))
    done = {key for key in valid if (p := progress.get(key)) and p.completed}

    watched = [
        (p.last_watched_at, lesson)
        for lesson in lessons
        if (p := progress.get(lesson.key)) and p.last_watched_at
    ]
    last = max(watched, key=lambda item: item[0])[1] if watched else None

    def first_pending(start: int) -> CourseLesson | None:
        return next((item for item in lessons[start:] if item.key in valid and item.key not in done), None)

    if last is None:
        resume = first_pending(0)
    elif last.key not in done:
        resume = last
    else:
        resume = first_pending(last.index + 1) or first_pending(0)
    if resume is None and lessons:
        resume = last or lessons[0]  # curso concluído: volta à última aula
    return CourseProgress(len(done), len(valid), last, resume, valid)
