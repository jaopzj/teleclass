from dataclasses import replace
from types import SimpleNamespace

import pytest

from app.streaming.streamer import CHUNK_SIZE
from app.telegram.media import MediaUnavailable

from .conftest import register

COURSE = "/api/courses/curso_exemplo"
SIZE = 50_000_000
DATA = bytes(i % 241 for i in range(CHUNK_SIZE * 3))


class FakeClients:
    """Substitui o conjunto de clientes do Telegram por usuário."""

    def __init__(self, media):
        self._media = media

    async def media(self, user_id):
        return self._media

    def has_session(self, user_id):
        return True

    async def revoked(self, user_id):
        pass

    async def close(self):
        pass


class FakeMedia:
    """Substitui o Telegram: mensagem 10 existe, as outras foram apagadas."""

    def __init__(self):
        self.requested: list[int] = []

    async def message(self, channel, message_id, refresh=False):
        if message_id != 10:
            raise MediaUnavailable("apagada")
        return object()

    async def file_size(self, channel, message_id):
        return SIZE

    def chunks(self, channel, message_id):
        media = self

        class Source:
            async def iter_chunks(self, offset):
                media.requested.append(offset)
                while True:
                    yield DATA[:CHUNK_SIZE]

        return Source()

    async def thumbnail(self, channel, message_id):
        return b"jpeg" if message_id == 10 else None


@pytest.fixture
def client(make_app):
    client = make_app()
    register(client)
    return client


@pytest.fixture
def media(client):
    state = client.app.state.teleaula
    user_id = client.get("/api/auth/session").json()["user"]["id"]
    state.settings = replace(state.settings, api_id=1, api_hash="x")
    state.telegram_accounts.link(user_id, "+5511999990000", SimpleNamespace(id=1, first_name="J", last_name=None, username=None))
    fake = FakeMedia()
    state.clients = FakeClients(fake)
    return fake


def test_library_and_course_page(client):
    (course,) = client.get("/api/courses").json()
    assert course["id"] == "curso_exemplo"
    assert course["progress"]["percent"] == 0 and course["progress"]["resume"]["key"] == "A001"
    data = client.get(COURSE).json()
    assert [s["title"] for s in data["sections"]][:2] == ["01. Introdução", "02. Conceitos de programação"]
    assert data["sections"][1]["children"][0]["title"] == "02.1. Variáveis"
    # Aulas indisponíveis (sem mensagem no canal) não entram no progresso.
    assert data["progress"]["total"] == sum(s["total"] for s in data["sections"]) == data["stats"]["lessons"] - 1


def test_lesson_navigation_crosses_sections(client):
    lesson = client.get(f"{COURSE}/lessons/A003").json()
    assert lesson["lesson"]["path"] == ["02. Conceitos de programação", "02.1. Variáveis"]
    assert lesson["previous"]["key"] == "A002"
    assert lesson["next"]["key"] == "A004"
    assert client.get(f"{COURSE}/lessons/NAOEXISTE").status_code == 404


def test_progress_completion_and_resume(client):
    put = client.put
    assert put(f"{COURSE}/lessons/A001/progress", json={"position_seconds": 42.5, "duration_seconds": 600}).status_code == 200
    data = client.get(COURSE).json()["progress"]
    assert data["last_watched"]["key"] == "A001" and data["resume"]["position_seconds"] == 42.5
    assert data["completed"] == 0  # assistir não conclui

    result = put(f"{COURSE}/lessons/A001/completion", json={"completed": True}).json()
    assert result["course"]["completed"] == 1
    put(f"{COURSE}/lessons/A001/completion", json={"completed": True})
    data = client.get(COURSE).json()["progress"]
    assert data["completed"] == 1 and data["resume"]["key"] == "A002"
    assert client.get(f"{COURSE}/lessons/A001").json()["lesson"]["progress"]["position_seconds"] == 42.5


def test_media_requires_telegram(client):
    response = client.get(f"{COURSE}/media/10")
    assert response.status_code == 503 and response.json()["code"] == "telegram_not_configured"


def test_courses_require_login(make_app):
    assert make_app().get(COURSE).status_code == 401


def test_media_range(client, media):
    response = client.get(f"{COURSE}/media/10", headers={"Range": f"bytes={CHUNK_SIZE + 10}-{CHUNK_SIZE + 19}"})
    assert response.status_code == 206
    assert response.headers["content-range"] == f"bytes {CHUNK_SIZE + 10}-{CHUNK_SIZE + 19}/{SIZE}"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.content == DATA[10:20]
    assert media.requested == [CHUNK_SIZE]

    open_ended = client.get(f"{COURSE}/media/10", headers={"Range": "bytes=0-"})
    assert open_ended.status_code == 206 and int(open_ended.headers["content-length"]) < SIZE
    assert client.get(f"{COURSE}/media/10", headers={"Range": f"bytes={SIZE}-"}).status_code == 416


def test_media_must_belong_to_course(client, media):
    assert client.get(f"{COURSE}/media/1").status_code == 404  # mensagem de texto (sumário)
    assert client.get(f"{COURSE}/media/999").status_code == 404
    assert client.get(f"{COURSE}/media/11", headers={"Range": "bytes=0-1"}).status_code == 410  # apagada


def test_thumbnail_is_cached(client, media, tmp_path):
    assert client.get(f"{COURSE}/media/10/thumb").content == b"jpeg"
    user_id = client.get("/api/auth/session").json()["user"]["id"]
    assert (tmp_path / "thumbs" / user_id / "1234567890" / "10.jpg").is_file()
    assert client.get(f"{COURSE}/media/15/thumb").status_code == 404


def test_delete_course_removes_it_from_the_account(make_app, tmp_path):
    import shutil

    from .conftest import FIXTURES

    client = make_app()
    register(client)
    user_id = client.get("/api/auth/session").json()["user"]["id"]
    client.put(f"{COURSE}/lessons/A001/completion", json={"completed": True})
    thumbs = tmp_path / "thumbs" / user_id / "1234567890"
    thumbs.mkdir(parents=True)
    (thumbs / "channel.jpg").write_bytes(b"jpeg")
    note = client.post("/api/notebook/notes", json={"kind": "quick", "link": {"course_id": "curso_exemplo", "lesson_key": "A001"}})
    assert note.status_code in (200, 201), note.text

    # Outro usuário com o mesmo curso não é afetado.
    other = make_app()
    register(other, "maria")
    other_id = other.get("/api/auth/session").json()["user"]["id"]
    (tmp_path / "snapshots" / other_id).mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURES / "curso_exemplo.json", tmp_path / "snapshots" / other_id / "curso_exemplo.json")
    other.put(f"{COURSE}/lessons/A001/completion", json={"completed": True})

    assert client.delete(COURSE).status_code == 204
    assert client.get("/api/courses").json() == []
    assert client.get(COURSE).status_code == 404
    assert not (tmp_path / "snapshots" / user_id / "curso_exemplo.json").exists()
    assert not thumbs.exists()
    assert client.delete(COURSE).status_code == 404

    # As anotações continuam no Caderno.
    assert client.get(f"/api/notebook/notes/{note.json()['id']}").status_code == 200

    (course,) = other.get("/api/courses").json()
    assert course["progress"]["completed"] == 1

    # Coletar o canal de novo começa do zero.
    shutil.copy(FIXTURES / "curso_exemplo.json", tmp_path / "snapshots" / user_id / "curso_exemplo.json")
    (course,) = client.get("/api/courses").json()
    assert course["progress"]["completed"] == 0


def test_delete_course_rejects_bad_names(client):
    assert client.delete("/api/courses/..%2Fx").status_code == 404
    assert client.delete("/api/courses/naoexiste").status_code == 404
