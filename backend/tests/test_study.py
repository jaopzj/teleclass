"""Rastreamento de estudo: validação, idempotência, união de intervalos, dias e métricas."""

from __future__ import annotations

import threading
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.learning import Database
from app.study import InvalidTimezone, PreferencesStore, SegmentClaim, SessionContext, StudyLedger, StudySource
from app.study.days import load_timezone, split_by_day
from app.study.ledger import SessionNotFound, SourceUnavailable
from app.study.metrics import ACTIVE_DAY_SECONDS, CourseTally, compute_courses, compute_time
from app.study.sources import TimerPolicy, VideoPolicy

SP = "America/Sao_Paulo"
LESSON = SessionContext("curso", "A001", 600)


class Clock:
    def __init__(self, t: float) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


def at(text: str, tz: str = SP) -> float:
    return datetime.fromisoformat(text).replace(tzinfo=load_timezone(tz)).timestamp()


@pytest.fixture
def db(tmp_path):
    database = Database(tmp_path / "t.db")
    database.migrate()
    with database.connect() as conn:
        for user in ("u", "outro"):
            conn.execute(
                "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', 'agora')", (user, user)
            )
    PreferencesStore(database).set_timezone("u", SP)
    PreferencesStore(database).set_timezone("outro", SP)
    return database


@pytest.fixture
def clock():
    return Clock(at("2026-10-28T10:00:00"))


@pytest.fixture
def ledger(db, clock):
    return StudyLedger(db, clock)


def sid() -> str:
    return str(uuid.uuid4())


def play(seq: int, start: float, end: float, media_from: float | None = None, rate: float = 1.0) -> SegmentClaim:
    """Trecho de reprodução de `start` a `end` segundos desde a abertura da sessão."""
    media_from = start * rate if media_from is None else media_from
    return SegmentClaim(seq, int(start * 1000), int(end * 1000), media_from, media_from + (end - start) * rate, rate)


def daily(ledger, user="u") -> dict[str, float]:
    return {d.isoformat(): round(sum(s.values()), 3) for d, s in ledger.daily_totals(user).items()}


# --- calendário -------------------------------------------------------------------


def test_split_at_local_midnight():
    tz = load_timezone(SP)
    pieces = split_by_day(at("2026-10-28T23:50:00"), at("2026-10-29T00:10:00"), tz)
    assert [(d.isoformat(), round(e - s)) for d, s, e in pieces] == [("2026-10-28", 600), ("2026-10-29", 600)]


def test_split_on_daylight_saving_days():
    tz = load_timezone(SP)
    # 04/11/2018: o relógio pulou de 00:00 para 01:00 (a meia-noite não existiu).
    start = datetime(2018, 11, 4, 2, 50, tzinfo=timezone.utc).timestamp()  # 23:50 do dia 3 (UTC-3)
    pieces = split_by_day(start, start + 1200, tz)
    assert [(d.isoformat(), round(e - s)) for d, s, e in pieces] == [("2018-11-03", 600), ("2018-11-04", 600)]
    # 17/02/2019: 00:00 voltou para 23:00; o dia 16 teve 25 horas.
    start = datetime(2019, 2, 17, 1, 50, tzinfo=timezone.utc).timestamp()  # 23:50 (UTC-2), ainda dia 16
    pieces = split_by_day(start, start + 2 * 3600, tz)
    assert [(d.isoformat(), round(e - s)) for d, s, e in pieces] == [("2019-02-16", 4200), ("2019-02-17", 3000)]


@pytest.mark.parametrize("name", ["", "Nada/Existe", "../etc/passwd", "a" * 80, "America/Sao Paulo"])
def test_invalid_timezones(name):
    with pytest.raises(InvalidTimezone):
        load_timezone(name)


# --- regras da origem "vídeo" -------------------------------------------------------


def test_playback_speed_counts_real_time():
    policy = VideoPolicy()
    # 10 min de relógio em 2×: 20 min de vídeo, 10 min de estudo.
    assert policy.credit(SegmentClaim(0, 0, 600_000, 0, 1200, 2.0), LESSON_LONG).seconds == 600
    assert policy.credit(SegmentClaim(0, 0, 600_000, 0, 300, 0.5), LESSON_LONG).seconds == 600


LESSON_LONG = SessionContext("curso", "A001", 3600)


def test_time_without_media_progress_is_not_credited():
    policy = VideoPolicy()
    # 15 s declarados, mas o vídeo andou 2 s (travado, aba congelada, manipulação).
    credit = policy.credit(SegmentClaim(0, 0, 15_000, 100, 102, 1.0), LESSON)
    assert credit.seconds == 2 and credit.reason == "media_mismatch"
    assert policy.credit(SegmentClaim(0, 0, 15_000, 100, 100, 1.0), LESSON).reason == "no_playback"
    assert policy.credit(SegmentClaim(0, 0, 15_000, 0, 15, 9.0), LESSON).reason == "invalid_rate"
    assert policy.credit(SegmentClaim(0, 0, 15_000, 700, 715, 1.0), LESSON).reason == "media_out_of_range"
    assert policy.credit(SegmentClaim(0, 0, 15_000), LESSON).reason == "missing_media"
    # Pequenas diferenças de arredondamento são toleradas.
    assert policy.credit(SegmentClaim(0, 0, 15_400, 0, 15, 1.0), LESSON).seconds == 15.4


def test_timer_policy_prepared_but_disabled(ledger):
    assert TimerPolicy().credit(SegmentClaim(0, 0, 60_000), SessionContext()).seconds == 60
    with pytest.raises(SourceUnavailable):
        ledger.open_session("u", sid(), StudySource.TIMER, SessionContext())


# --- livro-razão ---------------------------------------------------------------------


def test_normal_session_with_pauses(ledger, clock):
    s = sid()
    ledger.open_session("u", s, StudySource.VIDEO, LESSON)
    clock.t += 120
    # tocou 0–15, 15–30, pausou 30–90 (nada relatado), tocou 90–100
    _, results = ledger.record("u", s, [play(0, 0, 15), play(1, 15, 30), play(2, 90, 100, media_from=30)], LESSON)
    assert [r.status for r in results] == ["accepted"] * 3
    assert daily(ledger) == {"2026-10-28": 40}


def test_duplicates_and_retries_count_once(ledger, clock):
    s = sid()
    ledger.open_session("u", s, StudySource.VIDEO, LESSON)
    assert ledger.open_session("u", s, StudySource.VIDEO, LESSON).id == s  # reabrir é inofensivo
    clock.t += 60
    ledger.record("u", s, [play(0, 0, 15)], LESSON)
    session, results = ledger.record("u", s, [play(0, 0, 15), play(1, 15, 30)], LESSON)
    assert results[0].duplicate and results[0].credited_seconds == 15
    assert not results[1].duplicate
    # Mesmo número de sequência com outro conteúdo: vale o primeiro.
    _, again = ledger.record("u", s, [play(1, 15, 45)], LESSON)
    assert again[0].duplicate and again[0].credited_seconds == 15
    assert session.credited_seconds == 30 and daily(ledger) == {"2026-10-28": 30}


def test_overlap_inside_session_is_rejected(ledger, clock):
    s = sid()
    ledger.open_session("u", s, StudySource.VIDEO, LESSON)
    clock.t += 60
    _, results = ledger.record("u", s, [play(0, 0, 20), play(1, 10, 30, media_from=20)], LESSON)
    assert results[1].status == "rejected" and results[1].reason == "overlap"
    assert daily(ledger) == {"2026-10-28": 20}


def test_concurrent_tabs_count_chronological_time_once(ledger, clock):
    a, b = sid(), sid()
    ledger.open_session("u", a, StudySource.VIDEO, LESSON)
    ledger.open_session("u", b, StudySource.VIDEO, SessionContext("curso", "A002", 600))
    clock.t += 60
    ledger.record("u", a, [play(0, 0, 30)], LESSON)
    _, results = ledger.record("u", b, [play(0, 10, 40)], SessionContext("curso", "A002", 600))
    # As duas abas tocaram juntas de 10 a 30 s: só os 10 s finais da segunda contam.
    assert results[0].status == "adjusted" and results[0].reason == "overlap"
    assert round(results[0].credited_seconds) == 10
    assert daily(ledger) == {"2026-10-28": 40}


def test_concurrent_requests_are_serialized(ledger, clock):
    sessions = [sid() for _ in range(6)]
    for s in sessions:
        ledger.open_session("u", s, StudySource.VIDEO, LESSON)
    clock.t += 120
    errors = []

    def send(s):
        try:
            ledger.record("u", s, [play(0, 0, 60)], LESSON)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=send, args=(s,)) for s in sessions]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    assert daily(ledger) == {"2026-10-28": 60}  # seis abas no mesmo minuto: 60 s


def test_future_long_and_expired_segments_are_rejected(ledger, clock):
    s = sid()
    ledger.open_session("u", s, StudySource.VIDEO, LESSON_LONG)
    clock.t += 30
    _, results = ledger.record("u", s, [play(0, 0, 60)], LESSON_LONG)  # termina 30 s no futuro
    assert results[0].reason == "in_future"
    clock.t += 3600
    _, results = ledger.record("u", s, [play(1, 0, 400)], LESSON_LONG)
    assert results[0].reason == "segment_too_long"
    _, results = ledger.record("u", s, [SegmentClaim(2, 13 * 3600 * 1000, 13 * 3600 * 1000 + 5000, 0, 5, 1)], LESSON_LONG)
    assert results[0].reason == "session_expired"
    assert daily(ledger) == {}


def test_late_report_after_crash_is_anchored_to_real_time(ledger, clock):
    """Trechos guardados no navegador e enviados no dia seguinte contam no dia em que aconteceram."""
    clock.t = at("2026-10-28T23:55:00")
    s = sid()
    ledger.open_session("u", s, StudySource.VIDEO, LESSON_LONG)
    clock.t = at("2026-10-29T09:00:00")  # o navegador fechou; reenvio na manhã seguinte
    ledger.record("u", s, [play(0, 0, 240), play(1, 240, 480)], LESSON_LONG)
    assert daily(ledger) == {"2026-10-28": 300, "2026-10-29": 180}  # atravessou a meia-noite


def test_sessions_are_private(ledger, clock):
    s = sid()
    ledger.open_session("u", s, StudySource.VIDEO, LESSON)
    clock.t += 60
    with pytest.raises(SessionNotFound):
        ledger.record("outro", s, [play(0, 0, 10)], LESSON)
    with pytest.raises(SessionNotFound):
        ledger.open_session("outro", s, StudySource.VIDEO, LESSON)  # id de outra pessoa
    with pytest.raises(SessionNotFound):
        ledger.open_session("u", s, StudySource.VIDEO, SessionContext("curso", "A002", 600))
    assert daily(ledger, "outro") == {}


def test_timezone_change_keeps_history(ledger, clock, db):
    clock.t = at("2026-10-28T22:00:00")
    s = sid()
    ledger.open_session("u", s, StudySource.VIDEO, LESSON)
    clock.t += 60
    ledger.record("u", s, [play(0, 0, 30)], LESSON)
    PreferencesStore(db).set_timezone("u", "Asia/Tokyo")  # em Tóquio já seria dia 29
    clock.t += 60
    ledger.record("u", s, [play(1, 60, 90, media_from=30)], LESSON)
    assert daily(ledger) == {"2026-10-28": 30, "2026-10-29": 30}


def test_daily_rollup_matches_ledger(ledger, clock):
    clock.t = at("2026-10-28T23:58:00")
    a, b = sid(), sid()
    ledger.open_session("u", a, StudySource.VIDEO, LESSON_LONG)
    ledger.open_session("u", b, StudySource.VIDEO, LESSON_LONG)
    clock.t += 600
    ledger.record("u", a, [play(i, i * 50, i * 50 + 50) for i in range(10)], LESSON_LONG)
    ledger.record("u", b, [play(i, i * 50 + 25, i * 50 + 75) for i in range(10)], LESSON_LONG)
    before = daily(ledger)
    ledger.rebuild_daily("u")
    assert daily(ledger) == before
    assert round(sum(before.values())) == 525


# --- métricas -----------------------------------------------------------------------

TODAY = date(2026, 10, 29)  # quinta-feira


def days(**minutes_by_offset: float) -> dict:
    """`d0=30, d1=12` → hoje 30 min, ontem 12 min."""
    return {TODAY - timedelta(days=int(k[1:])): {"video": v * 60} for k, v in minutes_by_offset.items()}


def test_today_week_and_previous_week():
    m = compute_time(days(d0=30, d1=20, d3=15, d4=100, d7=40, d10=5), TODAY)
    assert m["today"] == {"date": "2026-10-29", "seconds": 1800, "active": True}
    # Semana de seg 26 a dom 01/11: seg (d3), ter (d2), qua (d1), qui (d0).
    assert m["week"]["start"] == "2026-10-26" and m["week"]["end"] == "2026-11-01"
    assert m["week"]["seconds"] == (30 + 20 + 15) * 60
    assert m["week"]["previous_to_date_seconds"] == (40 + 5) * 60  # seg 19 (d10) a qui 22 (d7)
    assert [d["seconds"] for d in m["week"]["days"]][3:] == [1800, None, None, None]


def test_streak_rules():
    below = (ACTIVE_DAY_SECONDS - 1) / 60
    m = compute_time(days(d0=12, d1=10, d2=30, d4=50), TODAY)
    assert m["streak"] == {"current": 3, "includes_today": True, "best": 3}
    # Hoje ainda abaixo do mínimo: a sequência de ontem continua valendo.
    m = compute_time(days(d0=below, d1=10, d2=30), TODAY)
    assert m["streak"] == {"current": 2, "includes_today": False, "best": 2}
    # Um dia sem o mínimo quebra a sequência.
    m = compute_time(days(d1=15, d2=below, d3=40, d4=40, d5=40), TODAY)
    assert m["streak"]["current"] == 1 and m["streak"]["best"] == 3
    assert compute_time({}, TODAY)["streak"] == {"current": 0, "includes_today": False, "best": 0}


def test_daily_average_uses_complete_days_since_first_study():
    m = compute_time(days(d0=300, d1=60, d2=0.5, d3=30), TODAY)
    avg = m["daily_average"]
    # Primeiro estudo há 3 dias: janela d3..d1 (hoje fica de fora).
    assert (avg["window_start"], avg["window_end"], avg["days"]) == ("2026-10-26", "2026-10-28", 3)
    assert avg["seconds_per_day"] == pytest.approx((60 + 0.5 + 30) * 60 / 3)
    assert avg["active_days"] == 2 and avg["seconds_per_active_day"] == 45 * 60
    # Janela de no máximo 7 dias completos.
    avg = compute_time(days(d1=70, d8=999, d20=999), TODAY)["daily_average"]
    assert avg["days"] == 7 and avg["seconds_per_day"] == 600
    # Começou hoje: ainda não há dia completo.
    assert compute_time(days(d0=30), TODAY)["daily_average"] is None
    assert compute_time({}, TODAY)["daily_average"] is None


def test_course_progress_is_lesson_weighted():
    week = datetime(2026, 10, 26, 3, tzinfo=timezone.utc)
    result = compute_courses(
        [
            CourseTally(9, 10, True, ("2026-10-27T10:00:00+00:00",) + ("2026-10-01T10:00:00+00:00",) * 8),
            CourseTally(1, 90, True, ("2026-10-26T02:00:00+00:00",)),  # antes da segunda local
            CourseTally(0, 50, False),  # não iniciado: fora do progresso geral
            CourseTally(0, 0, True),  # sem aulas válidas
        ],
        week,
    )
    # (9 + 1) / (10 + 90) = 10%, não a média de 90% e 1%.
    assert result["courses"]["percent"] == 10
    assert result["courses"]["started"] == 2 and result["courses"]["without_lessons"] == 1
    assert result["lessons"] == {"completed": 10, "completed_this_week": 1}
    full = compute_courses([CourseTally(199, 200, True)], week)
    assert full["courses"]["percent"] == 99  # 100% só com tudo concluído
