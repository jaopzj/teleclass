import shutil

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.streaming.streamer import CHUNK_SIZE
from app.telegram.media import MediaUnavailable

from .conftest import FIXTURES

COURSE = "/api/courses/curso_exemplo"
SIZE = 50_000_000
DATA = bytes(i % 241 for i in range(CHUNK_SIZE * 3))


class FakeTelegram:
    async def is_user_authorized(self):
        return True

    async def disconnect(self):
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
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEAULA_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TG_API_ID", "")
    monkeypatch.setenv("TG_API_HASH", "")
    (tmp_path / "snapshots").mkdir()
    shutil.copy(FIXTURES / "curso_exemplo.json", tmp_path / "snapshots" / "curso_exemplo.json")
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def media(client):
    state = client.app.state.teleaula
    state.telegram, state.media = FakeTelegram(), FakeMedia()
    return state.media


def test_library_and_course_page(client):
    (course,) = client.get("/api/courses").json()
    assert course["id"] == "curso_exemplo"
    assert course["progress"]["percent"] == 0 and course["progress"]["resume"]["key"] == "A001"
    data = client.get(COURSE).json()
    assert [s["title"] for s in data["sections"]][:2] == ["01. Introdução", "02. Conceitos de programação"]
    assert data["sections"][1]["children"][0]["title"] == "02.1. Variáveis"
    assert data["stats"]["lessons"] == sum(s["total"] for s in data["sections"])


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


def test_notes_autosave_conflict(client):
    url = f"{COURSE}/lessons/A001/notes"
    saved = client.put(url, json={"body": "minha nota", "base_revision": 0}).json()
    assert saved["revision"] == 1
    assert client.get(f"{COURSE}/lessons/A001").json()["note"]["body"] == "minha nota"
    conflict = client.put(url, json={"body": "outra", "base_revision": 0})
    assert conflict.status_code == 409 and conflict.json()["current"]["body"] == "minha nota"


def test_media_requires_telegram(client):
    assert client.get(f"{COURSE}/media/10").status_code == 503


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
    assert (tmp_path / "thumbs" / "1234567890" / "10.jpg").is_file()
    assert client.get(f"{COURSE}/media/15/thumb").status_code == 404
