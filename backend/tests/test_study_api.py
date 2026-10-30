"""API de estudo: propriedade dos registros, validação e fluxo completo até as métricas."""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest

from app.study.days import load_timezone

from .conftest import register

SP = "America/Sao_Paulo"


class Clock:
    def __init__(self, t: float) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


@pytest.fixture
def setup(make_app):
    client = make_app()
    register(client)
    clock = Clock(datetime(2026, 10, 29, 20, 0, tzinfo=load_timezone(SP)).timestamp())
    client.app.state.teleaula.study.clock = clock
    return client, clock


def open_session(client, lesson="A001", **extra):
    sid = str(uuid.uuid4())
    body = {"id": sid, "source": "video", "course_id": "curso_exemplo", "lesson_key": lesson, "timezone": SP, **extra}
    return sid, client.post("/api/study/sessions", json=body)


def seg(seq, start, end, rate=1.0, media_from=None):
    media_from = start * rate if media_from is None else media_from
    return {"seq": seq, "start_ms": int(start * 1000), "end_ms": int(end * 1000),
            "media_from": media_from, "media_to": media_from + (end - start) * rate, "rate": rate}


def test_full_flow_feeds_metrics(setup):
    client, clock = setup
    sid, response = open_session(client)
    assert response.status_code == 200, response.text
    assert client.get("/api/study/preferences").json() == {"timezone": SP}  # definido na primeira sessão
    clock.t += 15 * 60
    # Em 2×, cada trecho de 15 s avança 30 s de vídeo. A aula tem 10 min: depois
    # de 20 trechos (5 min de relógio) o vídeo acabou e o servidor recusa o resto.
    segments = [seg(i, i * 15, i * 15 + 15, rate=2.0) for i in range(48)]
    response = client.post(f"/api/study/sessions/{sid}/segments", json={"segments": segments[:20]})
    body = response.json()
    assert [r["status"] for r in body["results"]] == ["accepted"] * 20
    assert body["session"]["credited_seconds"] == 300  # 5 min de relógio = 10 min de vídeo em 2×
    response = client.post(f"/api/study/sessions/{sid}/segments", json={"segments": segments[20:22]})
    assert {r["reason"] for r in response.json()["results"]} == {"media_out_of_range"}

    client.put("/api/courses/curso_exemplo/lessons/A001/completion", json={"completed": True})
    client.put("/api/courses/curso_exemplo/lessons/A001/completion", json={"completed": True})
    metrics = client.get("/api/study/metrics").json()
    assert metrics["timezone"] == SP and metrics["timezone_configured"]
    assert metrics["today"]["seconds"] == 300 and not metrics["today"]["active"]
    assert metrics["week"]["seconds"] == 300
    assert metrics["streak"]["current"] == 0
    assert metrics["daily_average"] is None  # primeiro dia ainda incompleto
    assert metrics["lessons"] == {"completed": 1, "completed_this_week": 1}
    # 1 de 6 aulas válidas (a A099 está indisponível): 16%, arredondado para baixo
    assert metrics["courses"] == {
        "started": 1, "finished": 0, "completed_lessons": 1, "total_lessons": 6, "percent": 16, "without_lessons": 0,
    }
    assert metrics["total"]["by_source"] == {"video": 300, "timer": 0}


def test_course_cards_and_metrics_agree(setup):
    client, _ = setup
    for key in ("A001", "A002"):
        client.put(f"/api/courses/curso_exemplo/lessons/{key}/completion", json={"completed": True})
    card = client.get("/api/courses").json()[0]["progress"]
    metrics = client.get("/api/study/metrics").json()["courses"]
    assert (card["completed"], card["total"], card["percent"]) == (
        metrics["completed_lessons"], metrics["total_lessons"], metrics["percent"],
    )


def test_records_are_private(make_app):
    client = make_app()
    register(client, "ana")
    sid, _ = open_session(client)
    other = make_app()
    register(other, "bia")
    assert other.post(f"/api/study/sessions/{sid}/segments", json={"segments": [seg(0, 0, 5)]}).status_code == 404
    reuse = {"id": sid, "source": "video", "course_id": "curso_exemplo", "lesson_key": "A001"}
    assert other.post("/api/study/sessions", json=reuse).status_code == 404
    # Curso de outra pessoa (ou inexistente) não abre sessão.
    _, response = open_session(other, course_id="../ana")
    assert response.status_code in (404, 422)


def test_requires_login(make_app):
    client = make_app()
    assert client.get("/api/study/metrics").status_code == 401
    _, response = open_session(client)
    assert response.status_code == 401


@pytest.mark.parametrize(
    "body",
    [
        {"id": "nao-e-uuid", "source": "video", "course_id": "curso_exemplo", "lesson_key": "A001"},
        {"id": str(uuid.uuid4()), "source": "outra", "course_id": "curso_exemplo", "lesson_key": "A001"},
    ],
)
def test_open_validation(setup, body):
    client, _ = setup
    assert client.post("/api/study/sessions", json=body).status_code == 422


def test_only_video_lessons_and_enabled_sources(setup):
    client, _ = setup
    _, response = open_session(client, lesson="A003")  # só arquivo
    assert response.json()["code"] == "lesson_not_trackable"
    response = client.post("/api/study/sessions", json={"id": str(uuid.uuid4()), "source": "timer"})
    assert response.json()["code"] == "study_source_unavailable"


def test_segment_payload_limits(setup):
    client, clock = setup
    sid, _ = open_session(client)
    clock.t += 60
    too_many = {"segments": [seg(i, i, i + 1) for i in range(51)]}
    assert client.post(f"/api/study/sessions/{sid}/segments", json=too_many).status_code == 422
    negative = {"segments": [{"seq": -1, "start_ms": 0, "end_ms": 10}]}
    assert client.post(f"/api/study/sessions/{sid}/segments", json=negative).status_code == 422
    # Repetido no mesmo pedido: vale o primeiro.
    response = client.post(f"/api/study/sessions/{sid}/segments", json={"segments": [seg(0, 0, 10), seg(0, 0, 50)]})
    assert len(response.json()["results"]) == 1 and response.json()["session"]["credited_seconds"] == 10


def test_timezone_preference(setup):
    client, _ = setup
    assert client.put("/api/study/preferences", json={"timezone": "Nada/Existe"}).json()["code"] == "invalid_timezone"
    assert client.put("/api/study/preferences", json={"timezone": "Europe/Lisbon"}).json() == {"timezone": "Europe/Lisbon"}
    # A abertura de sessão não troca um fuso já escolhido.
    open_session(client)
    assert client.get("/api/study/preferences").json() == {"timezone": "Europe/Lisbon"}
