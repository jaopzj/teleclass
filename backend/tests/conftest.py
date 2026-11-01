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


# --- aplicação com usuário logado ------------------------------------------------

PASSWORD = "estudar-muito-42"


@pytest.fixture
def make_app(tmp_path, monkeypatch):
    """Cria a aplicação com dados em tmp_path e o curso de exemplo."""
    import shutil

    from fastapi.testclient import TestClient

    from app.main import create_app

    monkeypatch.setenv("TELEAULA_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TG_API_ID", "")
    monkeypatch.setenv("TG_API_HASH", "")
    (tmp_path / "snapshots").mkdir(exist_ok=True)
    shutil.copy(FIXTURES / "curso_exemplo.json", tmp_path / "snapshots" / "curso_exemplo.json")
    clients = []

    def make() -> TestClient:
        client = TestClient(create_app(), base_url="http://127.0.0.1")
        client.__enter__()
        clients.append(client)
        return client

    yield make
    for client in clients:
        client.__exit__(None, None, None)


def register(client, username: str = "joao", password: str = PASSWORD):
    response = client.post("/api/auth/register", json={"username": username, "password": password})
    assert response.status_code == 201, response.text
    return response.json()
