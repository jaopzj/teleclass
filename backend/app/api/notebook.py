"""Caderno Digital: anotações, pastas, etiquetas, busca, referências e arquivos.

Tudo exige login e é filtrado pelo usuário da sessão (docs/caderno.md). Cursos,
módulos e aulas vêm do catálogo do próprio usuário, então uma referência só
aponta para conteúdo que ele tem.
"""

from __future__ import annotations

import unicodedata
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..courses import Course, CourseNotFound
from ..courses.catalog import CourseNode
from ..errors import AppError
from ..notebook.store import TAG_COLORS, VIEWS, BadRequest, Link
from .deps import AppState, get_state, get_user_id

router = APIRouter(prefix="/api/notebook", tags=["caderno"])
# Folga para o tempo de um vídeo: a duração do Telegram é arredondada.
DURATION_SLACK = 2.0


# --- catálogo do usuário -------------------------------------------------------------


def _normalize(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text.casefold()) if unicodedata.category(c) != "Mn")


class Catalog:
    """Consulta cursos, módulos e aulas do usuário, com cache durante o pedido."""

    def __init__(self, state: AppState, user_id: str) -> None:
        self.catalog = state.libraries.catalog(user_id)
        self._courses: dict[str, Course | None] = {}
        self._sections: dict[str, dict[str, tuple[CourseNode, list[str]]]] = {}

    def course(self, course_id: str | None) -> Course | None:
        if not course_id:
            return None
        if course_id not in self._courses:
            try:
                self._courses[course_id] = self.catalog.get(course_id)
            except (CourseNotFound, ValueError):
                self._courses[course_id] = None
        return self._courses[course_id]

    def all(self) -> list[Course]:
        courses = []
        for course_id in self.catalog.ids():
            course = self.course(course_id)
            if course:
                courses.append(course)
        return courses

    def sections(self, course: Course) -> dict[str, tuple[CourseNode, list[str]]]:
        if course.id not in self._sections:
            out: dict[str, tuple[CourseNode, list[str]]] = {}

            def walk(node: CourseNode, path: list[str]) -> None:
                out[node.id] = (node, path)
                for child in node.children:
                    walk(child, [*path, node.title])

            for node in course.sections:
                walk(node, [])
            self._sections[course.id] = out
        return self._sections[course.id]

    def describe(self, course_id: str | None, section_id: str | None, lesson_key: str | None) -> dict | None:
        """Títulos e situação de um vínculo/referência (curso removido, aula inexistente...)."""
        if not course_id:
            return None
        course = self.course(course_id)
        if course is None:
            return {"status": "missing_course", "course_title": None}
        info: dict = {"status": "ok", "course_title": course.title}
        if lesson_key:
            lesson = course.lesson(lesson_key)
            if lesson is None:
                info["status"] = "missing_target"
            else:
                info.update(lesson_title=lesson.title, lesson_number=lesson.index + 1, duration=lesson.duration,
                            path=lesson.path, has_video=lesson.video is not None,
                            available=lesson.kind.value != "unavailable")
        elif section_id:
            found = self.sections(course).get(section_id)
            if found is None:
                info["status"] = "missing_target"
            else:
                info.update(section_title=found[0].title, path=found[1])
        return info


def _with_context(catalog: Catalog, item: dict) -> dict:
    item["context"] = catalog.describe(item.get("course_id"), item.get("section_id"), item.get("lesson_key"))
    return item


def _resolve_refs(catalog: Catalog, refs: list[dict]) -> list[dict]:
    out = []
    seen = set()
    for ref in refs:
        key = (ref["course_id"], ref["kind"], ref["section_id"], ref["lesson_key"], ref["seconds"])
        if key in seen:
            continue
        seen.add(key)
        info = catalog.describe(ref["course_id"], ref["section_id"], ref["lesson_key"]) or {}
        status = info.get("status", "missing_course")
        if status == "ok" and ref["seconds"] is not None:
            duration = info.get("duration")
            if duration and ref["seconds"] > duration + DURATION_SLACK:
                status = "out_of_range"
        out.append({**ref, **info, "status": status})
    return out


def _check_link(catalog: Catalog, link: Link, timestamp: float | None = None) -> None:
    if not link.course_id:
        if link.section_id or link.lesson_key:
            raise BadRequest("invalid_link", "Escolha o curso do vínculo.")
        return
    info = catalog.describe(link.course_id, link.section_id, link.lesson_key)
    if info is None or info["status"] == "missing_course":
        raise AppError(404, "course_not_found", "Curso não encontrado.", field="course_id")
    if info["status"] == "missing_target":
        raise AppError(404, "lesson_not_found", "Aula ou módulo não encontrado neste curso.", field="lesson_key")
    if timestamp is not None:
        duration = info.get("duration")
        if duration and timestamp > duration + DURATION_SLACK:
            raise BadRequest("timestamp_out_of_range", "Esse tempo passa da duração do vídeo.", "timestamp_seconds")


# --- visão geral ------------------------------------------------------------------------


@router.get("/overview")
def overview(state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    catalog = Catalog(state, user)
    counts = state.notebook.counts(user)
    courses = []
    for course in catalog.all():
        courses.append({"id": course.id, "title": course.title, "notes": counts["courses"].get(course.id, 0)})
    known = {c["id"] for c in courses}
    for course_id, n in counts["courses"].items():
        if course_id not in known:  # curso removido da biblioteca: as notas continuam acessíveis
            courses.append({"id": course_id, "title": None, "notes": n, "missing": True})
    courses.sort(key=lambda c: (-(c["notes"] > 0), (c["title"] or "~").casefold()))
    return {
        "counts": counts["views"],
        "folders": state.notebook.folders(user),
        "tags": state.notebook.tags(user),
        "courses": courses,
        "tag_colors": list(TAG_COLORS),
    }


# --- anotações ------------------------------------------------------------------------------


@router.get("/notes")
def list_notes(
    view: str = Query("all"),
    folder: str | None = None,
    course: str | None = None,
    lesson: str | None = None,
    tag: str | None = None,
    sort: Literal["updated", "created", "title", "timestamp"] = "updated",
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
) -> list[dict]:
    if view not in VIEWS:
        raise BadRequest("invalid_view", "Visão inválida.")
    catalog = Catalog(state, user)
    notes = state.notebook.list(user, view=view, folder_id=folder, course_id=course, lesson_key=lesson, tag_id=tag, sort=sort)
    return [_with_context(catalog, n) for n in notes]


class LinkBody(BaseModel):
    course_id: str | None = Field(default=None, max_length=200)
    section_id: str | None = Field(default=None, max_length=60)
    lesson_key: str | None = Field(default=None, max_length=120)

    def to_link(self) -> Link:
        return Link(self.course_id, self.section_id if not self.lesson_key else None, self.lesson_key)


class CreateNote(BaseModel):
    kind: Literal["quick", "page"] = "page"
    title: str = Field(default="", max_length=300)
    doc: dict | None = None
    folder_id: str | None = None
    link: LinkBody | None = None
    timestamp_seconds: float | None = Field(default=None, ge=0, le=86_400)
    tag_ids: list[str] = Field(default_factory=list, max_length=20)


@router.post("/notes", status_code=201)
def create_note(body: CreateNote, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    catalog = Catalog(state, user)
    link = body.link.to_link() if body.link else Link()
    timestamp = body.timestamp_seconds if link.lesson_key else None
    _check_link(catalog, link, timestamp)
    note = state.notebook.create(user, kind=body.kind, title=body.title, doc=body.doc, folder_id=body.folder_id,
                                 link=link, timestamp=timestamp, tag_ids=body.tag_ids)
    note["refs"] = _resolve_refs(catalog, note["refs"])
    return _with_context(catalog, note)


@router.get("/notes/{note_id}")
def get_note(note_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    catalog = Catalog(state, user)
    note = state.notebook.get(user, note_id)
    state.notebook.mark_opened(user, note_id)
    note["refs"] = _resolve_refs(catalog, note["refs"])
    return _with_context(catalog, note)


@router.get("/notes/{note_id}/revision")
def note_revision(note_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    """Leve: outros dispositivos consultam para saber se a nota mudou."""
    return state.notebook.revision_info(user, note_id)


class ContentBody(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    doc: dict
    base_revision: int = Field(ge=0)
    overwrite: bool = False


@router.put("/notes/{note_id}/content")
def save_content(note_id: str, body: ContentBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    ack = state.notebook.save_content(user, note_id, title=body.title, doc=body.doc, base_revision=body.base_revision,
                                      overwrite=body.overwrite)
    catalog = Catalog(state, user)
    ack["refs"] = _resolve_refs(catalog, state.notebook.get(user, note_id)["refs"])
    return ack


class UpdateNote(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    folder_id: str | None = None
    favorite: bool | None = None
    pinned: bool | None = None
    archived: bool | None = None
    tag_ids: list[str] | None = Field(default=None, max_length=20)
    link: LinkBody | None = None
    timestamp_seconds: float | None = Field(default=None, ge=0, le=86_400)
    kind: Literal["page"] | None = None


@router.patch("/notes/{note_id}")
def update_note(note_id: str, body: UpdateNote, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    catalog = Catalog(state, user)
    sent = body.model_fields_set
    changes: dict = {k: getattr(body, k) for k in ("title", "folder_id", "favorite", "pinned", "archived", "tag_ids", "kind")
                     if k in sent and (getattr(body, k) is not None or k == "folder_id")}
    current = state.notebook.get(user, note_id)
    if "link" in sent:
        link = body.link.to_link() if body.link else None
        if link:
            _check_link(catalog, link)
        changes["link"] = link
    if "timestamp_seconds" in sent:
        link = changes.get("link") or Link(current["course_id"], current["section_id"], current["lesson_key"])
        if body.timestamp_seconds is not None:
            if not link.lesson_key:
                raise BadRequest("timestamp_needs_lesson", "Ligue a anotação a uma aula para marcar um tempo.")
            _check_link(catalog, link, body.timestamp_seconds)
        changes["timestamp_seconds"] = body.timestamp_seconds
    note = state.notebook.update(user, note_id, changes)
    note["refs"] = _resolve_refs(catalog, note["refs"])
    return _with_context(catalog, note)


@router.post("/notes/{note_id}/duplicate", status_code=201)
def duplicate_note(note_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    catalog = Catalog(state, user)
    note = state.notebook.duplicate(user, note_id)
    note["refs"] = _resolve_refs(catalog, note["refs"])
    return _with_context(catalog, note)


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: str, permanent: bool = False, state: AppState = Depends(get_state),
                user: str = Depends(get_user_id)) -> Response:
    if permanent:
        orphans = state.notebook.delete_permanently(user, note_id)
        state.notebook_files.remove(user, orphans)
    else:
        state.notebook.trash(user, note_id)
    return Response(status_code=204)


@router.post("/notes/{note_id}/restore")
def restore_note(note_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    return _with_context(Catalog(state, user), state.notebook.restore(user, note_id))


@router.delete("/trash")
def empty_trash(state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    count, orphans = state.notebook.empty_trash(user)
    state.notebook_files.remove(user, orphans)
    return {"deleted": count}


# --- histórico -------------------------------------------------------------------------------


@router.get("/notes/{note_id}/revisions")
def list_revisions(note_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> list[dict]:
    return state.notebook.revisions(user, note_id)


@router.get("/notes/{note_id}/revisions/{revision_id}")
def get_revision(note_id: str, revision_id: int, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    return state.notebook.revision(user, note_id, revision_id)


class RestoreBody(BaseModel):
    base_revision: int = Field(ge=0)


@router.post("/notes/{note_id}/revisions/{revision_id}/restore")
def restore_revision(note_id: str, revision_id: int, body: RestoreBody, state: AppState = Depends(get_state),
                     user: str = Depends(get_user_id)) -> dict:
    state.notebook.restore_revision(user, note_id, revision_id, body.base_revision)
    return get_note(note_id, state, user)


# --- pastas ------------------------------------------------------------------------------------


class FolderBody(BaseModel):
    name: str = Field(max_length=200)
    parent_id: str | None = None


@router.post("/folders", status_code=201)
def create_folder(body: FolderBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    return state.notebook.create_folder(user, body.name, body.parent_id)


class FolderUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    parent_id: str | None = None
    position: float | None = None


@router.patch("/folders/{folder_id}", status_code=204)
def update_folder(folder_id: str, body: FolderUpdate, state: AppState = Depends(get_state),
                  user: str = Depends(get_user_id)) -> Response:
    kwargs: dict = {"name": body.name, "position": body.position}
    if "parent_id" in body.model_fields_set:
        kwargs["parent_id"] = body.parent_id
    state.notebook.update_folder(user, folder_id, **kwargs)
    return Response(status_code=204)


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    return {"trashed": state.notebook.delete_folder(user, folder_id)}


# --- etiquetas ----------------------------------------------------------------------------------


class TagBody(BaseModel):
    name: str = Field(max_length=100)
    color: str | None = None


@router.post("/tags", status_code=201)
def create_tag(body: TagBody, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> dict:
    return state.notebook.create_tag(user, body.name, body.color)


class TagUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    color: str | None = None


@router.patch("/tags/{tag_id}", status_code=204)
def update_tag(tag_id: str, body: TagUpdate, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> Response:
    state.notebook.update_tag(user, tag_id, name=body.name, color=body.color)
    return Response(status_code=204)


@router.delete("/tags/{tag_id}", status_code=204)
def delete_tag(tag_id: str, state: AppState = Depends(get_state), user: str = Depends(get_user_id)) -> Response:
    state.notebook.delete_tag(user, tag_id)
    return Response(status_code=204)


# --- busca -----------------------------------------------------------------------------------------


@router.get("/search")
def search(
    q: str = Query(max_length=300),
    folder: str | None = None,
    course: str | None = None,
    tag: str | None = None,
    archived: bool = False,
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
) -> dict:
    catalog = Catalog(state, user)
    result = state.notebook.search(user, q, folder_id=folder, course_id=course, tag_id=tag, include_archived=archived)
    result["results"] = [_with_context(catalog, r) for r in result["results"]]
    return result


# --- referências com "@" ----------------------------------------------------------------------------


@router.get("/targets")
def targets(
    q: str = Query("", max_length=120),
    course: str | None = None,
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
) -> list[dict]:
    """Sugestões para o "@": cursos, módulos e aulas do usuário que combinam com o texto."""
    catalog = Catalog(state, user)
    terms = _normalize(q).split()
    courses = [catalog.course(course)] if course else catalog.all()
    courses = [c for c in courses if c]

    def matches(*texts: str) -> bool:
        haystack = _normalize(" ".join(t for t in texts if t))
        return all(t in haystack for t in terms)

    out: list[dict] = []
    for c in courses:
        if matches(c.title) and not course:
            out.append({"kind": "course", "course_id": c.id, "course_title": c.title, "title": c.title, "path": []})
        for section_id, (node, path) in catalog.sections(c).items():
            if node.implicit:
                continue
            if matches(node.title, c.title if course else ""):
                out.append({"kind": "section", "course_id": c.id, "course_title": c.title, "section_id": section_id,
                            "title": node.title, "path": path})
        for lesson in c.lessons:
            if lesson.kind.value == "unavailable":
                continue
            ref = lesson.lesson.ref_raw or ""
            if matches(lesson.title, ref, c.title if not terms else "", " ".join(lesson.path) if terms else ""):
                out.append({"kind": "lesson", "course_id": c.id, "course_title": c.title, "lesson_key": lesson.key,
                            "title": lesson.title, "number": lesson.index + 1, "path": lesson.path,
                            "duration": lesson.duration, "has_video": lesson.video is not None})
    # Cursos primeiro, depois módulos e aulas; o que começa com o texto sobe.
    order = {"course": 0, "section": 1, "lesson": 2}
    first = terms[0] if terms else ""
    out.sort(key=lambda t: (order[t["kind"]] if not terms else 0, not _normalize(t["title"]).startswith(first),
                            order[t["kind"]]))
    return out[:40]


# --- aula -------------------------------------------------------------------------------------------


@router.get("/lessons/{course_id}/{lesson_key}")
def lesson_notes(course_id: str, lesson_key: str, state: AppState = Depends(get_state),
                 user: str = Depends(get_user_id)) -> dict:
    catalog = Catalog(state, user)
    _check_link(catalog, Link(course_id, None, lesson_key))
    data = state.notebook.for_lesson(user, course_id, lesson_key)
    for group in ("pages", "citing"):
        data[group] = [_with_context(catalog, n) for n in data[group]]
    return data


# --- arquivos -----------------------------------------------------------------------------------------


@router.post("/files", status_code=201)
def upload_file(
    file: UploadFile = File(...),
    kind: Literal["image", "file"] = Form("file"),
    state: AppState = Depends(get_state),
    user: str = Depends(get_user_id),
) -> dict:
    stored = state.notebook_files.save(user, file.file, file.filename, as_image=kind == "image")
    return stored.to_dict()


@router.get("/files/{file_id}")
def download_file(file_id: str, download: bool = False, state: AppState = Depends(get_state),
                  user: str = Depends(get_user_id)):
    stored, path = state.notebook_files.get(user, file_id)
    inline = stored.kind == "image" and not download
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
        "Cache-Control": "private, max-age=31536000, immutable",
        "Cross-Origin-Resource-Policy": "same-origin",
    }
    return FileResponse(
        path,
        media_type=stored.mime if inline else "application/octet-stream",
        filename=stored.name,
        content_disposition_type="inline" if inline else "attachment",
        headers=headers,
    )
