import pytest

from .conftest import register


@pytest.fixture
def client(make_app):
    client = make_app()
    register(client)
    return client


def test_status_without_telegram(client):
    data = client.get("/api/telegram/status").json()
    assert (data["configured"], data["linked"]) == (False, False)


def test_list_and_index(client):
    (item,) = client.get("/api/snapshots").json()
    assert item["name"] == "curso_exemplo"
    data = client.get("/api/snapshots/curso_exemplo/index").json()
    assert data["course"]["strategy"] == "summary"
    assert data["report"]["unresolved"][0]["ref"] == "A099"


def test_snapshot_name_cannot_escape_folder(client):
    assert client.get("/api/snapshots/..%2F..%2Fetc/index").status_code == 404


def test_collect_requires_linked_telegram(client):
    response = client.post("/api/snapshots", json={"link": "https://t.me/x"})
    assert response.status_code == 503 and response.json()["code"] == "telegram_not_configured"


def test_snapshots_require_login(make_app):
    assert make_app().get("/api/snapshots").status_code == 401
