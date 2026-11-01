"""Conteúdo das anotações: documento estruturado (JSON do ProseMirror/Tiptap).

O editor salva uma árvore de blocos (parágrafos, títulos, listas, tabelas,
código, fórmulas...) em vez de HTML. Antes de gravar, o servidor percorre a
árvore e só aceita os tipos de bloco, marcas e atributos conhecidos:

- nada de HTML arbitrário: o frontend renderiza a árvore com o próprio schema,
  então não há como injetar `<script>` ou atributos de evento;
- links só com `http(s):`, `mailto:` ou caminhos internos (`/…`);
- imagens e anexos só apontam para arquivos do próprio usuário
  (`/api/notebook/files/<id>`), conferidos na gravação;
- referências a cursos/aulas e marcações de tempo são extraídas para tabelas
  próprias, usadas na busca, nos "vínculos" da aula e na validação.

A mesma função também extrai o texto puro usado pela busca.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

MAX_DOC_BYTES = 2_000_000
MAX_DEPTH = 40
MAX_TEXT = 200_000
FILE_URL = re.compile(r"^/api/notebook/files/([0-9a-f]{32})$")
FILE_ID = re.compile(r"^[0-9a-f]{32}$")
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
LANGUAGE = re.compile(r"^[a-z0-9+#-]{1,24}$")
HIGHLIGHTS = {"yellow", "green", "blue", "pink", "purple", "orange", "red", "gray"}
REF_KINDS = {"course", "section", "lesson"}

# Bloco -> atributos aceitos (com o validador de cada um).
BLOCKS = {
    "doc", "paragraph", "heading", "bulletList", "orderedList", "listItem", "taskList", "taskItem",
    "blockquote", "codeBlock", "horizontalRule", "hardBreak", "table", "tableRow", "tableHeader",
    "tableCell", "image", "attachment", "mathBlock", "mathInline", "timestamp", "courseRef", "callout",
    "text",
}
MARKS = {"bold", "italic", "underline", "strike", "code", "link", "highlight", "subscript", "superscript"}
# Blocos que só valem no editor completo (o das aulas aceita o resto).
FULL_ONLY = {"table", "tableRow", "tableHeader", "tableCell", "image", "attachment", "mathBlock",
             "mathInline", "codeBlock", "taskList", "taskItem", "callout", "courseRef"}


class InvalidDocument(ValueError):
    pass


@dataclass(slots=True)
class Reference:
    """Referência a um conteúdo da plataforma (`@curso/aula [03:14]`)."""

    course_id: str
    kind: str  # course | section | lesson
    section_id: str | None
    lesson_key: str | None
    seconds: float | None


@dataclass(slots=True)
class Extracted:
    doc: dict
    text: str
    words: int
    refs: list[Reference] = field(default_factory=list)
    files: set[str] = field(default_factory=set)
    timestamps: list[float] = field(default_factory=list)


def _str(value, limit: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise InvalidDocument("atributo de texto inválido")
    return value[:limit]


def _int(value, lo: int, hi: int, default: int | None = None) -> int | None:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidDocument("atributo numérico inválido")
    return max(lo, min(hi, int(value)))


def _seconds(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        raise InvalidDocument("tempo inválido")
    if value < 0 or value > 60 * 60 * 24:
        raise InvalidDocument("tempo fora do intervalo")
    return round(float(value), 1)


def safe_href(href) -> str | None:
    href = _str(href, 2048)
    if not href:
        return None
    href = href.strip()
    lower = href.lower()
    if lower.startswith(("http://", "https://", "mailto:")):
        return href
    if href.startswith("/") and not href.startswith("//"):
        return href
    return None


def format_clock(seconds: float) -> str:
    total = int(seconds)
    h, rest = divmod(total, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


class _Walker:
    def __init__(self, full: bool) -> None:
        self.full = full
        self.parts: list[str] = []
        self.refs: list[Reference] = []
        self.files: set[str] = set()
        self.timestamps: list[float] = []
        self.text_size = 0

    def emit(self, text: str) -> None:
        self.text_size += len(text)
        if self.text_size > MAX_TEXT * 2:
            raise InvalidDocument("anotação grande demais")
        self.parts.append(text)

    def attrs(self, kind: str, raw: dict) -> dict | None:
        a = raw if isinstance(raw, dict) else {}
        if kind == "heading":
            return {"level": _int(a.get("level"), 1, 4, 2)}
        if kind == "orderedList":
            return {"start": _int(a.get("start"), 0, 100_000, 1)}
        if kind == "taskItem":
            return {"checked": bool(a.get("checked"))}
        if kind == "codeBlock":
            lang = _str(a.get("language"), 24)
            return {"language": lang if lang and LANGUAGE.match(lang) else None}
        if kind in ("tableCell", "tableHeader"):
            width = a.get("colwidth")
            if isinstance(width, list):
                width = [_int(w, 20, 2000) for w in width[:20] if isinstance(w, (int, float))] or None
            else:
                width = None
            return {"colspan": _int(a.get("colspan"), 1, 20, 1), "rowspan": _int(a.get("rowspan"), 1, 200, 1), "colwidth": width}
        if kind == "image":
            match = FILE_URL.match(a.get("src") or "")
            if not match:
                raise InvalidDocument("imagem precisa ser enviada pelo caderno")
            self.files.add(match.group(1))
            return {
                "src": a["src"],
                "alt": _str(a.get("alt"), 300),
                "title": _str(a.get("title"), 300),
                "width": _int(a.get("width"), 40, 4000),
            }
        if kind == "attachment":
            file_id = a.get("fileId")
            if not isinstance(file_id, str) or not FILE_ID.match(file_id):
                raise InvalidDocument("anexo inválido")
            self.files.add(file_id)
            name = _str(a.get("name"), 255) or "arquivo"
            self.emit(f"\n{name}\n")
            return {"fileId": file_id, "name": name, "size": _int(a.get("size"), 0, 10**10, 0), "mime": _str(a.get("mime"), 120)}
        if kind in ("mathBlock", "mathInline"):
            latex = _str(a.get("latex"), 10_000) or ""
            self.emit(f" {latex} ")
            return {"latex": latex}
        if kind == "timestamp":
            seconds = _seconds(a.get("seconds"))
            if seconds is None:
                raise InvalidDocument("marcação de tempo sem tempo")
            self.timestamps.append(seconds)
            self.emit(f" {format_clock(seconds)} ")
            return {"seconds": seconds}
        if kind == "courseRef":
            ref_kind = a.get("kind")
            course_id = _str(a.get("courseId"), 200)
            if ref_kind not in REF_KINDS or not course_id:
                raise InvalidDocument("referência inválida")
            section_id = _str(a.get("sectionId"), 60) if ref_kind == "section" else None
            lesson_key = _str(a.get("lessonKey"), 120) if ref_kind == "lesson" else None
            if (ref_kind == "section" and not section_id) or (ref_kind == "lesson" and not lesson_key):
                raise InvalidDocument("referência incompleta")
            seconds = _seconds(a.get("seconds")) if ref_kind == "lesson" else None
            label = _str(a.get("label"), 300) or ""
            self.refs.append(Reference(course_id, ref_kind, section_id, lesson_key, seconds))
            self.emit(f" {label} ")
            return {"courseId": course_id, "kind": ref_kind, "sectionId": section_id, "lessonKey": lesson_key,
                    "seconds": seconds, "label": label}
        if kind == "callout":
            tone = a.get("tone")
            return {"tone": tone if tone in ("info", "tip", "warning", "important") else "info"}
        if kind == "paragraph" or kind == "heading":
            return None
        return None

    def marks(self, raw) -> list[dict] | None:
        if raw is None:
            return None
        if not isinstance(raw, list) or len(raw) > 12:
            raise InvalidDocument("marcas inválidas")
        out = []
        for mark in raw:
            if not isinstance(mark, dict) or mark.get("type") not in MARKS:
                raise InvalidDocument("formatação desconhecida")
            kind = mark["type"]
            a = mark.get("attrs") if isinstance(mark.get("attrs"), dict) else {}
            if kind == "link":
                href = safe_href(a.get("href"))
                if not href:
                    continue  # link inseguro: mantém o texto, descarta o link
                out.append({"type": "link", "attrs": {"href": href}})
            elif kind == "highlight":
                color = a.get("color")
                out.append({"type": "highlight", "attrs": {"color": color if color in HIGHLIGHTS else "yellow"}})
            else:
                out.append({"type": kind})
        return out or None

    def node(self, raw, depth: int) -> dict:
        if depth > MAX_DEPTH:
            raise InvalidDocument("anotação aninhada demais")
        if not isinstance(raw, dict):
            raise InvalidDocument("bloco inválido")
        kind = raw.get("type")
        if kind not in BLOCKS:
            raise InvalidDocument(f"tipo de bloco desconhecido: {str(kind)[:40]}")
        if not self.full and kind in FULL_ONLY:
            raise InvalidDocument("este bloco só está disponível no Caderno")
        if kind == "text":
            text = raw.get("text")
            if not isinstance(text, str) or not text:
                raise InvalidDocument("texto inválido")
            self.emit(text)
            out = {"type": "text", "text": text}
            marks = self.marks(raw.get("marks"))
            if marks:
                out["marks"] = marks
            return out
        out: dict = {"type": kind}
        attrs = self.attrs(kind, raw.get("attrs"))
        if attrs is not None:
            out["attrs"] = attrs
        content = raw.get("content")
        if content is not None:
            if not isinstance(content, list):
                raise InvalidDocument("conteúdo inválido")
            out["content"] = [self.node(child, depth + 1) for child in content]
        if kind in ("paragraph", "heading", "listItem", "taskItem", "codeBlock", "tableCell", "tableHeader",
                    "blockquote", "mathBlock", "attachment", "image", "horizontalRule", "callout"):
            self.emit("\n")
        elif kind == "hardBreak":
            self.emit("\n")
        return out


def empty_doc() -> dict:
    return {"type": "doc", "content": [{"type": "paragraph"}]}


def parse(raw, *, full: bool = True) -> Extracted:
    """Valida e normaliza o documento; devolve também texto, referências e arquivos."""
    if raw is None:
        raw = empty_doc()
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError as exc:
            raise InvalidDocument("documento inválido") from exc
    if len(json.dumps(raw, ensure_ascii=False)) > MAX_DOC_BYTES:
        raise InvalidDocument("anotação grande demais")
    if not isinstance(raw, dict) or raw.get("type") != "doc":
        raise InvalidDocument("documento inválido")
    walker = _Walker(full)
    doc = walker.node(raw, 0)
    if not doc.get("content"):
        doc["content"] = [{"type": "paragraph"}]
    text = re.sub(r"[ \t]+", " ", "".join(walker.parts))
    text = re.sub(r"\n\s*\n+", "\n", text).strip()[:MAX_TEXT]
    words = len(text.split())
    return Extracted(doc, text, words, walker.refs, walker.files, walker.timestamps)


def from_plain_text(body: str) -> dict:
    """Converte as anotações antigas (texto puro) em documento, um parágrafo por linha."""
    content = []
    for line in body.replace("\r\n", "\n").split("\n"):
        content.append({"type": "paragraph", "content": [{"type": "text", "text": line}]} if line else {"type": "paragraph"})
    return {"type": "doc", "content": content or [{"type": "paragraph"}]}


def excerpt(text: str, limit: int = 180) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"


def derive_title(text: str) -> str:
    for line in text.splitlines():
        line = line.strip()
        if line:
            return line[:120]
    return ""
