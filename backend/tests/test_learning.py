import pytest

from app.courses.catalog import IMPLICIT_SECTION_TITLE, build_course
from app.learning import Database, ProgressStore, summarize

from .conftest import msg, snapshot

SUMMARY = """= Módulo 1
== Parte A
#A001 #A002
== Parte B
#A003
= Módulo 2
#A004
#A005"""


@pytest.fixture
def course():
    return build_course(
        "curso",
        snapshot(
            msg(1, "#A001 Primeira", media="video"),
            msg(2, "#A002 Segunda", media="video"),
            msg(3, "#A003 Apostila", media="document", file_name="apostila.pdf"),
            msg(4, "#A004 Quarta", media="video"),
            msg(5, SUMMARY),
        ),
    )


@pytest.fixture
def db(tmp_path):
    database = Database(tmp_path / "t.db")
    database.migrate()
    database.migrate()  # idempotente
    return database


def test_course_order_keys_and_navigation(course):
    assert [lesson.key for lesson in course.lessons] == ["A001", "A002", "A003", "A004", "A005"]
    a002, a003 = course.lesson("A002"), course.lesson("A003")
    assert a002.path == ["Módulo 1", "Parte A"]
    # Do fim de um subtópico para o seguinte, e de um módulo para o próximo.
    assert course.next(a002).key == "A003"
    assert course.next(a003).key == "A004"
    assert course.previous(course.lesson("A004")).key == "A003"
    assert course.previous(course.lessons[0]) is None and course.next(course.lessons[-1]) is None
    assert [lesson.kind.value for lesson in course.lessons] == ["video", "video", "file", "video", "unavailable"]
    assert course.has_media(3) and not course.has_media(5)


def test_fallback_keys_use_message_id():
    course = build_course("c", snapshot(msg(1, "Aula", media="video"), msg(2, "Outra", media="video")))
    assert [lesson.key for lesson in course.lessons] == ["msg-1", "msg-2"]


def test_implicit_section_gets_readable_title():
    course = build_course("c", snapshot(msg(1, "#A001 x", media="video"), msg(2, "#A001\n= M\n#A002 #A003")))
    assert course.sections[0].title == IMPLICIT_SECTION_TITLE


def test_position_and_completion_are_independent(db):
    store = ProgressStore(db)
    saved = store.save_position("u", "c", "A001", 120, 600)
    assert saved.position_seconds == 120 and not saved.completed
    done = store.set_completed("u", "c", "A002", True)
    assert done.completed and done.position_seconds == 0 and done.last_watched_at is None
    assert store.save_position("u", "c", "A002", 5, 600).completed  # posição não desmarca
    assert not store.set_completed("u", "c", "A002", False).completed
    assert store.get("u", "c", "A001").position_seconds == 120
    assert store.get("outro", "c", "A001").position_seconds == 0  # por usuário


def test_summary_counts_once_and_resumes(course, db):
    store = ProgressStore(db)
    empty = summarize(course, {})
    assert (empty.completed, empty.total, empty.resume.key, empty.last_watched) == (0, 4, "A001", None)  # uma aula é indisponível

    store.set_completed("u", "curso", "A001", True)
    store.set_completed("u", "curso", "A001", True)  # sem contagem dupla
    store.set_completed("u", "curso", "removida", True)  # aula que não existe mais no curso
    store.save_position("u", "curso", "A003", 10, None)
    result = summarize(course, store.for_course("u", "curso"))
    assert (result.completed, result.percent) == (1, 25)
    assert result.last_watched.key == "A003" and result.resume.key == "A003"

    store.set_completed("u", "curso", "A003", True)
    result = summarize(course, store.for_course("u", "curso"))
    assert result.resume.key == "A004"  # próxima pendente depois da última assistida
