"""Resolução de identificadores: de `A001` às mensagens do canal.

O identificador é a referência principal: uma mensagem corresponde a `A001`
quando o seu texto (legenda) contém `#A001`. As mensagens do próprio sumário
não entram no índice. Quando a mensagem encontrada faz parte de um álbum
(`grouped_id`), todos os itens do álbum são incluídos, na ordem original,
mesmo que só um deles tenha legenda.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Iterable, Sequence

from .models import SourceMessage
from .refs import RefExtractor


class MatchReason(StrEnum):
    TAG = "tag"  # a mensagem contém o identificador
    ALBUM = "album"  # a mensagem está no mesmo álbum de uma mensagem com o identificador
    CHRONOLOGICAL = "chronological"  # fallback: mensagem de mídia em ordem cronológica


@dataclass(frozen=True, slots=True)
class MessageMatch:
    message_id: int
    reason: MatchReason
    via: int | None = None  # para ALBUM: mensagem que trouxe o álbum


@dataclass(slots=True)
class Resolution:
    key: str
    matches: list[MessageMatch] = field(default_factory=list)

    @property
    def resolved(self) -> bool:
        return bool(self.matches)

    @property
    def message_ids(self) -> list[int]:
        return [m.message_id for m in self.matches]

    @property
    def tagged_ids(self) -> list[int]:
        return [m.message_id for m in self.matches if m.reason is MatchReason.TAG]


class MessageIndex:
    """Índice de mensagens por identificador e por álbum."""

    def __init__(
        self,
        messages: Sequence[SourceMessage],
        refs: RefExtractor,
        *,
        exclude_ids: Iterable[int] = (),
    ) -> None:
        excluded = set(exclude_ids)
        self.messages = {m.id: m for m in messages if m.id not in excluded}
        self.by_key: dict[str, list[int]] = defaultdict(list)
        self.keys_by_message: dict[int, list[str]] = {}
        self.albums: dict[int, list[int]] = defaultdict(list)

        for message in sorted(self.messages.values(), key=lambda m: m.id):
            keys = refs.keys(message.text)
            if keys:
                self.keys_by_message[message.id] = keys
                for key in keys:
                    self.by_key[key].append(message.id)
            if message.grouped_id is not None:
                self.albums[message.grouped_id].append(message.id)

    def album_of(self, message_id: int) -> list[int]:
        grouped_id = self.messages[message_id].grouped_id
        return self.albums[grouped_id] if grouped_id is not None else [message_id]

    def resolve(self, key: str) -> Resolution:
        resolution = Resolution(key)
        tagged_ids = self.by_key.get(key, [])
        tagged_set = set(tagged_ids)
        seen: set[int] = set()
        for tagged in tagged_ids:
            for member in self.album_of(tagged):
                if member in seen:
                    continue
                seen.add(member)
                if member in tagged_set:
                    resolution.matches.append(MessageMatch(member, MatchReason.TAG))
                else:
                    resolution.matches.append(
                        MessageMatch(member, MatchReason.ALBUM, via=tagged)
                    )
        resolution.matches.sort(key=lambda m: m.message_id)
        return resolution
