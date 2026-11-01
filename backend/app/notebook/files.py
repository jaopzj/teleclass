"""Imagens e anexos das anotações.

- Cada arquivo fica em `data/notebook/<usuário>/<id>`, sem extensão e fora da
  pasta servida pelo frontend. O nome original só é usado no download.
- O tipo é conferido pelo conteúdo (assinatura dos primeiros bytes), não pelo
  nome nem pelo `Content-Type` enviado: um `.png` que não é PNG é recusado.
- Imagens aceitas: PNG, JPEG, GIF e WebP (SVG não, porque pode conter script).
  Outros arquivos só de uma lista de extensões e sempre servidos como download.
- Limites de tamanho por arquivo e de espaço por usuário.
- Só o dono baixa o arquivo; para os outros ele não existe (404).
"""

from __future__ import annotations

import hashlib
import os
import struct
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from ..errors import AppError
from ..learning.db import Database, utcnow
from .store import new_id

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_FILE_BYTES = 25 * 1024 * 1024
USER_QUOTA_BYTES = 1024 * 1024 * 1024
READ_CHUNK = 1024 * 1024

IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
FILE_EXTENSIONS = {
    # documentos
    "pdf": "application/pdf", "txt": "text/plain", "md": "text/markdown", "csv": "text/csv", "rtf": "application/rtf",
    "doc": "application/msword", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint", "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "odt": "application/vnd.oasis.opendocument.text", "ods": "application/vnd.oasis.opendocument.spreadsheet",
    "odp": "application/vnd.oasis.opendocument.presentation", "epub": "application/epub+zip",
    # compactados
    "zip": "application/zip", "rar": "application/vnd.rar", "7z": "application/x-7z-compressed",
    # código e dados
    "json": "application/json", "xml": "application/xml", "yaml": "text/yaml", "yml": "text/yaml",
    "py": "text/x-python", "java": "text/x-java", "js": "text/javascript", "ts": "text/plain", "c": "text/x-c",
    "cpp": "text/x-c++", "h": "text/x-c", "cs": "text/plain", "go": "text/plain", "rs": "text/plain",
    "sql": "application/sql", "html": "text/html", "css": "text/css", "ipynb": "application/json",
    # mídia
    "mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg", "m4a": "audio/mp4",
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
}


class UploadRejected(AppError):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(status, code, message, field="file")


class FileNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "file_not_found", "Arquivo não encontrado.")


def sniff_image(head: bytes) -> str | None:
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def image_size(head: bytes, mime: str) -> tuple[int | None, int | None]:
    """Largura e altura lidas do cabeçalho (sem biblioteca de imagens)."""
    try:
        if mime == "image/png" and len(head) >= 24:
            w, h = struct.unpack(">II", head[16:24])
            return w, h
        if mime == "image/gif" and len(head) >= 10:
            w, h = struct.unpack("<HH", head[6:10])
            return w, h
        if mime == "image/webp" and len(head) >= 30:
            chunk = head[12:16]
            if chunk == b"VP8X":
                w = int.from_bytes(head[24:27], "little") + 1
                h = int.from_bytes(head[27:30], "little") + 1
                return w, h
            if chunk == b"VP8 ":
                w, h = struct.unpack("<HH", head[26:30])
                return w & 0x3FFF, h & 0x3FFF
            if chunk == b"VP8L":
                bits = int.from_bytes(head[21:25], "little")
                return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        if mime == "image/jpeg":
            i = 2
            while i + 9 < len(head):
                if head[i] != 0xFF:
                    i += 1
                    continue
                marker = head[i + 1]
                if marker in (0xC0, 0xC1, 0xC2):
                    h, w = struct.unpack(">HH", head[i + 5:i + 9])
                    return w, h
                length = struct.unpack(">H", head[i + 2:i + 4])[0]
                i += 2 + length
    except struct.error:
        pass
    return None, None


def clean_filename(name: str | None) -> str:
    name = os.path.basename((name or "").replace("\\", "/")).strip()
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '<>:"|?*')
    return name[:180] or "arquivo"


@dataclass(slots=True)
class StoredFile:
    id: str
    kind: str  # image | file
    name: str
    mime: str
    size: int
    width: int | None
    height: int | None

    def to_dict(self) -> dict:
        return {"id": self.id, "kind": self.kind, "name": self.name, "mime": self.mime, "size": self.size,
                "width": self.width, "height": self.height, "url": f"/api/notebook/files/{self.id}"}


class FileStore:
    def __init__(self, db: Database, root: Path) -> None:
        self.db = db
        self.root = root

    def _dir(self, user_id: str) -> Path:
        if not user_id.isalnum():
            raise ValueError("id de usuário inválido")
        return self.root / user_id

    def path(self, user_id: str, file_id: str) -> Path:
        if not (len(file_id) == 32 and all(c in "0123456789abcdef" for c in file_id)):
            raise FileNotFound()
        return self._dir(user_id) / file_id

    def used_bytes(self, user_id: str) -> int:
        with self.db.connect() as conn:
            return conn.execute("SELECT COALESCE(SUM(size), 0) FROM note_files WHERE user_id = ?", (user_id,)).fetchone()[0]

    def save(self, user_id: str, source: BinaryIO, filename: str | None, *, as_image: bool) -> StoredFile:
        name = clean_filename(filename)
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        limit = MAX_IMAGE_BYTES if as_image else MAX_FILE_BYTES
        directory = self._dir(user_id)
        directory.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size = 0
        head = b""
        fd, tmp_name = tempfile.mkstemp(dir=directory, prefix=".upload-")
        tmp = Path(tmp_name)
        try:
            with os.fdopen(fd, "wb") as out:
                while chunk := source.read(READ_CHUNK):
                    size += len(chunk)
                    if size > limit:
                        raise UploadRejected("file_too_large", f"O arquivo passa do limite de {limit // (1024 * 1024)} MB.", 413)
                    if len(head) < 4096:
                        head += chunk[: 4096 - len(head)]
                    digest.update(chunk)
                    out.write(chunk)
            if size == 0:
                raise UploadRejected("file_empty", "O arquivo está vazio.")
            sniffed = sniff_image(head)
            if as_image:
                if sniffed not in IMAGE_TYPES:
                    raise UploadRejected("invalid_image", "Envie uma imagem PNG, JPEG, GIF ou WebP.")
                kind, mime = "image", sniffed
            else:
                if ext not in FILE_EXTENSIONS:
                    raise UploadRejected("file_type_not_allowed", "Este tipo de arquivo não é aceito como anexo.")
                expected = FILE_EXTENSIONS[ext]
                if expected.startswith("image/") and sniffed != expected:
                    raise UploadRejected("invalid_image", "O conteúdo do arquivo não corresponde à extensão.")
                if ext == "pdf" and not head.startswith(b"%PDF-"):
                    raise UploadRejected("invalid_file", "O conteúdo do arquivo não é um PDF.")
                kind, mime = "file", expected
            if self.used_bytes(user_id) + size > USER_QUOTA_BYTES:
                raise UploadRejected("quota_exceeded", "Seu espaço para arquivos do caderno acabou (1 GB). "
                                     "Exclua anexos de anotações na lixeira para liberar espaço.", 413)
            width, height = image_size(head, mime) if kind == "image" else (None, None)
            file_id = new_id()
            tmp.replace(directory / file_id)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        with self.db.connect() as conn:
            conn.execute(
                "INSERT INTO note_files (id, user_id, kind, name, mime, size, sha256, width, height, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (file_id, user_id, kind, name, mime, size, digest.hexdigest(), width, height, utcnow()),
            )
        return StoredFile(file_id, kind, name, mime, size, width, height)

    def get(self, user_id: str, file_id: str) -> tuple[StoredFile, Path]:
        path = self.path(user_id, file_id)
        with self.db.connect() as conn:
            row = conn.execute("SELECT id, kind, name, mime, size, width, height FROM note_files "
                               "WHERE id = ? AND user_id = ?", (file_id, user_id)).fetchone()
        if row is None or not path.is_file():
            raise FileNotFound()
        return StoredFile(**dict(row)), path

    def remove(self, user_id: str, file_ids: list[str]) -> None:
        for file_id in file_ids:
            try:
                self.path(user_id, file_id).unlink(missing_ok=True)
            except (FileNotFound, OSError):
                pass
