"""Temporizador: transições derivadas de instantes, bloqueio de pausa, XP, metas e concorrência."""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest

from app.focus.plans import MIN, Plan, Stage, Technique, preset_plan
from app.focus.rewards import level_for, progression, xp_for_level
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
    clock = Clock(datetime(2026, 10, 29, 14, 0, tzinfo=load_timezone(SP)).timestamp())
    state = client.app.state.teleaula
    state.study.clock = clock
    state.focus.clock = clock
    client.put("/api/study/preferences", json={"timezone": SP})
    return client, clock


def rid() -> str:
    return str(uuid.uuid4())


def start(client, technique="pomodoro", **extra):
    body = {"request_id": rid(), "technique": technique, **extra}
    return client.post("/api/focus/sessions", json=body)


def act(client, session, action, *, version=None, request_id=None, **extra):
    body = {"action": action, "request_id": request_id or rid(), "version": session["version"] if version is None else version, **extra}
    return client.post(f"/api/focus/sessions/{session['id']}/actions", json=body)


def state(client, after=None):
    return client.get("/api/focus/state", params={"after": after} if after is not None else None).json()


# --- planos (funções puras) ---------------------------------------------------------


def test_pomodoro_timeline_ends_with_long_break():
    plan = preset_plan(Technique.POMODORO)
    stages = [s["stage"] for s in plan.timeline()]
    assert stages == ["focus", "short_break"] * 3 + ["focus", "long_break"]
    assert plan.break_after(4) == (Stage.LONG_BREAK, 15 * MIN)


def test_long_break_in_the_middle_and_no_final_short_break():
    plan = Plan(Technique.CUSTOM, 25 * MIN, 5 * MIN, 15 * MIN, 2, 3)
    assert [s["stage"] for s in plan.timeline()] == ["focus", "short_break", "focus", "long_break", "focus"]


def test_levels_are_monotonic():
    assert xp_for_level(1) == 0
    assert all(xp_for_level(n + 1) > xp_for_level(n) for n in range(1, 40))
    assert level_for(xp_for_level(10)) == 10 and level_for(xp_for_level(10) - 1) == 9
    p = progression(0)
    assert p["level"] == 1 and p["title"] == "Treineiro" and p["next_level_xp"] > 0


# --- ciclo completo ---------------------------------------------------------------------


def test_focus_then_break_then_ready_derived_from_timestamps(setup):
    client, clock = setup
    response = start(client)
    assert response.status_code == 200, response.text
    session = response.json()["session"]
    assert session["stage"] == "focus" and session["phase_ends_at"] == clock.t + 25 * MIN

    clock.t += 25 * MIN + 30  # ninguém consultou durante o foco
    s = state(client)
    assert s["locked"] and s["session"]["stage"] == "short_break"
    # O descanso começou no fim exato do foco, não na consulta.
    assert s["session"]["phase_started_at"] == session["phase_ends_at"]
    assert s["session"]["focus_seconds"] == 25 * MIN
    assert s["session"]["cycles_completed"] == 0  # só conta depois da pausa

    metrics = client.get("/api/study/metrics").json()
    assert metrics["today"]["seconds"] == 25 * MIN
    assert metrics["total"]["by_source"]["timer"] == 25 * MIN

    clock.t += 5 * MIN
    s = state(client)
    assert not s["locked"] and s["session"]["stage"] == "ready"
    assert s["session"]["cycle"] == 2 and s["session"]["cycles_completed"] == 1
    progress = client.get("/api/focus/progress").json()
    assert progress["progress"]["xp"] >= 25 + 10  # 25 min de foco + bônus do ciclo


def test_break_locks_lessons_on_the_server(setup):
    client, clock = setup
    start(client)
    clock.t += 25 * MIN
    response = client.get("/api/courses/curso_exemplo/media/10")
    assert response.status_code == 423
    assert response.json()["code"] == "focus_break_lock"


def test_pause_does_not_count_and_shifts_the_end(setup):
    client, clock = setup
    session = start(client).json()["session"]
    clock.t += 10 * MIN
    session = act(client, session, "pause").json()["session"]
    assert session["paused"] and session["focus_seconds"] == 10 * MIN
    clock.t += 20 * MIN  # pausado: nada avança
    session = state(client)["session"]
    assert session["stage"] == "focus" and session["paused"]
    session = act(client, session, "resume").json()["session"]
    assert session["phase_ends_at"] == clock.t + 15 * MIN
    clock.t += 15 * MIN
    s = state(client)["session"]
    assert s["stage"] == "short_break" and s["focus_seconds"] == 25 * MIN


def test_full_pomodoro_completes_with_rewards_and_notices(setup):
    client, clock = setup
    cursor = state(client, after=0)["notice_cursor"]
    session = start(client).json()["session"]
    for cycle in range(1, 5):
        clock.t += 25 * MIN
        clock.t += (15 if cycle == 4 else 5) * MIN
        s = state(client)
        if cycle < 4:
            assert s["session"]["stage"] == "ready"
            act(client, s["session"], "start_next")
    s = state(client, after=cursor)
    assert s["session"] is None and not s["locked"]
    kinds = [n["kind"] for n in s["notices"]]
    assert kinds.count("focus_completed") == 4 and "session_ended" in kinds
    assert "achievement_unlocked" in kinds
    ended = next(n for n in s["notices"] if n["kind"] == "session_ended")
    assert ended["status"] == "completed" and ended["cycles_completed"] == 4
    assert ended["xp"] == 100 + 40 + 25  # 4×25 min, 4 ciclos, sessão

    history = client.get("/api/focus/history").json()["items"]
    assert history[0]["id"] == session["id"] and history[0]["status"] == "completed"
    detail = client.get(f"/api/focus/history/{session['id']}").json()
    assert [p["stage"] for p in detail["phases"]] == ["focus", "short_break"] * 3 + ["focus", "long_break"]
    achievements = {a["code"]: a for a in client.get("/api/focus/progress").json()["achievements"]}
    assert achievements["primeira_sessao"]["unlocked_at"] is not None
    assert achievements["pomodoro_10"]["current"] == 4 and achievements["pomodoro_10"]["unlocked_at"] is None


# --- desbloqueio antecipado ------------------------------------------------------------


def test_unlock_requires_confirmation_and_invalidates_only_that_cycle(setup):
    client, clock = setup
    session = start(client).json()["session"]
    clock.t += 30 * MIN  # ciclo 1 + pausa
    session = act(client, state(client)["session"], "start_next").json()["session"]
    clock.t += 25 * MIN  # fim do ciclo 2: pausa
    session = state(client)["session"]
    assert session["stage"] == "short_break"
    xp_before = client.get("/api/focus/progress").json()["progress"]["xp"]

    response = act(client, session, "unlock_break")
    assert response.status_code == 422 and response.json()["code"] == "focus_confirmation_required"
    response = act(client, session, "unlock_break", confirm=True)
    assert response.status_code == 200, response.text
    after = response.json()["session"]
    assert after["stage"] == "ready" and after["cycle"] == 3
    assert after["cycles_completed"] == 1 and after["cycles_invalidated"] == 1
    assert not response.json()["locked"]
    # Nada já conquistado se perde; o ciclo invalidado não rende bônus.
    assert client.get("/api/focus/progress").json()["progress"]["xp"] == xp_before
    assert client.get("/api/study/metrics").json()["today"]["seconds"] == 50 * MIN
    assert client.get("/api/courses/curso_exemplo/media/10").status_code != 423


def test_stop_during_break_also_needs_confirmation(setup):
    client, clock = setup
    start(client)
    clock.t += 25 * MIN
    session = state(client)["session"]
    assert act(client, session, "stop").status_code == 422
    response = act(client, session, "stop", confirm=True)
    assert response.json()["session"] is None
    assert response.json()["ended"]["status"] == "stopped" and response.json()["ended"]["cycles_invalidated"] == 1


# --- concorrência, duplicados, outro dispositivo ---------------------------------------------


def test_one_active_session_per_user_and_idempotent_start(setup):
    client, _ = setup
    body = {"request_id": rid(), "technique": "pomodoro"}
    first = client.post("/api/focus/sessions", json=body).json()
    again = client.post("/api/focus/sessions", json=body)
    assert again.status_code == 200 and again.json()["replayed"] and again.json()["session"]["id"] == first["session"]["id"]
    other = start(client, "52_17")
    assert other.status_code == 409 and other.json()["code"] == "focus_session_active"
    assert other.json()["state"]["session"]["id"] == first["session"]["id"]


def test_duplicate_action_applies_once(setup):
    client, clock = setup
    session = start(client).json()["session"]
    clock.t += 60
    request_id = rid()
    paused = act(client, session, "pause", request_id=request_id).json()
    replay = act(client, session, "pause", request_id=request_id).json()
    assert replay["replayed"] and replay["session"]["version"] == paused["session"]["version"]


def test_stale_version_from_another_device_conflicts(setup):
    client, clock = setup
    device_a = start(client).json()["session"]
    clock.t += 60
    act(client, device_a, "pause")  # dispositivo B pausou
    response = act(client, device_a, "pause")  # dispositivo A ainda com a versão antiga
    assert response.status_code == 409 and response.json()["code"] == "focus_conflict"
    assert response.json()["state"]["session"]["paused"]


def test_sessions_of_other_users_are_invisible(setup, make_app):
    client, _ = setup
    session = start(client).json()["session"]
    other = make_app()
    register(other, "maria")
    response = act(other, session, "pause")
    assert response.status_code == 404
    assert state(other)["session"] is None


# --- expiração e cronômetro -------------------------------------------------------------------


def test_forgotten_ready_and_paused_sessions_expire(setup):
    client, clock = setup
    start(client)
    clock.t += 30 * MIN  # ciclo + pausa; agora "pronto"
    clock.t += 31 * MIN
    assert state(client)["session"] is None
    item = client.get("/api/focus/history").json()["items"][0]
    assert item["status"] == "expired" and item["end_reason"] == "not_resumed" and item["cycles_completed"] == 1

    session = start(client).json()["session"]
    clock.t += 5 * MIN
    act(client, session, "pause")
    clock.t += 3 * 3600
    assert state(client)["session"] is None
    item = client.get("/api/focus/history").json()["items"][0]
    assert item["status"] == "expired" and item["focus_seconds"] == 5 * MIN


def test_stopwatch_counts_until_stopped(setup):
    client, clock = setup
    session = start(client, "stopwatch").json()["session"]
    assert session["phase_ends_at"] is None
    clock.t += 40 * MIN
    response = act(client, state(client)["session"], "stop").json()
    assert response["ended"]["status"] == "completed" and response["ended"]["focus_seconds"] == 40 * MIN
    assert response["ended"]["xp"] == 40 + 25


def test_focus_crossing_midnight_is_split_between_days(setup):
    client, clock = setup
    clock.t = datetime(2026, 10, 29, 23, 50, tzinfo=load_timezone(SP)).timestamp()
    start(client)
    clock.t += 25 * MIN
    stats = client.get("/api/focus/stats", params={"range": "7d"}).json()
    by_day = {d["date"]: d["seconds"] for d in stats["daily"]}
    assert by_day["2026-10-29"] == 10 * MIN and by_day["2026-10-30"] == 15 * MIN


def test_video_and_timer_together_count_once(setup):
    client, clock = setup
    start(client)
    sid = str(uuid.uuid4())
    client.post("/api/study/sessions", json={"id": sid, "source": "video", "course_id": "curso_exemplo", "lesson_key": "A001"})
    clock.t += 60
    segment = {"seq": 0, "start_ms": 0, "end_ms": 50_000, "media_from": 0, "media_to": 50, "rate": 1}
    client.post(f"/api/study/sessions/{sid}/segments", json={"segments": [segment]})
    clock.t += 25 * MIN - 60
    state(client)
    assert client.get("/api/study/metrics").json()["today"]["seconds"] == pytest.approx(25 * MIN, abs=0.01)


# --- metas, XP diário, métodos, vínculo com aula ---------------------------------------------------


def test_daily_goal_rewarded_once(setup):
    client, clock = setup
    goals = client.put("/api/focus/goals", json={"daily_minutes": 30, "weekly_minutes": 600}).json()
    assert goals["daily"]["target_seconds"] == 1800 and goals["daily"]["percent"] == 0
    assert client.put("/api/focus/goals", json={"daily_minutes": 5}).status_code == 422
    cursor = state(client, after=0)["notice_cursor"]
    session = start(client, "stopwatch").json()["session"]
    clock.t += 31 * MIN
    act(client, state(client)["session"], "stop")
    goals = client.get("/api/focus/goals").json()
    assert goals["daily"]["achieved"] and goals["daily"]["percent"] == 100
    assert goals["weekly"]["done_seconds"] == 31 * MIN and not goals["weekly"]["achieved"]
    notices = state(client, after=cursor)["notices"]
    assert sum(1 for n in notices if n["kind"] == "goal_reached") == 1
    # Mais foco no mesmo dia não paga a meta de novo.
    start(client, "stopwatch")
    clock.t += 10 * MIN
    act(client, state(client)["session"], "stop")
    progress = client.get("/api/focus/progress").json()
    assert progress["xp_by_kind"]["goal_daily"] == 30
    assert session["id"]


def test_focus_xp_has_a_daily_cap(setup):
    client, clock = setup
    clock.t = datetime(2026, 10, 29, 6, 0, tzinfo=load_timezone(SP)).timestamp()
    for _ in range(3):
        start(client, "stopwatch")
        clock.t += 4 * 3600  # limite do cronômetro
        state(client)
        clock.t += 60
    progress = client.get("/api/focus/progress").json()
    assert progress["xp_by_kind"]["focus"] == 480


def test_custom_methods_crud_and_history_survives_delete(setup):
    client, clock = setup
    body = {"name": "Revisão de programação", "focus_minutes": 40, "short_break_minutes": 10, "cycles": 2}
    created = client.post("/api/focus/methods", json=body)
    assert created.status_code == 201, created.text
    method = created.json()
    assert [s["stage"] for s in method["timeline"]] == ["focus", "short_break", "focus"]
    assert client.post("/api/focus/methods", json={**body, "name": "revisão de programação"}).status_code == 409
    bad = client.post("/api/focus/methods", json={**body, "name": "X", "focus_minutes": 2})
    assert bad.status_code == 422
    updated = client.put(f"/api/focus/methods/{method['id']}", json={**body, "focus_minutes": 45}).json()
    assert updated["focus_minutes"] == 45

    session = start(client, "custom", method_id=method["id"]).json()["session"]
    assert session["method_name"] == "Revisão de programação" and session["phase_ends_at"] == clock.t + 45 * MIN
    act(client, session, "stop")
    assert client.delete(f"/api/focus/methods/{method['id']}").status_code == 204
    assert client.get("/api/focus/methods").json() == []
    assert client.get("/api/focus/history").json()["items"][0]["method_name"] == "Revisão de programação"


def test_session_linked_to_lesson_feeds_course_stats(setup):
    client, clock = setup
    assert start(client, course_id="curso_exemplo", lesson_key="nao-existe").status_code == 404
    session = start(client, course_id="curso_exemplo", lesson_key="A001", intention="Revisar o módulo 1").json()["session"]
    assert session["course"]["id"] == "curso_exemplo" and session["lesson"]["key"] == "A001"
    assert session["intention"] == "Revisar o módulo 1"
    clock.t += 20 * MIN
    act(client, state(client)["session"], "stop")
    stats = client.get("/api/focus/stats", params={"range": "30d"}).json()
    assert stats["by_course"][0]["course_id"] == "curso_exemplo" and stats["by_course"][0]["seconds"] == 20 * MIN
    assert stats["by_lesson"][0]["lesson_key"] == "A001"
    assert stats["summary"]["sessions"] == 1 and stats["summary"]["focus_seconds"] == 20 * MIN
    assert stats["by_technique"][0]["technique"] == "pomodoro"
    assert len(stats["heatmap"]) >= 7 * 52


def test_notification_preferences(setup):
    client, _ = setup
    prefs = client.get("/api/focus/preferences").json()
    assert prefs["in_app"] and not prefs["system"]
    prefs = client.put("/api/focus/preferences", json={"system": True, "kinds": {**prefs["kinds"], "level_up": False}}).json()
    assert prefs["system"] and prefs["kinds"]["level_up"] is False and prefs["kinds"]["goal_reached"] is True


def test_concurrent_starts_and_actions_are_serialized(setup):
    from concurrent.futures import ThreadPoolExecutor

    from app.focus.engine import FocusError, Target

    client, clock = setup
    service = client.app.state.teleaula.focus
    user = client.get("/api/auth/me").json()["user"]["id"]
    plan = preset_plan(Technique.POMODORO)

    def try_start(_):
        try:
            return service.start(user, rid(), plan, method_id=None, method_name="Pomodoro", intention=None, target=Target())
        except FocusError as exc:
            return exc.code

    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(try_start, range(8)))
    assert sum(1 for r in results if isinstance(r, dict)) == 1
    assert results.count("focus_session_active") == 7

    session = service.state(user)["session"]
    clock.t += 60

    def try_pause(_):
        try:
            return service.act(user, session["id"], "pause", rid(), session["version"])["session"]["paused"]
        except FocusError as exc:
            return exc.code

    with ThreadPoolExecutor(6) as pool:
        results = list(pool.map(try_pause, range(6)))
    assert results.count(True) == 1 and results.count("focus_conflict") == 5
