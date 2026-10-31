"""Caderno Digital: anotações, pastas, etiquetas, versões e busca (docs/caderno.md).

Dois tipos de anotação vivem na mesma tabela:

- `quick`: nota rápida escrita durante a aula. Fica presa à aula
  (`course_id` + `lesson_key`) e pode ter o instante do vídeo
  (`timestamp_seconds`). Usa o editor compacto;
- `page`: documento completo do Caderno, com ou sem vínculo com curso,
  módulo ou aula.

"Transformar em anotação completa" só troca o tipo da mesma linha: o id, o
conteúdo, o tempo, as etiquetas e o histórico continuam os mesmos, sem cópia.

Concorrência: cada gravação de conteúdo informa a revisão em que se baseou.
Se outro dispositivo gravou antes, a gravação é recusada (`NoteConflict`) com a
versão atual; nada é sobrescrito sem a pessoa decidir. Quando ela decide manter
a própria versão, a do servidor vai para o histórico antes de ser substituída.

Isolamento: toda consulta filtra por `user_id`; ids de outro usuário se
comportam como inexistentes (404), sem revelar que existem.
"""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from ..errors import AppError
from ..learning.db import Database, utcnow
from . import document
from .document import Extracted, InvalidDocument

KINDS = ("quick", "page")
MAX_TITLE = 200
MAX_FOLDER_NAME = 80
MAX_FOLDER_DEPTH = 8
MAX_TAG_NAME = 40
MAX_TAGS_PER_NOTE = 20
SNAPSHOT_EVERY = timedelta(minutes=10)
MAX_REVISIONS = 100
TAG_COLORS = ("gray", "blue", "green", "yellow", "orange", "red", "pink", "purple")
VIEWS = ("all", "recent", "favorites", "pinned", "quick", "unfiled", "archived", "trash")
HL_START, HL_END = "\u0002", "\u0003"


class NoteNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "note_not_found", "Anotação não encontrada.")


class FolderNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "folder_not_found", "Pasta não encontrada.", field="folder_id")


class TagNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "tag_not_found", "Etiqueta não encontrada.")


class BadRequest(AppError):
    def __init__(self, code: str, message: str, field: str | None = None) -> None:
        super().__init__(400, code, message, field=field)


class NoteConflict(AppError):
    def __init__(self, current: dict) -> None:
        super().__init__(409, "note_conflict", "Esta anotação foi alterada em outro lugar.", extra={"current": current})
        self.current = current


def new_id() -> str:
    return uuid.uuid4().hex


def _clean_name(value: str, limit: int, what: str) -> str:
    name = " ".join((value or "").split())
    if not name:
        raise BadRequest("name_required", f"Dê um nome para a {what}.", "name")
    if len(name) > limit:
        raise BadRequest("name_too_long", f"O nome pode ter até {limit} caracteres.", "name")
    return name


def _parse_doc(raw, kind: str) -> Extracted:
    try:
        return document.parse(raw, full=kind == "page")
    except InvalidDocument as exc:
        raise BadRequest("invalid_document", f"Não foi possível salvar a anotação: {exc}.") from exc


@dataclass(slots=True)
class Link:
    """Vínculo opcional de uma anotação com um conteúdo do curso."""

    course_id: str | None = None
    section_id: str | None = None
    lesson_key: str | None = None


NOTE_COLUMNS = (
    "n.id, n.seq, n.kind, n.title, n.text, n.words, n.folder_id, n.course_id, n.section_id, n.lesson_key, "
    "n.timestamp_seconds, n.favorite, n.pinned_at, n.archived_at, n.deleted_at, n.revision, n.created_at, "
    "n.updated_at, n.content_updated_at, n.opened_at"
)


class NotebookStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    # --- migração das anotações antigas ---------------------------------------------

    def import_legacy(self) -> int:
        """Converte cada `lesson_notes` (texto puro, uma por aula) em nota rápida."""
        with self.db.transaction() as conn:
            rows = conn.execute(
                "SELECT l.user_id, l.course_id, l.lesson_key, l.body, l.updated_at FROM lesson_notes l "
                "JOIN users u ON u.id = l.user_id"
            ).fetchall()
            for row in rows:
                if row["body"].strip():
                    doc = document.parse(document.from_plain_text(row["body"]), full=False)
                    self._insert(conn, row["user_id"], "quick", "", doc, None,
                                 Link(row["course_id"], None, row["lesson_key"]), None, row["updated_at"])
            conn.execute("DELETE FROM lesson_notes")
        return len(rows)

    # --- pastas ------------------------------------------------------------------------

    def folders(self, user_id: str) -> list[dict]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT f.id, f.parent_id, f.name, f.position, f.created_at, f.updated_at, "
                "(SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id AND n.deleted_at IS NULL "
                " AND n.archived_at IS NULL) AS notes "
                "FROM note_folders f WHERE f.user_id = ? ORDER BY f.position, f.name COLLATE NOCASE",
                (user_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def _folder_map(self, conn: sqlite3.Connection, user_id: str) -> dict[str, sqlite3.Row]:
        rows = conn.execute("SELECT id, parent_id, name FROM note_folders WHERE user_id = ?", (user_id,)).fetchall()
        return {row["id"]: row for row in rows}

    @staticmethod
    def _subtree(folders: dict, root: str) -> set[str]:
        children: dict[str | None, list[str]] = {}
        for fid, row in folders.items():
            children.setdefault(row["parent_id"], []).append(fid)
        out, stack = set(), [root]
        while stack:
            fid = stack.pop()
            if fid in out:
                continue
            out.add(fid)
            stack.extend(children.get(fid, []))
        return out

    @staticmethod
    def _depth(folders: dict, folder_id: str | None) -> int:
        depth, seen = 0, set()
        while folder_id and folder_id in folders and folder_id not in seen:
            seen.add(folder_id)
            depth += 1
            folder_id = folders[folder_id]["parent_id"]
        return depth

    @staticmethod
    def folder_path(folders: dict, folder_id: str | None) -> list[dict]:
        path, seen = [], set()
        while folder_id and folder_id in folders and folder_id not in seen:
            seen.add(folder_id)
            row = folders[folder_id]
            path.append({"id": row["id"], "name": row["name"]})
            folder_id = row["parent_id"]
        return list(reversed(path))

    def folder_index(self, user_id: str) -> dict:
        with self.db.connect() as conn:
            return self._folder_map(conn, user_id)

    def create_folder(self, user_id: str, name: str, parent_id: str | None) -> dict:
        name = _clean_name(name, MAX_FOLDER_NAME, "pasta")
        now = utcnow()
        folder_id = new_id()
        with self.db.transaction() as conn:
            folders = self._folder_map(conn, user_id)
            if parent_id is not None:
                if parent_id not in folders:
                    raise FolderNotFound()
                if self._depth(folders, parent_id) >= MAX_FOLDER_DEPTH:
                    raise BadRequest("folder_too_deep", f"Use no máximo {MAX_FOLDER_DEPTH} níveis de pastas.")
            position = conn.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM note_folders WHERE user_id = ? AND parent_id IS ?",
                (user_id, parent_id),
            ).fetchone()[0]
            conn.execute(
                "INSERT INTO note_folders (id, user_id, parent_id, name, position, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (folder_id, user_id, parent_id, name, position, now, now),
            )
        return {"id": folder_id, "parent_id": parent_id, "name": name, "position": position,
                "created_at": now, "updated_at": now, "notes": 0}

    _UNSET = object()

    def update_folder(self, user_id: str, folder_id: str, *, name: str | None = None,
                      parent_id=_UNSET, position: float | None = None) -> None:
        with self.db.transaction() as conn:
            folders = self._folder_map(conn, user_id)
            if folder_id not in folders:
                raise FolderNotFound()
            fields: dict = {}
            if name is not None:
                fields["name"] = _clean_name(name, MAX_FOLDER_NAME, "pasta")
            if parent_id is not self._UNSET:
                if parent_id is not None:
                    if parent_id not in folders:
                        raise FolderNotFound()
                    if parent_id in self._subtree(folders, folder_id):
                        raise BadRequest("folder_cycle", "Uma pasta não pode ficar dentro dela mesma.")
                    subtree_height = max(
                        self._depth(folders, f) - self._depth(folders, folder_id)
                        for f in self._subtree(folders, folder_id)
                    ) + 1
                    if self._depth(folders, parent_id) + subtree_height > MAX_FOLDER_DEPTH:
                        raise BadRequest("folder_too_deep", f"Use no máximo {MAX_FOLDER_DEPTH} níveis de pastas.")
                fields["parent_id"] = parent_id
                if position is None:
                    fields["position"] = conn.execute(
                        "SELECT COALESCE(MAX(position), 0) + 1 FROM note_folders WHERE user_id = ? AND parent_id IS ?",
                        (user_id, parent_id),
                    ).fetchone()[0]
            if position is not None:
                fields["position"] = float(position)
            if not fields:
                return
            fields["updated_at"] = utcnow()
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(f"UPDATE note_folders SET {sets} WHERE id = ? AND user_id = ?",
                         (*fields.values(), folder_id, user_id))

    def delete_folder(self, user_id: str, folder_id: str) -> int:
        """Apaga a pasta e as subpastas. As anotações de dentro vão para a lixeira."""
        now = utcnow()
        with self.db.transaction() as conn:
            folders = self._folder_map(conn, user_id)
            if folder_id not in folders:
                raise FolderNotFound()
            ids = list(self._subtree(folders, folder_id))
            marks = ",".join("?" * len(ids))
            trashed = conn.execute(
                f"UPDATE notes SET deleted_at = ?, updated_at = ?, folder_id = NULL "
                f"WHERE user_id = ? AND folder_id IN ({marks}) AND deleted_at IS NULL",
                (now, now, user_id, *ids),
            ).rowcount
            # Notas que já estavam na lixeira também perdem a pasta (volta para a raiz ao restaurar).
            conn.execute(f"UPDATE notes SET folder_id = NULL WHERE user_id = ? AND folder_id IN ({marks})",
                         (user_id, *ids))
            conn.execute("DELETE FROM note_folders WHERE id = ? AND user_id = ?", (folder_id, user_id))
        return trashed

    # --- etiquetas ------------------------------------------------------------------------

    def tags(self, user_id: str) -> list[dict]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT t.id, t.name, t.color, "
                "(SELECT COUNT(*) FROM note_tag_links l JOIN notes n ON n.id = l.note_id "
                " WHERE l.tag_id = t.id AND n.deleted_at IS NULL) AS notes "
                "FROM note_tags t WHERE t.user_id = ? ORDER BY t.name COLLATE NOCASE",
                (user_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def create_tag(self, user_id: str, name: str, color: str | None = None) -> dict:
        name = _clean_name(name, MAX_TAG_NAME, "etiqueta")
        color = color if color in TAG_COLORS else TAG_COLORS[abs(hash(name.lower())) % len(TAG_COLORS)]
        tag_id = new_id()
        with self.db.transaction() as conn:
            existing = conn.execute(
                "SELECT id, name, color FROM note_tags WHERE user_id = ? AND name = ? COLLATE NOCASE", (user_id, name)
            ).fetchone()
            if existing:
                return {**dict(existing), "notes": None, "existing": True}
            conn.execute("INSERT INTO note_tags (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)",
                         (tag_id, user_id, name, color, utcnow()))
        return {"id": tag_id, "name": name, "color": color, "notes": 0}

    def update_tag(self, user_id: str, tag_id: str, *, name: str | None = None, color: str | None = None) -> None:
        fields: dict = {}
        if name is not None:
            fields["name"] = _clean_name(name, MAX_TAG_NAME, "etiqueta")
        if color is not None:
            if color not in TAG_COLORS:
                raise BadRequest("invalid_color", "Cor inválida.", "color")
            fields["color"] = color
        with self.db.transaction() as conn:
            if not conn.execute("SELECT 1 FROM note_tags WHERE id = ? AND user_id = ?", (tag_id, user_id)).fetchone():
                raise TagNotFound()
            if "name" in fields and conn.execute(
                "SELECT 1 FROM note_tags WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?",
                (user_id, fields["name"], tag_id),
            ).fetchone():
                raise BadRequest("tag_exists", "Já existe uma etiqueta com esse nome.", "name")
            if fields:
                sets = ", ".join(f"{k} = ?" for k in fields)
                conn.execute(f"UPDATE note_tags SET {sets} WHERE id = ?", (*fields.values(), tag_id))

    def delete_tag(self, user_id: str, tag_id: str) -> None:
        with self.db.connect() as conn:
            if conn.execute("DELETE FROM note_tags WHERE id = ? AND user_id = ?", (tag_id, user_id)).rowcount == 0:
                raise TagNotFound()

    # --- leitura -----------------------------------------------------------------------------

    def _row(self, conn: sqlite3.Connection, user_id: str, note_id: str, *, with_doc: bool = False) -> sqlite3.Row:
        columns = NOTE_COLUMNS + (", n.doc" if with_doc else "")
        row = conn.execute(f"SELECT {columns} FROM notes n WHERE n.id = ? AND n.user_id = ?", (note_id, user_id)).fetchone()
        if row is None:
            raise NoteNotFound()
        return row

    def _tags_for(self, conn: sqlite3.Connection, note_ids: list[str]) -> dict[str, list[dict]]:
        out: dict[str, list[dict]] = {nid: [] for nid in note_ids}
        for chunk in range(0, len(note_ids), 500):
            ids = note_ids[chunk:chunk + 500]
            marks = ",".join("?" * len(ids))
            for row in conn.execute(
                f"SELECT l.note_id, t.id, t.name, t.color FROM note_tag_links l JOIN note_tags t ON t.id = l.tag_id "
                f"WHERE l.note_id IN ({marks}) ORDER BY t.name COLLATE NOCASE",
                ids,
            ):
                out[row["note_id"]].append({"id": row["id"], "name": row["name"], "color": row["color"]})
        return out

    @staticmethod
    def _summary(row: sqlite3.Row, tags: list[dict], folders: dict) -> dict:
        return {
            "id": row["id"],
            "kind": row["kind"],
            "title": row["title"],
            "excerpt": document.excerpt(row["text"]),
            "words": row["words"],
            "folder_id": row["folder_id"],
            "folder_path": NotebookStore.folder_path(folders, row["folder_id"]),
            "course_id": row["course_id"],
            "section_id": row["section_id"],
            "lesson_key": row["lesson_key"],
            "timestamp_seconds": row["timestamp_seconds"],
            "favorite": bool(row["favorite"]),
            "pinned": row["pinned_at"] is not None,
            "archived": row["archived_at"] is not None,
            "deleted_at": row["deleted_at"],
            "revision": row["revision"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "content_updated_at": row["content_updated_at"],
            "opened_at": row["opened_at"],
            "tags": tags,
        }

    def get(self, user_id: str, note_id: str) -> dict:
        with self.db.connect() as conn:
            row = self._row(conn, user_id, note_id, with_doc=True)
            folders = self._folder_map(conn, user_id)
            tags = self._tags_for(conn, [note_id])[note_id]
            refs = [dict(r) for r in conn.execute(
                "SELECT course_id, kind, section_id, lesson_key, seconds FROM note_refs WHERE note_id = ?", (note_id,)
            )]
            files = [dict(r) for r in conn.execute(
                "SELECT f.id, f.kind, f.name, f.mime, f.size, f.width, f.height FROM note_file_links l "
                "JOIN note_files f ON f.id = l.file_id WHERE l.note_id = ?",
                (note_id,),
            )]
        out = self._summary(row, tags, folders)
        out["doc"] = json.loads(row["doc"])
        out["refs"] = refs
        out["files"] = files
        return out

    def mark_opened(self, user_id: str, note_id: str) -> None:
        with self.db.connect() as conn:
            conn.execute("UPDATE notes SET opened_at = ? WHERE id = ? AND user_id = ?", (utcnow(), note_id, user_id))

    def list(self, user_id: str, *, view: str = "all", folder_id: str | None = None, course_id: str | None = None,
             tag_id: str | None = None, lesson_key: str | None = None, sort: str = "updated",
             limit: int = 200) -> list[dict]:
        where = ["n.user_id = ?"]
        params: list = [user_id]
        order = {"updated": "n.updated_at DESC", "created": "n.created_at DESC",
                 "title": "n.title COLLATE NOCASE ASC, n.updated_at DESC",
                 "timestamp": "n.timestamp_seconds IS NULL, n.timestamp_seconds, n.created_at"}.get(sort, "n.updated_at DESC")
        if view == "trash":
            where.append("n.deleted_at IS NOT NULL")
            order = "n.deleted_at DESC"
        else:
            where.append("n.deleted_at IS NULL")
            if view == "archived":
                where.append("n.archived_at IS NOT NULL")
            else:
                where.append("n.archived_at IS NULL")
            if view == "favorites":
                where.append("n.favorite = 1")
            elif view == "pinned":
                where.append("n.pinned_at IS NOT NULL")
                order = "n.pinned_at DESC"
            elif view == "quick":
                where.append("n.kind = 'quick'")
            elif view == "unfiled":
                where.append("n.folder_id IS NULL AND n.course_id IS NULL")
            elif view == "recent":
                order = "MAX(COALESCE(n.opened_at, ''), n.content_updated_at) DESC"
                limit = min(limit, 30)
        if folder_id is not None:
            where.append("n.folder_id = ?")
            params.append(folder_id)
        if course_id is not None:
            # Notas ligadas ao curso e notas que o citam com "@".
            where.append("(n.course_id = ? OR EXISTS (SELECT 1 FROM note_refs r WHERE r.note_id = n.id AND r.course_id = ?))")
            params += [course_id, course_id]
            if lesson_key is not None:
                where.append("(n.lesson_key = ? OR EXISTS (SELECT 1 FROM note_refs r WHERE r.note_id = n.id "
                             "AND r.course_id = ? AND r.lesson_key = ?))")
                params += [lesson_key, course_id, lesson_key]
        if tag_id is not None:
            where.append("EXISTS (SELECT 1 FROM note_tag_links l WHERE l.note_id = n.id AND l.tag_id = ?)")
            params.append(tag_id)
        sql = f"SELECT {NOTE_COLUMNS} FROM notes n WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ?"
        with self.db.connect() as conn:
            rows = conn.execute(sql, (*params, max(1, min(limit, 500)))).fetchall()
            tags = self._tags_for(conn, [r["id"] for r in rows])
            folders = self._folder_map(conn, user_id)
        return [self._summary(r, tags[r["id"]], folders) for r in rows]

    def counts(self, user_id: str) -> dict:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT "
                "SUM(deleted_at IS NULL AND archived_at IS NULL) AS all_notes, "
                "SUM(deleted_at IS NULL AND archived_at IS NULL AND favorite = 1) AS favorites, "
                "SUM(deleted_at IS NULL AND archived_at IS NULL AND pinned_at IS NOT NULL) AS pinned, "
                "SUM(deleted_at IS NULL AND archived_at IS NULL AND kind = 'quick') AS quick, "
                "SUM(deleted_at IS NULL AND archived_at IS NULL AND folder_id IS NULL AND course_id IS NULL) AS unfiled, "
                "SUM(deleted_at IS NULL AND archived_at IS NOT NULL) AS archived, "
                "SUM(deleted_at IS NOT NULL) AS trash "
                "FROM notes WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            courses = conn.execute(
                "SELECT course_id, COUNT(*) AS notes FROM notes WHERE user_id = ? AND course_id IS NOT NULL "
                "AND deleted_at IS NULL AND archived_at IS NULL GROUP BY course_id",
                (user_id,),
            ).fetchall()
        counts = {k: (row[k] or 0) for k in row.keys()}
        counts["all"] = counts.pop("all_notes")
        return {"views": counts, "courses": {r["course_id"]: r["notes"] for r in courses}}

    # --- escrita ---------------------------------------------------------------------------------

    def _check_folder(self, conn: sqlite3.Connection, user_id: str, folder_id: str | None) -> None:
        if folder_id is not None and not conn.execute(
            "SELECT 1 FROM note_folders WHERE id = ? AND user_id = ?", (folder_id, user_id)
        ).fetchone():
            raise FolderNotFound()

    def _check_files(self, conn: sqlite3.Connection, user_id: str, files: set[str]) -> None:
        if not files:
            return
        ids = list(files)
        marks = ",".join("?" * len(ids))
        found = {r[0] for r in conn.execute(
            f"SELECT id FROM note_files WHERE user_id = ? AND id IN ({marks})", (user_id, *ids))}
        if found != files:
            raise BadRequest("file_not_found", "Um arquivo desta anotação não existe mais. Envie-o de novo.")

    def _index(self, conn: sqlite3.Connection, note_id: str, seq: int, user_id: str, title: str, parsed: Extracted) -> None:
        conn.execute("DELETE FROM notes_fts WHERE rowid = ?", (seq,))
        conn.execute("INSERT INTO notes_fts (rowid, title, body) VALUES (?, ?, ?)", (seq, title, parsed.text))
        conn.execute("DELETE FROM note_refs WHERE note_id = ?", (note_id,))
        conn.executemany(
            "INSERT INTO note_refs (note_id, user_id, course_id, kind, section_id, lesson_key, seconds) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(note_id, user_id, r.course_id, r.kind, r.section_id, r.lesson_key, r.seconds) for r in parsed.refs[:500]],
        )
        conn.execute("DELETE FROM note_file_links WHERE note_id = ?", (note_id,))
        conn.executemany("INSERT INTO note_file_links (note_id, file_id) VALUES (?, ?)",
                         [(note_id, f) for f in parsed.files])

    def _insert(self, conn: sqlite3.Connection, user_id: str, kind: str, title: str, parsed: Extracted,
                folder_id: str | None, link: Link, timestamp: float | None, now: str | None = None) -> str:
        now = now or utcnow()
        note_id = new_id()
        seq = conn.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM notes").fetchone()[0]
        title = title if kind == "page" else (title or document.derive_title(parsed.text))
        conn.execute(
            "INSERT INTO notes (id, seq, user_id, kind, title, doc, text, words, folder_id, course_id, section_id, "
            "lesson_key, timestamp_seconds, revision, created_at, updated_at, content_updated_at, opened_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
            (note_id, seq, user_id, kind, title[:MAX_TITLE], json.dumps(parsed.doc, ensure_ascii=False), parsed.text,
             parsed.words, folder_id, link.course_id, link.section_id, link.lesson_key, timestamp, now, now, now,
             now if kind == "page" else None),
        )
        self._index(conn, note_id, seq, user_id, title, parsed)
        return note_id

    def create(self, user_id: str, *, kind: str = "page", title: str = "", doc=None, folder_id: str | None = None,
               link: Link | None = None, timestamp: float | None = None, tag_ids: list[str] | None = None) -> dict:
        if kind not in KINDS:
            raise BadRequest("invalid_kind", "Tipo de anotação inválido.")
        link = link or Link()
        if kind == "quick" and not (link.course_id and link.lesson_key):
            raise BadRequest("quick_needs_lesson", "Notas rápidas pertencem a uma aula.")
        parsed = _parse_doc(doc, kind)
        title = (title or "").strip()[:MAX_TITLE]
        with self.db.transaction() as conn:
            self._check_folder(conn, user_id, folder_id)
            self._check_files(conn, user_id, parsed.files)
            note_id = self._insert(conn, user_id, kind, title, parsed, folder_id, link, timestamp)
            if tag_ids:
                self._set_tags(conn, user_id, note_id, tag_ids)
        return self.get(user_id, note_id)

    def _snapshot(self, conn: sqlite3.Connection, row: sqlite3.Row, reason: str) -> None:
        conn.execute(
            "INSERT INTO note_revisions (note_id, revision, title, doc, words, reason, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (row["id"], row["revision"], row["title"], row["doc"], row["words"], reason, utcnow()),
        )
        conn.execute(
            "DELETE FROM note_revisions WHERE note_id = ? AND id NOT IN "
            "(SELECT id FROM note_revisions WHERE note_id = ? ORDER BY id DESC LIMIT ?)",
            (row["id"], row["id"], MAX_REVISIONS),
        )

    def _should_snapshot(self, conn: sqlite3.Connection, row: sqlite3.Row) -> bool:
        if row["words"] == 0 and not row["title"]:
            return False
        last = conn.execute("SELECT created_at FROM note_revisions WHERE note_id = ? ORDER BY id DESC LIMIT 1",
                            (row["id"],)).fetchone()
        if last is None:
            # Primeira versão guardada depois que o texto "assenta" um pouco.
            created = datetime.fromisoformat(row["content_updated_at"])
            return datetime.now(timezone.utc) - created >= SNAPSHOT_EVERY / 2
        return datetime.now(timezone.utc) - datetime.fromisoformat(last["created_at"]) >= SNAPSHOT_EVERY

    def save_content(self, user_id: str, note_id: str, *, title: str | None, doc, base_revision: int,
                     overwrite: bool = False) -> dict:
        """Grava título e conteúdo. `overwrite` = a pessoa escolheu a própria versão num conflito."""
        with self.db.transaction() as conn:
            row = self._row(conn, user_id, note_id, with_doc=True)
            if row["deleted_at"] is not None:
                raise BadRequest("note_in_trash", "Restaure a anotação da lixeira para editá-la.")
            if row["revision"] != base_revision:
                raise NoteConflict(self._conflict_payload(conn, user_id, row))
            parsed = _parse_doc(doc, row["kind"])
            self._check_files(conn, user_id, parsed.files)
            new_title = (title if title is not None else row["title"]).strip()[:MAX_TITLE]
            if row["kind"] == "quick":
                new_title = document.derive_title(parsed.text)
            new_doc = json.dumps(parsed.doc, ensure_ascii=False)
            if new_doc == row["doc"] and new_title == row["title"]:
                return self._content_ack(row)
            if overwrite:
                self._snapshot(conn, row, "conflict")
            elif self._should_snapshot(conn, row):
                self._snapshot(conn, row, "autosave")
            now = utcnow()
            conn.execute(
                "UPDATE notes SET title = ?, doc = ?, text = ?, words = ?, revision = revision + 1, "
                "updated_at = ?, content_updated_at = ? WHERE id = ?",
                (new_title, new_doc, parsed.text, parsed.words, now, now, note_id),
            )
            self._index(conn, note_id, row["seq"], user_id, new_title, parsed)
            row = self._row(conn, user_id, note_id)
        return self._content_ack(row)

    @staticmethod
    def _content_ack(row: sqlite3.Row) -> dict:
        return {"id": row["id"], "revision": row["revision"], "title": row["title"], "words": row["words"],
                "updated_at": row["updated_at"], "content_updated_at": row["content_updated_at"]}

    def _conflict_payload(self, conn: sqlite3.Connection, user_id: str, row: sqlite3.Row) -> dict:
        return {"id": row["id"], "revision": row["revision"], "title": row["title"], "doc": json.loads(row["doc"]),
                "words": row["words"], "content_updated_at": row["content_updated_at"]}

    def revision_info(self, user_id: str, note_id: str) -> dict:
        """Versão atual (para outros dispositivos saberem se precisam recarregar)."""
        with self.db.connect() as conn:
            row = self._row(conn, user_id, note_id)
        return {"id": row["id"], "revision": row["revision"], "content_updated_at": row["content_updated_at"],
                "deleted": row["deleted_at"] is not None}

    def update(self, user_id: str, note_id: str, changes: dict) -> dict:
        """Metadados: pasta, favorito, fixada, arquivada, etiquetas, vínculo, tempo e tipo."""
        now = utcnow()
        with self.db.transaction() as conn:
            row = self._row(conn, user_id, note_id)
            fields: dict = {}
            if "folder_id" in changes:
                self._check_folder(conn, user_id, changes["folder_id"])
                fields["folder_id"] = changes["folder_id"]
            if "favorite" in changes:
                fields["favorite"] = 1 if changes["favorite"] else 0
            if "pinned" in changes:
                fields["pinned_at"] = (row["pinned_at"] or now) if changes["pinned"] else None
            if "archived" in changes:
                fields["archived_at"] = (row["archived_at"] or now) if changes["archived"] else None
                if changes["archived"]:
                    fields["pinned_at"] = None
            if "timestamp_seconds" in changes:
                fields["timestamp_seconds"] = changes["timestamp_seconds"]
            if "link" in changes:
                link: Link | None = changes["link"]
                if row["kind"] == "quick" and not (link and link.course_id and link.lesson_key):
                    raise BadRequest("quick_needs_lesson", "Notas rápidas continuam ligadas à aula. Transforme-a em "
                                     "anotação completa para mudar o vínculo.")
                fields.update({"course_id": link.course_id if link else None,
                               "section_id": link.section_id if link else None,
                               "lesson_key": link.lesson_key if link else None})
                if not link or not link.lesson_key:
                    fields["timestamp_seconds"] = None
            if "kind" in changes:
                if changes["kind"] != "page":
                    raise BadRequest("invalid_kind", "Só é possível transformar uma nota rápida em anotação completa.")
                if row["kind"] == "quick":
                    fields["kind"] = "page"
                    fields["opened_at"] = now
            if "title" in changes and (fields.get("kind") == "page" or row["kind"] == "page"):
                title = (changes["title"] or "").strip()[:MAX_TITLE]
                fields["title"] = title
            if "tag_ids" in changes:
                self._set_tags(conn, user_id, note_id, changes["tag_ids"])
            if fields:
                fields["updated_at"] = now
                sets = ", ".join(f"{k} = ?" for k in fields)
                conn.execute(f"UPDATE notes SET {sets} WHERE id = ?", (*fields.values(), note_id))
                if "title" in fields:
                    # O título faz parte da busca.
                    conn.execute("UPDATE notes_fts SET title = ? WHERE rowid = ?", (fields["title"], row["seq"]))
        return self.get(user_id, note_id)

    def _set_tags(self, conn: sqlite3.Connection, user_id: str, note_id: str, tag_ids: list[str]) -> None:
        unique = list(dict.fromkeys(tag_ids))
        if len(unique) > MAX_TAGS_PER_NOTE:
            raise BadRequest("too_many_tags", f"Use até {MAX_TAGS_PER_NOTE} etiquetas por anotação.")
        if unique:
            marks = ",".join("?" * len(unique))
            found = {r[0] for r in conn.execute(
                f"SELECT id FROM note_tags WHERE user_id = ? AND id IN ({marks})", (user_id, *unique))}
            if len(found) != len(unique):
                raise TagNotFound()
        conn.execute("DELETE FROM note_tag_links WHERE note_id = ?", (note_id,))
        conn.executemany("INSERT INTO note_tag_links (note_id, tag_id) VALUES (?, ?)", [(note_id, t) for t in unique])

    def duplicate(self, user_id: str, note_id: str) -> dict:
        with self.db.transaction() as conn:
            row = self._row(conn, user_id, note_id, with_doc=True)
            parsed = _parse_doc(row["doc"], "page")
            title = row["title"] or document.derive_title(row["text"]) or "Sem título"
            link = Link(row["course_id"], row["section_id"], row["lesson_key"])
            copy_id = self._insert(conn, user_id, "page", f"{title} (cópia)"[:MAX_TITLE], parsed, row["folder_id"],
                                   link, row["timestamp_seconds"])
            tags = [r[0] for r in conn.execute("SELECT tag_id FROM note_tag_links WHERE note_id = ?", (note_id,))]
            self._set_tags(conn, user_id, copy_id, tags)
        return self.get(user_id, copy_id)

    def trash(self, user_id: str, note_id: str) -> None:
        now = utcnow()
        with self.db.connect() as conn:
            if conn.execute("UPDATE notes SET deleted_at = COALESCE(deleted_at, ?), pinned_at = NULL, updated_at = ? "
                            "WHERE id = ? AND user_id = ?", (now, now, note_id, user_id)).rowcount == 0:
                raise NoteNotFound()

    def restore(self, user_id: str, note_id: str) -> dict:
        with self.db.connect() as conn:
            if conn.execute("UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?",
                            (utcnow(), note_id, user_id)).rowcount == 0:
                raise NoteNotFound()
        return self.get(user_id, note_id)

    def delete_permanently(self, user_id: str, note_id: str) -> list[str]:
        """Exclui de vez (só da lixeira). Devolve os arquivos que ficaram sem nenhuma anotação."""
        with self.db.transaction() as conn:
            row = self._row(conn, user_id, note_id)
            if row["deleted_at"] is None:
                raise BadRequest("not_in_trash", "Mova a anotação para a lixeira antes de excluí-la de vez.")
            return self._purge(conn, user_id, [row])

    def empty_trash(self, user_id: str) -> tuple[int, list[str]]:
        with self.db.transaction() as conn:
            rows = conn.execute("SELECT id, seq FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL",
                                (user_id,)).fetchall()
            return len(rows), self._purge(conn, user_id, rows)

    def _purge(self, conn: sqlite3.Connection, user_id: str, rows: list) -> list[str]:
        orphans: set[str] = set()
        for row in rows:
            files = [r[0] for r in conn.execute("SELECT file_id FROM note_file_links WHERE note_id = ?", (row["id"],))]
            conn.execute("DELETE FROM notes_fts WHERE rowid = ?", (row["seq"],))
            conn.execute("DELETE FROM notes WHERE id = ? AND user_id = ?", (row["id"], user_id))
            for file_id in files:
                if not conn.execute("SELECT 1 FROM note_file_links WHERE file_id = ?", (file_id,)).fetchone():
                    orphans.add(file_id)
        if orphans:
            ids = list(orphans)
            marks = ",".join("?" * len(ids))
            conn.execute(f"DELETE FROM note_files WHERE user_id = ? AND id IN ({marks})", (user_id, *ids))
        return sorted(orphans)

    # --- histórico ----------------------------------------------------------------------------------

    def revisions(self, user_id: str, note_id: str) -> list[dict]:
        with self.db.connect() as conn:
            self._row(conn, user_id, note_id)
            rows = conn.execute(
                "SELECT id, revision, title, words, reason, created_at FROM note_revisions WHERE note_id = ? "
                "ORDER BY id DESC",
                (note_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def revision(self, user_id: str, note_id: str, revision_id: int) -> dict:
        with self.db.connect() as conn:
            self._row(conn, user_id, note_id)
            row = conn.execute("SELECT id, revision, title, doc, words, reason, created_at FROM note_revisions "
                               "WHERE note_id = ? AND id = ?", (note_id, revision_id)).fetchone()
        if row is None:
            raise AppError(404, "revision_not_found", "Versão não encontrada.")
        return {**dict(row), "doc": json.loads(row["doc"])}

    def restore_revision(self, user_id: str, note_id: str, revision_id: int, base_revision: int) -> dict:
        old = self.revision(user_id, note_id, revision_id)
        with self.db.transaction() as conn:
            row = self._row(conn, user_id, note_id, with_doc=True)
            if row["revision"] != base_revision:
                raise NoteConflict(self._conflict_payload(conn, user_id, row))
            self._snapshot(conn, row, "before_restore")
        # Os arquivos de uma versão antiga podem ter sido excluídos: a validação avisa.
        return self.save_content(user_id, note_id, title=old["title"], doc=old["doc"], base_revision=base_revision + 0)

    # --- busca ----------------------------------------------------------------------------------------

    @staticmethod
    def fts_query(text: str) -> str:
        """Busca por todos os termos; cada palavra também casa como prefixo. Aspas = frase exata."""
        parts = []
        for term in re.findall(r'"[^"]+"|\S+', text or "")[:12]:
            if term.startswith('"'):
                words = re.findall(r"\w+", term)
                if words:
                    parts.append('"' + " ".join(words) + '"')
            else:
                parts.extend(f'"{w}"*' for w in re.findall(r"\w+", term))
        return " ".join(parts)

    def search(self, user_id: str, query: str, *, folder_id: str | None = None, course_id: str | None = None,
               tag_id: str | None = None, include_archived: bool = False, limit: int = 40) -> dict:
        match = self.fts_query(query)
        if not match:
            return {"query": query, "results": [], "total": 0}
        where = ["notes_fts MATCH ?", "n.user_id = ?", "n.deleted_at IS NULL"]
        params: list = [match, user_id]
        if not include_archived:
            where.append("n.archived_at IS NULL")
        with self.db.connect() as conn:
            folders = self._folder_map(conn, user_id)
            if folder_id is not None:
                if folder_id not in folders:
                    raise FolderNotFound()
                ids = list(self._subtree(folders, folder_id))
                where.append(f"n.folder_id IN ({','.join('?' * len(ids))})")
                params += ids
            if course_id is not None:
                where.append("(n.course_id = ? OR EXISTS (SELECT 1 FROM note_refs r WHERE r.note_id = n.id AND r.course_id = ?))")
                params += [course_id, course_id]
            if tag_id is not None:
                where.append("EXISTS (SELECT 1 FROM note_tag_links l WHERE l.note_id = n.id AND l.tag_id = ?)")
                params.append(tag_id)
            sql = (
                f"SELECT {NOTE_COLUMNS}, highlight(notes_fts, 0, '{HL_START}', '{HL_END}') AS hl_title, "
                f"snippet(notes_fts, 1, '{HL_START}', '{HL_END}', '…', 18) AS snippet "
                f"FROM notes_fts JOIN notes n ON n.seq = notes_fts.rowid WHERE {' AND '.join(where)} "
                f"ORDER BY bm25(notes_fts, 6.0, 1.0) LIMIT ?"
            )
            try:
                rows = conn.execute(sql, (*params, limit)).fetchall()
                total = conn.execute(
                    f"SELECT COUNT(*) FROM notes_fts JOIN notes n ON n.seq = notes_fts.rowid WHERE {' AND '.join(where)}",
                    params,
                ).fetchone()[0]
            except sqlite3.OperationalError as exc:
                raise BadRequest("invalid_query", "Não entendi essa busca. Tente outras palavras.") from exc
            tags = self._tags_for(conn, [r["id"] for r in rows])
        results = []
        for r in rows:
            item = self._summary(r, tags[r["id"]], folders)
            item["title_highlight"] = r["hl_title"]
            item["snippet"] = r["snippet"]
            results.append(item)
        return {"query": query, "results": results, "total": total}

    # --- aula ---------------------------------------------------------------------------------------

    def for_lesson(self, user_id: str, course_id: str, lesson_key: str) -> dict:
        """Notas rápidas da aula, documentos ligados a ela e anotações que a citam."""
        with self.db.connect() as conn:
            rows = conn.execute(
                f"SELECT {NOTE_COLUMNS}, n.doc FROM notes n WHERE n.user_id = ? AND n.course_id = ? AND n.lesson_key = ? "
                "AND n.deleted_at IS NULL ORDER BY n.timestamp_seconds IS NULL, n.timestamp_seconds, n.created_at",
                (user_id, course_id, lesson_key),
            ).fetchall()
            cited = conn.execute(
                f"SELECT DISTINCT {NOTE_COLUMNS} FROM notes n JOIN note_refs r ON r.note_id = n.id "
                "WHERE r.user_id = ? AND r.course_id = ? AND r.lesson_key = ? AND n.user_id = ? "
                "AND n.deleted_at IS NULL AND NOT (n.course_id IS ? AND n.lesson_key IS ?) "
                "ORDER BY n.updated_at DESC LIMIT 20",
                (user_id, course_id, lesson_key, user_id, course_id, lesson_key),
            ).fetchall()
            moments = conn.execute(
                "SELECT r.note_id, r.seconds FROM note_refs r JOIN notes n ON n.id = r.note_id "
                "WHERE r.user_id = ? AND r.course_id = ? AND r.lesson_key = ? AND r.seconds IS NOT NULL "
                "AND n.deleted_at IS NULL",
                (user_id, course_id, lesson_key),
            ).fetchall()
            ids = [r["id"] for r in rows] + [r["id"] for r in cited]
            tags = self._tags_for(conn, ids)
            folders = self._folder_map(conn, user_id)
        quick, pages = [], []
        for r in rows:
            item = self._summary(r, tags[r["id"]], folders)
            if r["kind"] == "quick":
                item["doc"] = json.loads(r["doc"])
                quick.append(item)
            else:
                pages.append(item)
        by_note: dict[str, list[float]] = {}
        for m in moments:
            by_note.setdefault(m["note_id"], []).append(m["seconds"])
        citing = []
        for r in cited:
            item = self._summary(r, tags[r["id"]], folders)
            item["moments"] = sorted(by_note.get(r["id"], []))
            citing.append(item)
        return {"quick": quick, "pages": pages, "citing": citing}

    # --- arquivos ---------------------------------------------------------------------------------------

    def orphan_files(self, older_than: timedelta = timedelta(days=1)) -> list[tuple[str, str]]:
        """Arquivos enviados que nenhuma anotação usa há mais de um dia (upload abandonado)."""
        limit = utcnow(-older_than)
        with self.db.transaction() as conn:
            rows = conn.execute(
                "SELECT id, user_id FROM note_files f WHERE created_at < ? AND NOT EXISTS "
                "(SELECT 1 FROM note_file_links l WHERE l.file_id = f.id)",
                (limit,),
            ).fetchall()
            conn.executemany("DELETE FROM note_files WHERE id = ?", [(r["id"],) for r in rows])
        return [(r["user_id"], r["id"]) for r in rows]
