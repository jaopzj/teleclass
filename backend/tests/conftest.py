from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.indexing.models import ChannelSnapshot, MediaInfo, MediaKind, SourceMessage
from app.indexing.storage import load_snapshot

FIXTURES = Path(__file__).parent / "fixtures"
BASE = datetime(2025, 1, 1, tzinfo=timezone.utc)


def msg(id: int, text: str = "", *, media: str | None = None, file_name: str | None = None,
        grouped_id: int | None = None, markdown: str | None = None) -> SourceMessage:
    info = MediaInfo(MediaKind(media), file_name=file_name) if media else None
    return SourceMessage(id, BASE + timedelta(minutes=id), text, markdown, grouped_id, info)


def snapshot(*messages: SourceMessage, title: str = "Teste") -> ChannelSnapshot:
    return ChannelSnapshot(channel_id=1, title=title, messages=list(messages))


@pytest.fixture
def example_snapshot() -> ChannelSnapshot:
    return load_snapshot(FIXTURES / "curso_exemplo.json")
