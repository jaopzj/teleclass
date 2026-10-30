"""Interpretação de links de canal (PLANO.md, 4.4). Função pura, sem rede."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum


class LinkKind(StrEnum):
    USERNAME = "username"  # t.me/usuario ou @usuario
    INVITE = "invite"  # t.me/+HASH ou t.me/joinchat/HASH
    PRIVATE_ID = "private_id"  # t.me/c/123456/789


@dataclass(frozen=True, slots=True)
class ChannelLink:
    kind: LinkKind
    value: str  # username, hash do convite ou id numérico
    message_id: int | None = None


class InvalidLink(ValueError):
    pass


_USERNAME = r"[A-Za-z][A-Za-z0-9_]{3,31}"
_PATTERNS: list[tuple[re.Pattern[str], LinkKind]] = [
    (re.compile(rf"^@({_USERNAME})$"), LinkKind.USERNAME),
    (re.compile(r"^(?:https?://)?(?:t|telegram)\.me/(?:\+|joinchat/)([A-Za-z0-9_-]+)/?$"), LinkKind.INVITE),
    (re.compile(r"^(?:https?://)?(?:t|telegram)\.me/c/(\d+)(?:/(\d+))?/?$"), LinkKind.PRIVATE_ID),
    (re.compile(rf"^(?:https?://)?(?:t|telegram)\.me/(?:s/)?({_USERNAME})(?:/(\d+))?/?$"), LinkKind.USERNAME),
]


def parse_channel_link(link: str) -> ChannelLink:
    text = link.strip().split("?", 1)[0]
    for pattern, kind in _PATTERNS:
        match = pattern.match(text)
        if match:
            message = match.group(2) if match.re.groups >= 2 else None
            return ChannelLink(kind, match.group(1), int(message) if message else None)
    raise InvalidLink(f"Link de canal não reconhecido: {link!r}")
