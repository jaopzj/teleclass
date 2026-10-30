"""Cadastro, login, sessão e proteção das rotas."""

import shutil

import pytest

from app.accounts.passwords import hash_password, verify_password
from app.accounts.ratelimit import RateLimiter

from .conftest import FIXTURES, PASSWORD, register


@pytest.fixture
def client(make_app):
    return make_app()


def test_password_hash_roundtrip():
    stored = hash_password("segredo-forte-1")
    assert stored.startswith("scrypt$") and "segredo" not in stored
    assert verify_password("segredo-forte-1", stored)
    assert not verify_password("segredo-forte-2", stored)
    assert not verify_password("x", "lixo")


def test_register_logs_in_and_session_persists(client):
    data = register(client, "Maria.Silva")
    assert data["user"]["username"] == "maria.silva"
    assert data["telegram"]["linked"] is False
    cookie = client.cookies.get("teleaula_session")
    assert cookie and cookie not in str(data)
    session = client.get("/api/auth/session").json()
    assert session["user"]["username"] == "maria.silva"


def test_cookie_is_httponly_and_strict(client):
    response = client.post("/api/auth/register", json={"username": "ana", "password": PASSWORD})
    header = response.headers["set-cookie"].lower()
    assert "httponly" in header and "samesite=strict" in header


def test_username_rules_and_availability(client):
    assert client.get("/api/auth/username-availability", params={"username": "joao"}).json()["available"]
    register(client, "joao")
    taken = client.get("/api/auth/username-availability", params={"username": "JOAO"}).json()
    assert taken == {"username": "joao", "available": False, "reason": "Este nome de usuário já está em uso."}
    for bad in ["ab", "1abc", "com espaço", "joão", "admin", "a..b", "x" * 40]:
        assert not client.get("/api/auth/username-availability", params={"username": bad}).json()["available"], bad


def test_duplicate_username(client, make_app):
    register(client, "joao")
    other = make_app()
    response = other.post("/api/auth/register", json={"username": "Joao", "password": PASSWORD})
    assert response.status_code == 409
    assert response.json() == {"detail": "Este nome de usuário já está em uso.", "code": "username_taken", "field": "username"}


@pytest.mark.parametrize("password", ["curta1", "12345678", "aaaaaaaaaa", "joao-1234567"])
def test_weak_passwords_rejected(client, password):
    response = client.post("/api/auth/register", json={"username": "joao", "password": password})
    assert response.status_code == 422 and response.json()["field"] == "password"


def test_login_logout(client, make_app):
    register(client, "joao")
    client.post("/api/auth/logout")
    assert client.get("/api/auth/session").json()["user"] is None
    assert client.get("/api/courses").status_code == 401

    wrong = client.post("/api/auth/login", json={"username": "joao", "password": "errada-123"})
    missing = client.post("/api/auth/login", json={"username": "ninguem", "password": "errada-123"})
    # Mesma resposta para usuário inexistente e senha errada.
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json() == missing.json() == {"detail": "Usuário ou senha incorretos.", "code": "invalid_credentials"}

    ok = client.post("/api/auth/login", json={"username": " JOAO ", "password": PASSWORD})
    assert ok.status_code == 200 and ok.json()["user"]["username"] == "joao"
    assert client.get("/api/courses").status_code == 200


def test_old_token_stops_working_after_logout(client, make_app):
    register(client, "joao")
    token = client.cookies.get("teleaula_session")
    client.post("/api/auth/logout")
    thief = make_app()
    thief.cookies.set("teleaula_session", token)
    assert thief.get("/api/courses").status_code == 401


def test_login_rate_limited(client):
    register(client, "joao")
    client.post("/api/auth/logout")
    for _ in range(8):
        assert client.post("/api/auth/login", json={"username": "joao", "password": "errada-123"}).status_code == 401
    blocked = client.post("/api/auth/login", json={"username": "joao", "password": PASSWORD})
    assert blocked.status_code == 429 and blocked.json()["code"] == "rate_limited"
    assert int(blocked.headers["retry-after"]) > 0


def test_library_is_private(client, make_app):
    register(client, "joao")  # primeira conta: herda o curso de antes do login
    assert [c["id"] for c in client.get("/api/courses").json()] == ["curso_exemplo"]
    other = make_app()
    register(other, "maria")
    assert other.get("/api/courses").json() == []
    assert other.get("/api/snapshots").json() == []
    assert other.get("/api/courses/curso_exemplo").status_code == 404
    assert other.get("/api/courses/curso_exemplo/lessons/A001").status_code == 404
    assert other.get("/api/snapshots/curso_exemplo/index").status_code == 404
    put = other.put("/api/courses/curso_exemplo/lessons/A001/notes", json={"body": "x", "base_revision": 0})
    assert put.status_code == 404


def test_progress_and_notes_are_private(client, make_app, tmp_path):
    register(client, "joao")
    other = make_app()
    maria = register(other, "maria")["user"]["id"]
    # Maria coleta o mesmo canal: mesmo id de curso, dados separados.
    (tmp_path / "snapshots" / maria).mkdir(parents=True)
    shutil.copy(FIXTURES / "curso_exemplo.json", tmp_path / "snapshots" / maria / "curso_exemplo.json")
    client.put("/api/courses/curso_exemplo/lessons/A001/notes", json={"body": "nota do joão", "base_revision": 0})
    client.put("/api/courses/curso_exemplo/lessons/A001/completion", json={"completed": True})
    client.put("/api/courses/curso_exemplo/lessons/A002/progress", json={"position_seconds": 30, "duration_seconds": 60})
    lesson = other.get("/api/courses/curso_exemplo/lessons/A001").json()
    assert lesson["note"]["body"] == ""
    assert lesson["lesson"]["progress"]["completed"] is False
    progress = other.get("/api/courses/curso_exemplo").json()["progress"]
    assert progress["completed"] == 0 and progress["last_watched"] is None


def test_first_user_inherits_progress_from_before_login(client):
    state = client.app.state.teleaula
    state.progress.set_completed("local", "curso_exemplo", "A001", True)
    register(client, "joao")
    assert client.get("/api/courses/curso_exemplo").json()["progress"]["completed"] == 1


def test_cross_site_post_is_blocked(client):
    response = client.post(
        "/api/auth/register",
        json={"username": "joao", "password": PASSWORD},
        headers={"Origin": "https://malicioso.example"},
    )
    assert response.status_code == 403


def test_rate_limiter_window():
    now = [0.0]
    limiter = RateLimiter(clock=lambda: now[0])
    for _ in range(3):
        limiter.hit("k", 3, 60)
    assert limiter.retry_after("k", 3, 60) == 60
    now[0] = 61
    assert limiter.retry_after("k", 3, 60) == 0
