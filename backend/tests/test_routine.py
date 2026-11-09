"""Minha Rotina: geração idempotente, modelo x ocorrência, status, cronômetro, vínculos e isolamento."""

from __future__ import annotations

import uuid
from datetime import date, datetime

import pytest

from app.routine import rules
from app.study.days import load_timezone

from .conftest import register

SP = "America/Sao_Paulo"
MONDAY = date(2026, 11, 9)  # segunda-feira


class Clock:
    def __init__(self, t: float) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t

    def at(self, day: date, hour: int = 10, minute: int = 0) -> None:
        self.t = datetime(day.year, day.month, day.day, hour, minute, tzinfo=load_timezone(SP)).timestamp()


@pytest.fixture
def setup(make_app):
    client = make_app()
    register(client)
    clock = Clock(0)
    clock.at(MONDAY)
    client.app.state.teleaula.routine.clock = clock
    client.app.state.teleaula.focus.clock = clock
    client.put("/api/study/preferences", json={"timezone": SP})
    return client, clock


def studies(**extra):
    body = {
        "name": "Estudos",
        "icon_key": "book-open",
        "color": "sky",
        "mode": "scheduled",
        "weekdays": [0, 2, 4],  # segunda, quarta, sexta
        "activities": [
            {"title": "Revisar anotações", "start_time": "08:00", "duration_minutes": 30},
            {"title": "Aula nova", "start_time": "08:30", "duration_minutes": 45},
            {"title": "Exercícios", "start_time": "09:15", "duration_minutes": 30, "is_optional": True},
        ],
    }
    body.update(extra)
    return body


def create(client, body=None):
    r = client.post("/api/routine/routines", json=body or studies())
    assert r.status_code == 201, r.text
    return r.json()


def day(client, d: date):
    r = client.get(f"/api/routine/day/{d.isoformat()}")
    assert r.status_code == 200, r.text
    return r.json()


def week(client, start: date, end: date):
    r = client.get("/api/routine/agenda", params={"from": start.isoformat(), "to": end.isoformat()})
    assert r.status_code == 200, r.text
    return {d["date"]: d for d in r.json()["days"]}


def status(client, occ, value, **extra):
    r = client.post(f"/api/routine/occurrences/{occ['id']}/status", json={"status": value, **extra})
    assert r.status_code == 200, r.text
    return r.json()


# --- regras puras -------------------------------------------------------------------------


def test_progress_rules():
    s = rules.summarize([
        {"status": "completed", "is_optional": False, "duration_minutes": 30},
        {"status": "skipped", "is_optional": False},
        {"status": "pending", "is_optional": False},
        {"status": "in_progress", "is_optional": False},
        {"status": "cancelled", "is_optional": False},
        {"status": "completed", "is_optional": True},
    ])
    assert (s.planned, s.completed, s.skipped, s.remaining, s.cancelled) == (4, 1, 1, 2, 1)
    assert s.progress == 0.25
    assert (s.optional_total, s.optional_completed) == (1, 1)
    assert rules.summarize([]).progress is None  # "sem planejamento", nem 0% nem 100%
    assert rules.summarize([]).consistent is None


def test_streak_ignores_rest_days_and_open_today():
    t = date(2026, 11, 10)
    data = {date(2026, 11, 5): True, date(2026, 11, 6): False, date(2026, 11, 7): True,
            # 8: descanso (sem planejamento)
            date(2026, 11, 9): True, t: False}
    s = rules.streak(data, t)
    assert s["current"] == 2  # 7 e 9; hoje em aberto não interrompe
    assert s["best"] == 2


def test_conflicts_and_time_progress():
    s = rules.summarize([
        {"status": "completed", "is_optional": False, "duration_minutes": 40, "invested_seconds": 60 * 60},  # passou: conta 40
        {"status": "pending", "is_optional": False, "duration_minutes": 60, "invested_seconds": 15 * 60},
        {"status": "pending", "is_optional": False, "duration_minutes": None, "invested_seconds": 600},  # sem duração: fora
        {"status": "pending", "is_optional": True, "duration_minutes": 30, "invested_seconds": 0},  # opcional: fora
    ])
    assert s.time_done_seconds == 55 * 60 and s.time_progress == 55 / 100
    assert rules.summarize([]).time_progress is None
    items = [
        {"id": "a", "status": "pending", "start_time": "08:00", "duration_minutes": 60},
        {"id": "b", "status": "pending", "start_time": "08:30", "duration_minutes": 10},
        {"id": "c", "status": "skipped", "start_time": "08:15", "duration_minutes": 10},
        {"id": "d", "status": "pending", "start_time": "09:00", "duration_minutes": None},
        {"id": "e", "status": "pending", "start_time": None},
    ]
    assert rules.conflicts(items) == [["a", "b"]]


# --- geração --------------------------------------------------------------------------------


def test_weekly_routine_generates_once_per_day(setup):
    client, _ = setup
    create(client)
    days = week(client, MONDAY, date(2026, 11, 15))
    counts = {d: len(v["occurrences"]) for d, v in days.items()}
    assert counts == {"2026-11-09": 3, "2026-11-10": 0, "2026-11-11": 3, "2026-11-12": 0,
                      "2026-11-13": 3, "2026-11-14": 0, "2026-11-15": 0}
    # Ler de novo (ou em paralelo) não duplica.
    again = week(client, MONDAY, date(2026, 11, 15))
    assert sum(len(v["occurrences"]) for v in again.values()) == 9
    d = day(client, MONDAY)
    assert [o["title"] for o in d["occurrences"]] == ["Revisar anotações", "Aula nova", "Exercícios"]
    assert d["routines"][0]["name"] == "Estudos"


def test_no_generation_for_past_or_before_activation(setup):
    client, clock = setup
    create(client)
    assert week(client, date(2026, 11, 2), date(2026, 11, 8))["2026-11-04"]["occurrences"] == []
    day(client, MONDAY)
    clock.at(date(2026, 11, 20))
    # 9/11 tinha sido gerado ao ler; 16/11 (passado nunca lido) não é gerado depois.
    past = week(client, date(2026, 11, 9), date(2026, 11, 19))
    assert len(past["2026-11-09"]["occurrences"]) == 3
    assert past["2026-11-16"]["occurrences"] == []


def test_manual_apply_on_sunday_and_idempotent(setup):
    client, _ = setup
    routine = create(client, studies(weekdays=[]))
    sunday = date(2026, 11, 15)
    assert day(client, sunday)["occurrences"] == []
    body = {"routine_id": routine["id"], "date": sunday.isoformat()}
    assert client.post("/api/routine/apply", json=body).status_code == 200
    assert client.post("/api/routine/apply", json=body).status_code == 200
    assert len(day(client, sunday)["occurrences"]) == 3


def test_two_routines_conflict_preview_and_shift(setup):
    client, _ = setup
    create(client)
    gym = create(client, {"name": "Academia", "mode": "scheduled", "weekdays": [],
                          "activities": [{"title": "Treino", "start_time": "08:15", "duration_minutes": 60}]})
    body = {"routine_id": gym["id"], "date": MONDAY.isoformat()}
    preview = client.post("/api/routine/apply/preview", json=body).json()
    assert [c["title"] for c in preview["items"][0]["conflicts"]] == ["Revisar anotações", "Aula nova"]  # 09:15 encosta, não sobrepõe
    shifted = client.post("/api/routine/apply/preview", json={**body, "start_time": "18:00"}).json()
    assert shifted["items"][0]["start_time"] == "18:00" and shifted["items"][0]["conflicts"] == []
    client.post("/api/routine/apply", json=body)
    d = day(client, MONDAY)
    assert len(d["occurrences"]) == 4
    assert d["conflicts"]  # sinalizado, nada removido


def test_duplicate_titles_are_flagged_and_skippable(setup):
    client, _ = setup
    client.post("/api/routine/occurrences", json={"date": MONDAY.isoformat(), "title": "Aula  nova"})
    other = create(client, studies(name="Outra", weekdays=[]))
    body = {"routine_id": other["id"], "date": MONDAY.isoformat()}
    preview = client.post("/api/routine/apply/preview", json=body).json()
    assert preview["items"][1]["duplicate_of"]["title"] == "Aula nova"
    client.post("/api/routine/apply", json={**body, "skip_duplicates": True})
    titles = [o["title"] for o in day(client, MONDAY)["occurrences"]]
    assert titles.count("Aula nova") == 1


# --- modelo x ocorrência -----------------------------------------------------------------------


def test_edit_only_this_day_keeps_model(setup):
    client, _ = setup
    routine = create(client)
    week(client, MONDAY, date(2026, 11, 13))
    wed = day(client, date(2026, 11, 11))["occurrences"][0]
    r = client.patch(f"/api/routine/occurrences/{wed['id']}", json={"start_time": "10:00"})
    assert r.json()["start_time"] == "10:00" and r.json()["customized"]
    assert day(client, MONDAY)["occurrences"][0]["start_time"] == "08:00"
    assert day(client, date(2026, 11, 13))["occurrences"][0]["start_time"] == "08:00"
    assert client.get(f"/api/routine/routines/{routine['id']}").json()["activities"][0]["start_time"] == "08:00"


def test_editing_model_updates_future_untouched_only(setup):
    client, clock = setup
    routine = create(client)
    week(client, MONDAY, date(2026, 11, 13))
    mon = day(client, MONDAY)["occurrences"][0]
    status(client, mon, "completed")
    fri = day(client, date(2026, 11, 13))["occurrences"][0]
    client.patch(f"/api/routine/occurrences/{fri['id']}", json={"title": "Só sexta"})
    clock.at(date(2026, 11, 10))
    body = studies()
    body["activities"] = [{**a, "id": routine["activities"][i]["id"]} for i, a in enumerate(body["activities"])]
    body["activities"][0]["title"] = "Revisão rápida"
    body["activities"].append({"title": "Resumo", "duration_minutes": 10})
    assert client.put(f"/api/routine/routines/{routine['id']}", json=body).status_code == 200
    assert day(client, MONDAY)["occurrences"][0]["title"] == "Revisar anotações"  # passado não muda
    wed = [o["title"] for o in day(client, date(2026, 11, 11))["occurrences"]]
    assert wed[0] == "Revisão rápida" and "Resumo" in wed
    assert day(client, date(2026, 11, 13))["occurrences"][0]["title"] == "Só sexta"  # personalizada fica


def test_scope_following_and_routine(setup):
    client, _ = setup
    routine = create(client)
    week(client, MONDAY, date(2026, 11, 20))
    mon = day(client, MONDAY)["occurrences"][1]
    client.patch(f"/api/routine/occurrences/{mon['id']}", json={"duration_minutes": 60, "scope": "following"})
    assert day(client, MONDAY)["occurrences"][1]["duration_minutes"] == 60
    assert day(client, date(2026, 11, 18))["occurrences"][1]["duration_minutes"] == 60
    assert client.get(f"/api/routine/routines/{routine['id']}").json()["activities"][1]["duration_minutes"] == 60
    mon = day(client, MONDAY)["occurrences"][2]
    client.patch(f"/api/routine/occurrences/{mon['id']}", json={"title": "Lista de exercícios", "scope": "routine"})
    assert day(client, MONDAY)["occurrences"][2]["title"] == "Exercícios"
    assert day(client, date(2026, 11, 11))["occurrences"][2]["title"] == "Lista de exercícios"


def test_dropping_weekday_and_pausing_clear_future_untouched(setup):
    client, _ = setup
    routine = create(client)
    week(client, MONDAY, date(2026, 11, 20))
    body = studies(weekdays=[0, 4])
    body["activities"] = [{**a, "id": routine["activities"][i]["id"]} for i, a in enumerate(body["activities"])]
    client.put(f"/api/routine/routines/{routine['id']}", json=body)
    assert day(client, date(2026, 11, 11))["occurrences"] == []
    assert len(day(client, date(2026, 11, 13))["occurrences"]) == 3
    client.post(f"/api/routine/routines/{routine['id']}/status", json={"status": "paused"})
    assert day(client, date(2026, 11, 13))["occurrences"] == []
    assert len(day(client, MONDAY)["occurrences"]) == 3  # hoje fica como está
    assert day(client, date(2026, 11, 16))["occurrences"] == []  # pausada não gera
    client.post(f"/api/routine/routines/{routine['id']}/status", json={"status": "active"})
    assert len(day(client, date(2026, 11, 16))["occurrences"]) == 3


def test_archive_restore_and_delete_keep_history(setup):
    client, _ = setup
    routine = create(client)
    occ = day(client, MONDAY)["occurrences"][0]
    status(client, occ, "completed")
    r = client.post(f"/api/routine/routines/{routine['id']}/status", json={"status": "archived"})
    assert r.json()["status"] == "archived" and r.json()["archived_at"]
    apply = client.post("/api/routine/apply", json={"routine_id": routine["id"], "date": "2026-11-15"})
    assert apply.status_code == 409
    client.post(f"/api/routine/routines/{routine['id']}/status", json={"status": "paused"})
    assert client.delete(f"/api/routine/routines/{routine['id']}").status_code == 204
    assert client.get("/api/routine/routines").json() == []
    today = day(client, MONDAY)
    assert today["occurrences"][0]["status"] == "completed"  # histórico preservado
    assert today["occurrences"][0]["routine"]["deleted"] is True


def test_unapply_routine_from_day(setup):
    client, _ = setup
    routine = create(client)
    first = day(client, MONDAY)["occurrences"][0]
    status(client, first, "completed")
    client.delete(f"/api/routine/apply/{routine['id']}/{MONDAY.isoformat()}")
    d = day(client, MONDAY)
    assert [o["title"] for o in d["occurrences"]] == ["Revisar anotações"]
    assert d["routines"] == []
    assert client.get(f"/api/routine/routines/{routine['id']}").status_code == 200
    # Reaplicar traz de volta as que saíram, sem duplicar a concluída.
    client.post("/api/routine/apply", json={"routine_id": routine["id"], "date": MONDAY.isoformat()})
    assert len(day(client, MONDAY)["occurrences"]) == 3


# --- status e resumo ---------------------------------------------------------------------------


def test_complete_and_skip_update_summary(setup):
    client, _ = setup
    create(client)
    occs = day(client, MONDAY)["occurrences"]
    status(client, occs[0], "completed", actual_minutes=25)
    status(client, occs[1], "skipped", reason="Sem tempo")
    s = day(client, MONDAY)["summary"]
    assert (s["planned"], s["completed"], s["skipped"], s["remaining"]) == (2, 1, 1, 0)
    assert s["progress"] == 0.5
    assert s["invested_seconds"] == 25 * 60
    assert s["optional_total"] == 1
    hist = client.get(f"/api/routine/occurrences/{occs[1]['id']}").json()["history"]
    assert hist[-1]["type"] == "skipped" and hist[-1]["data"]["reason"] == "Sem tempo"
    assert day(client, MONDAY)["streak"]["current"] == 1  # 1 de 2 = 50%


def test_empty_day_is_no_plan(setup):
    client, _ = setup
    s = day(client, MONDAY)["summary"]
    assert s["progress"] is None and s["planned"] == 0
    assert day(client, MONDAY)["streak"]["current"] == 0


def test_quick_add_without_time_and_reorder(setup):
    client, _ = setup
    a = client.post("/api/routine/occurrences", json={"date": "2026-11-10", "title": "Ler 10 páginas"}).json()
    b = client.post("/api/routine/occurrences", json={"date": "2026-11-10", "title": "Arrumar a mesa"}).json()
    assert a["start_time"] is None and a["source"] == "manual"
    client.post("/api/routine/occurrences/reorder", json={"date": "2026-11-10", "ids": [b["id"], a["id"]]})
    assert [o["title"] for o in day(client, date(2026, 11, 10))["occurrences"]] == ["Arrumar a mesa", "Ler 10 páginas"]
    # aparece na agenda de mês também (sem horário)
    assert len(week(client, date(2026, 11, 1), date(2026, 11, 30))["2026-11-10"]["occurrences"]) == 2


def test_quick_add_with_repeat_becomes_routine(setup):
    client, _ = setup
    r = client.post("/api/routine/occurrences", json={"date": MONDAY.isoformat(), "title": "Alongar",
                                                      "period": "morning", "repeat_weekdays": [0, 1]})
    assert r.status_code == 201 and r.json()["routine"]["name"] == "Alongar"
    assert len(day(client, MONDAY)["occurrences"]) == 1
    assert len(day(client, date(2026, 11, 10))["occurrences"]) == 1


def test_reschedule_moves_and_keeps_record(setup):
    client, _ = setup
    create(client)
    occ = day(client, MONDAY)["occurrences"][0]
    r = client.post(f"/api/routine/occurrences/{occ['id']}/reschedule", json={"date": "2026-11-10", "start_time": "19:00"})
    assert r.status_code == 200
    moved = r.json()
    assert moved["date"] == "2026-11-10" and moved["rescheduled_from"] == "2026-11-09"
    assert len(day(client, MONDAY)["occurrences"]) == 2
    assert day(client, date(2026, 11, 10))["occurrences"][0]["title"] == "Revisar anotações"
    # A rotina base continua igual: quarta segue com as 3.
    assert len(day(client, date(2026, 11, 11))["occurrences"]) == 3
    clash = client.post(f"/api/routine/occurrences/{day(client, MONDAY)['occurrences'][0]['id']}/reschedule",
                        json={"date": "2026-11-10", "start_time": "19:10"}).json()
    assert [c["title"] for c in clash["conflicts"]] == ["Revisar anotações"]


def test_remove_occurrence_does_not_regenerate(setup):
    client, _ = setup
    create(client)
    occ = day(client, MONDAY)["occurrences"][0]
    assert client.delete(f"/api/routine/occurrences/{occ['id']}").status_code == 204
    assert len(day(client, MONDAY)["occurrences"]) == 2
    assert len(day(client, MONDAY)["occurrences"]) == 2


# --- cronômetro (o do Foco) ----------------------------------------------------------------------


def focus_start(client, activity_id=None, technique="stopwatch"):
    body = {"request_id": str(uuid.uuid4()), "technique": technique, "timezone": SP}
    if activity_id:
        body["activity_id"] = activity_id
    return client.post("/api/focus/sessions", json=body)


def focus_act(client, action):
    s = client.get("/api/focus/state").json()["session"]
    return client.post(f"/api/focus/sessions/{s['id']}/actions",
                       json={"action": action, "request_id": str(uuid.uuid4()), "version": s["version"]})


def test_focus_timer_feeds_activity_time(setup):
    client, clock = setup
    create(client)
    occs = day(client, MONDAY)["occurrences"]
    r = focus_start(client, occs[0]["id"])
    assert r.status_code == 200, r.text
    assert r.json()["session"]["activity_id"] == occs[0]["id"]
    o = day(client, MONDAY)["occurrences"][0]
    assert o["status"] == "in_progress" and o["focusing"] is True
    clock.t += 600
    focus_act(client, "pause")
    clock.t += 300  # pausado: não conta
    focus_act(client, "resume")
    clock.t += 120
    d = day(client, MONDAY)
    assert d["occurrences"][0]["timer_seconds"] == 720  # inclui o trecho rodando agora
    # O mesmo tempo aparece no Foco: são os mesmos dados.
    assert round(client.get("/api/focus/state").json()["session"]["focus_seconds"]) == 600
    focus_act(client, "stop")
    d = day(client, MONDAY)
    o = d["occurrences"][0]
    assert o["status"] == "pending" and o["timer_seconds"] == 720  # parar não conclui
    assert d["summary"]["time_done_seconds"] == 720
    assert d["summary"]["time_progress"] == pytest.approx(720 / (75 * 60))  # 30 + 45 min obrigatórios


def test_completing_stops_focus_session(setup):
    client, clock = setup
    occ = client.post("/api/routine/occurrences", json={"date": MONDAY.isoformat(), "title": "Ler", "duration_minutes": 20}).json()
    focus_start(client, occ["id"])
    clock.t += 300
    status(client, occ, "completed")
    assert client.get("/api/focus/state").json()["session"] is None
    d = day(client, MONDAY)
    assert d["occurrences"][0]["status"] == "completed"
    assert d["summary"]["invested_seconds"] == 300
    assert d["summary"]["time_progress"] == pytest.approx(0.25)


def test_focus_only_for_today_and_open_activities(setup):
    client, _ = setup
    tomorrow = client.post("/api/routine/occurrences", json={"date": "2026-11-10", "title": "Amanhã"}).json()
    r = focus_start(client, tomorrow["id"])
    assert r.status_code == 409 and r.json()["code"] == "activity_not_today"
    done = client.post("/api/routine/occurrences", json={"date": MONDAY.isoformat(), "title": "Feita"}).json()
    status(client, done, "completed")
    assert focus_start(client, done["id"]).status_code == 409
    assert client.get("/api/focus/state").json()["session"] is None
    # Uma sessão do Foco sem atividade continua funcionando como antes.
    assert focus_start(client).status_code == 200
    assert day(client, MONDAY)["occurrences"][0]["focusing"] is False


def test_complete_only_today_future_only_editable(setup):
    client, clock = setup
    past = client.post("/api/routine/occurrences", json={"date": "2026-11-08", "title": "Ontem"})
    assert past.status_code == 201
    future = client.post("/api/routine/occurrences", json={"date": "2026-11-12", "title": "Quinta"}).json()
    r = client.post(f"/api/routine/occurrences/{past.json()['id']}/status", json={"status": "completed"})
    assert r.status_code == 409 and r.json()["code"] == "activity_not_today"
    for st in ("completed", "skipped"):
        r = client.post(f"/api/routine/occurrences/{future['id']}/status", json={"status": st})
        assert r.status_code == 409 and r.json()["code"] == "activity_not_today"
    assert client.patch(f"/api/routine/occurrences/{future['id']}", json={"title": "Quinta cedo"}).status_code == 200
    # Concluída hoje continua concluída depois que o dia passa.
    today = client.post("/api/routine/occurrences", json={"date": MONDAY.isoformat(), "title": "Hoje"}).json()
    status(client, today, "completed")
    clock.at(date(2026, 11, 10))
    assert day(client, MONDAY)["occurrences"][-1]["status"] == "completed"


# --- vínculos com cursos ----------------------------------------------------------------------------


def test_link_course_module_lesson_and_unavailable(setup):
    client, _ = setup
    course = client.get("/api/courses/curso_exemplo").json()
    section = course["sections"][0]
    lesson = section["lessons"][0] if section["lessons"] else section["children"][0]["lessons"][0]
    for link in (
        {"type": "course", "course_id": "curso_exemplo"},
        {"type": "module", "course_id": "curso_exemplo", "section_id": section["id"]},
        {"type": "lesson", "course_id": "curso_exemplo", "lesson_key": lesson["key"]},
    ):
        r = client.post("/api/routine/occurrences", json={"date": MONDAY.isoformat(), "title": "Estudar", "link": link})
        assert r.status_code == 201, r.text
        assert r.json()["link"]["available"] is True
    assert r.json()["link"]["lesson_title"] == lesson["title"]
    bad = client.post("/api/routine/occurrences", json={"date": MONDAY.isoformat(), "title": "x",
                                                       "link": {"type": "lesson", "course_id": "curso_exemplo", "lesson_key": "nope"}})
    assert bad.status_code == 422 and bad.json()["code"] == "invalid_content_link"
    client.delete("/api/courses/curso_exemplo")
    links = [o["link"] for o in day(client, MONDAY)["occurrences"]]
    assert all(l["available"] is False for l in links)  # a agenda não quebra


# --- validação e isolamento ---------------------------------------------------------------------------


def test_validation(setup):
    client, _ = setup
    assert client.post("/api/routine/routines", json={"name": "  "}).status_code == 422
    assert client.post("/api/routine/routines", json={"name": "x", "color": "#ff0000"}).status_code == 422
    assert client.post("/api/routine/routines", json={"name": "x", "icon_key": "<svg>"}).status_code == 422
    assert client.post("/api/routine/routines", json={"name": "x", "weekdays": [7]}).status_code == 422
    assert client.post("/api/routine/occurrences", json={"date": "2026-11-09", "title": "x", "start_time": "25:00"}).status_code == 422
    assert client.post("/api/routine/occurrences", json={"date": "ontem", "title": "x"}).status_code == 422
    assert client.get("/api/routine/agenda", params={"from": "2026-01-01", "to": "2026-12-31"}).status_code == 422


def test_other_user_cannot_touch(setup, make_app):
    client, _ = setup
    routine = create(client)
    occ = day(client, MONDAY)["occurrences"][0]
    other = make_app()
    register(other, "maria")
    assert other.get(f"/api/routine/routines/{routine['id']}").status_code == 404
    assert other.put(f"/api/routine/routines/{routine['id']}", json=studies()).status_code == 404
    assert other.post(f"/api/routine/occurrences/{occ['id']}/status", json={"status": "completed"}).status_code == 404
    assert focus_start(other, occ["id"]).status_code == 404
    assert other.delete(f"/api/routine/occurrences/{occ['id']}").status_code == 404
    assert other.post("/api/routine/occurrences/reorder", json={"date": MONDAY.isoformat(), "ids": [occ["id"]]}).status_code == 404
    assert other.get("/api/routine/routines").json() == []


def test_timezone_boundary(setup):
    """23:30 em São Paulo já é dia seguinte em UTC; o dia local continua sendo o de São Paulo."""
    client, clock = setup
    create(client)
    clock.at(MONDAY, 23, 30)
    assert day(client, MONDAY)["today"] == "2026-11-09"
    clock.at(date(2026, 11, 10), 0, 5)
    assert day(client, MONDAY)["today"] == "2026-11-10"


def test_stats(setup):
    client, _ = setup
    create(client)
    occs = day(client, MONDAY)["occurrences"]
    status(client, occs[0], "completed")
    status(client, occs[1], "completed")
    s = client.get("/api/routine/stats").json()
    assert s["totals"]["completed"] == 2 and s["totals"]["consistent_days"] == 1
    assert s["days"][-1]["date"] == MONDAY.isoformat()
    assert s["routines"][0]["name"] == "Estudos"
