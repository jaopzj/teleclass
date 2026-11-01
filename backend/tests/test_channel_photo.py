import os
import time

import pytest

from app.api.deps import get_media
from app.telegram.media import ChannelRef

from .conftest import register


class FakeMedia:
    def __init__(self, photo: bytes | None):
        self.photo = photo
        self.calls: list[ChannelRef] = []

    async def channel_photo(self, channel: ChannelRef):
        self.calls.append(channel)
        return self.photo


@pytest.fixture
def setup(make_app):
    def build(photo: bytes | None):
        client = make_app()
        register(client)
        media = FakeMedia(photo)
        client.app.dependency_overrides[get_media] = lambda: media
        return client, media

    return build


def test_photo_is_fetched_once_and_cached(setup):
    client, media = setup(b"\xff\xd8jpeg")
    for _ in range(2):
        response = client.get("/api/courses/curso_exemplo/photo")
        assert response.status_code == 200
        assert response.content == b"\xff\xd8jpeg"
        assert response.headers["content-type"] == "image/jpeg"
    assert media.calls == [ChannelRef(1234567890, "curso_exemplo")]


def test_channel_without_photo(setup):
    client, media = setup(None)
    assert client.get("/api/courses/curso_exemplo/photo").status_code == 404
    assert client.get("/api/courses/curso_exemplo/photo").status_code == 404
    assert len(media.calls) == 1  # a falta de foto também fica guardada


def test_recollecting_refreshes_photo(setup, tmp_path):
    client, media = setup(b"old")
    assert client.get("/api/courses/curso_exemplo/photo").content == b"old"
    media.photo = b"new"
    future = time.time() + 5
    for snapshot in tmp_path.rglob("curso_exemplo.json"):
        os.utime(snapshot, (future, future))
    assert client.get("/api/courses/curso_exemplo/photo").content == b"new"


def test_unknown_course(setup):
    client, _ = setup(b"x")
    assert client.get("/api/courses/nao_existe/photo").status_code == 404
