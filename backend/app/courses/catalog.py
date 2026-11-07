"""Catálogo de cursos sobre os snapshots indexados.

Não existe um cadastro paralelo de cursos: cada snapshot em `data/snapshots/` é
um curso, e a estrutura vem de `index_snapshot` (a mesma usada na tela de
indexação). Este módulo só acrescenta o que o consumo precisa:

- uma **chave estável** por aula, usada para gravar progresso e anotações. É o
  identificador do sumário (`A001`) ou, no fallback, `msg-<id da mensagem>`.
  Reindexar o canal não muda a chave, então o progresso não se perde;
- a **ordem linear** das aulas (a ordem do sumário, percorrendo módulos e
  subtópicos), que define aula anterior e próxima;
- o **material principal** de cada aula (o vídeo a reproduzir).

O resultado fica em memória e é recalculado quando o arquivo do snapshot muda.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Iterator

from ..indexing.models import ChannelSnapshot, MediaInfo, MediaKind
from ..indexing.pipeline import index_snapshot
from ..indexing.structure import CourseSection, Lesson, Material
from ..snapshots import SnapshotNotFound, SnapshotStore

IMPLICIT_SECTION_TITLE = "Conteúdo inicial"


class CourseNotFound(LookupError):
    pass


class LessonKind(StrEnum):
    VIDEO = "video"  # tem um vídeo para reproduzir
    FILE = "file"  # só arquivos (PDF, RAR, áudio...)
    TEXT = "text"  # só texto (avisos, links)
    UNAVAILABLE = "unavailable"  # está no sumário, mas nenhuma mensagem foi encontrada


@dataclass(slots=True)
class CourseLesson:
    key: str
    index: int  # posição na ordem linear, a partir de 0
    lesson: Lesson
    section_id: str
    path: list[str]  # títulos das seções, do módulo até o subtópico
    kind: LessonKind
    video: Material | None

    @property
    def title(self) -> str:
        return self.lesson.title

    @property
    def duration(self) -> float | None:
        return self.video.media.duration if self.video and self.video.media else None

    def message_ids(self) -> set[int]:
        return {m.message_id for m in self.lesson.materials}


@dataclass(slots=True)
class CourseNode:
    id: str
    title: str
    level: int
    implicit: bool
    lessons: list[CourseLesson] = field(default_factory=list)
    children: list[CourseNode] = field(default_factory=list)

    def walk_lessons(self) -> Iterator[CourseLesson]:
        yield from self.lessons
        for child in self.children:
            yield from child.walk_lessons()


@dataclass(slots=True)
class Course:
    id: str
    title: str
    channel_id: int | None
    username: str | None
    strategy: str
    sections: list[CourseNode]
    lessons: list[CourseLesson]
    _by_key: dict[str, CourseLesson] = field(default_factory=dict, repr=False)
    _media: dict[int, MediaInfo] = field(default_factory=dict, repr=False)

    def lesson(self, key: str) -> CourseLesson | None:
        return self._by_key.get(key)

    def previous(self, lesson: CourseLesson) -> CourseLesson | None:
        return self.lessons[lesson.index - 1] if lesson.index > 0 else None

    def next(self, lesson: CourseLesson) -> CourseLesson | None:
        i = lesson.index + 1
        return self.lessons[i] if i < len(self.lessons) else None

    def has_media(self, message_id: int) -> bool:
        """Só mensagens que fazem parte do curso podem ser servidas pela API."""
        return message_id in self._media

    def media_info(self, message_id: int) -> MediaInfo | None:
        return self._media.get(message_id)

    @property
    def total_duration(self) -> float:
        return sum(lesson.duration or 0 for lesson in self.lessons)


def lesson_key(lesson: Lesson) -> str:
    if lesson.ref:
        return lesson.ref
    if lesson.materials:
        return f"msg-{lesson.materials[0].message_id}"
    return f"pos-{lesson.position}"


def _primary_video(lesson: Lesson) -> Material | None:
    # Materiais que motivaram a associação (tag) vêm antes dos que vieram junto no álbum.
    for material in lesson.materials:
        if material.media and material.media.kind is MediaKind.VIDEO:
            return material
    return None


def _kind(lesson: Lesson, video: Material | None) -> LessonKind:
    if video:
        return LessonKind.VIDEO
    if not lesson.materials:
        return LessonKind.UNAVAILABLE
    if any(m.media for m in lesson.materials):
        return LessonKind.FILE
    return LessonKind.TEXT


def build_course(course_id: str, snapshot: ChannelSnapshot) -> Course:
    result = index_snapshot(snapshot)
    lessons: list[CourseLesson] = []
    by_key: dict[str, CourseLesson] = {}

    def convert(section: CourseSection, section_id: str, path: list[str]) -> CourseNode:
        title = IMPLICIT_SECTION_TITLE if section.implicit else section.title
        node = CourseNode(section_id, title, section.level, section.implicit)
        here = [*path, title]
        for lesson in section.lessons:
            key = lesson_key(lesson)
            if key in by_key:  # a indexação já remove duplicatas; isto é só uma garantia
                continue
            video = _primary_video(lesson)
            item = CourseLesson(key, len(lessons), lesson, section_id, here, _kind(lesson, video), video)
            lessons.append(item)
            by_key[key] = item
            node.lessons.append(item)
        node.children = [
            convert(child, f"{section_id}.{i + 1}", here) for i, child in enumerate(section.children)
        ]
        return node

    sections = [convert(s, str(i + 1), []) for i, s in enumerate(result.course.sections)]
    media = {m.message_id: m.media for item in lessons for m in item.lesson.materials if m.media}
    return Course(
        id=course_id,
        title=result.course.title,
        channel_id=snapshot.channel_id,
        username=snapshot.username,
        strategy=result.course.strategy.value,
        sections=sections,
        lessons=lessons,
        _by_key=by_key,
        _media=media,
    )


class CourseCatalog:
    """Cursos montados a partir do `SnapshotStore`, com cache por data de modificação."""

    def __init__(self, store: SnapshotStore) -> None:
        self.store = store
        self._cache: dict[str, tuple[float, Course]] = {}
        self._lock = threading.Lock()

    def ids(self) -> list[str]:
        return self.store.names()

    def get(self, course_id: str) -> Course:
        try:
            mtime = self.store.modified_at(course_id)
        except SnapshotNotFound as exc:
            raise CourseNotFound(course_id) from exc
        with self._lock:
            cached = self._cache.get(course_id)
            if cached and cached[0] == mtime:
                return cached[1]
        course = build_course(course_id, self.store.load(course_id))
        with self._lock:
            self._cache[course_id] = (mtime, course)
        return course

    def remove(self, course_id: str) -> None:
        """Apaga o snapshot do curso (a biblioteca é do usuário, nada é compartilhado)."""
        try:
            self.store.delete(course_id)
        except SnapshotNotFound as exc:
            raise CourseNotFound(course_id) from exc
        finally:
            with self._lock:
                self._cache.pop(course_id, None)

    def all(self) -> list[Course]:
        courses = []
        for course_id in self.ids():
            try:
                courses.append(self.get(course_id))
            except CourseNotFound:
                continue  # apagado entre a listagem e a leitura
        return courses
