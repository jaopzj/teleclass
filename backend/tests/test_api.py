import shutil

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

from .conftest import FIXTURES


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEAULA_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TG_API_ID", "")
    monkeypatch.setenv("TG_API_HASH", "")
    (tmp_path / "snapshots").mkdir()
    shutil.copy(FIXTURES / "curso_exemplo.json", tmp_path / "snapshots" / "curso_exemplo.json")
    with TestClient(create_app()) as c:
        yield c


def test_status_without_telegram(client):
    data = client.get("/api/telegram/status").json()
    assert (data["configured"], data["authorized"]) == (False, False)


def test_list_and_index(client):
    (item,) = client.get("/api/snapshots").json()
    assert item["name"] == "curso_exemplo"
    data = client.get("/api/snapshots/curso_exemplo/index").json()
    assert data["course"]["strategy"] == "summary"
    assert data["report"]["unresolved"][0]["ref"] == "A099"


def test_snapshot_name_cannot_escape_folder(client):
    assert client.get("/api/snapshots/..%2F..%2Fetc/index").status_code == 404


def test_collect_requires_telegram(client):
    assert client.post("/api/snapshots", json={"link": "https://t.me/x"}).status_code == 401
