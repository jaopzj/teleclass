"""Modelo de entrada da indexação, independente do Telegram.

`SourceMessage` é a forma normalizada de uma mensagem do canal. O adaptador do
Telegram (`app.telegram.collector`) converte mensagens do Telethon para este
formato, e o restante do pipeline trabalha apenas com ele. Isso permite rodar a
indexação a partir de um dump JSON, em testes ou com outras fontes no futuro.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any


class MediaKind(StrEnum):
    VIDEO = "video"
    PHOTO = "photo"
    AUDIO = "audio"
    VOICE = "voice"
    DOCUMENT = "document"
    OTHER = "other"


@dataclass(frozen=True, slots=True)
class MediaInfo:
    kind: MediaKind
    file_name: str | None = None
    mime_type: str | None = None
    size: int | None = None
    duration: float | None = None
    width: int | None = None
    height: int | None = None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["kind"] = self.kind.value
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MediaInfo:
        return cls(**{**data, "kind": MediaKind(data["kind"])})


@dataclass(frozen=True, slots=True)
class SourceMessage:
    """Uma mensagem do canal, já normalizada.

    `text` é o texto puro (usado para interpretar marcadores e identificadores).
    `markdown` é o mesmo texto com formatação e links em Markdown (usado na
    descrição das aulas). Quando a fonte não fornece Markdown, fica `None`.
    """

    id: int
    date: datetime
    text: str = ""
    markdown: str | None = None
    grouped_id: int | None = None
    media: MediaInfo | None = None

    @property
    def has_media(self) -> bool:
        return self.media is not None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "date": self.date.isoformat(),
            "text": self.text,
            "markdown": self.markdown,
            "grouped_id": self.grouped_id,
            "media": self.media.to_dict() if self.media else None,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SourceMessage:
        media = data.get("media")
        return cls(
            id=int(data["id"]),
            date=datetime.fromisoformat(data["date"]),
            text=data.get("text") or "",
            markdown=data.get("markdown"),
            grouped_id=data.get("grouped_id"),
            media=MediaInfo.from_dict(media) if media else None,
        )


@dataclass(slots=True)
class ChannelSnapshot:
    """Mensagens coletadas de um canal, em ordem crescente de id."""

    channel_id: int | None
    title: str | None
    messages: list[SourceMessage] = field(default_factory=list)
    username: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "format": "teleaula.channel-snapshot/v1",
            "channel_id": self.channel_id,
            "title": self.title,
            "username": self.username,
            "messages": [m.to_dict() for m in self.messages],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ChannelSnapshot:
        messages = sorted(
            (SourceMessage.from_dict(m) for m in data.get("messages", [])),
            key=lambda m: m.id,
        )
        return cls(
            channel_id=data.get("channel_id"),
            title=data.get("title"),
            username=data.get("username"),
            messages=messages,
        )
