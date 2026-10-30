from app.indexing.pipeline import index_snapshot
from app.indexing.resolver import MatchReason
from app.indexing.structure import Strategy, TitleSource

from .conftest import msg, snapshot


def lessons_by_ref(result):
    return {lesson.ref: lesson for lesson in result.course.lessons()}


def test_example_course_structure(example_snapshot):
    result = index_snapshot(example_snapshot)
    course = result.course
    assert course.strategy is Strategy.SUMMARY
    assert [s.title for s in course.sections] == [
        "01. Introdução", "02. Conceitos de programação", "03. Materiais extras",
    ]
    concepts = course.sections[1]
    assert [l.ref for l in concepts.children[0].lessons] == ["A002", "A003"]
    # A004 vem na mensagem seguinte do sumário, mas continua no subtópico "02.2. Funções".
    assert [l.ref for l in concepts.children[1].lessons] == ["A004"]
    assert [l.position for l in course.lessons()] == list(range(1, 8))


def test_example_lesson_metadata(example_snapshot):
    lessons = lessons_by_ref(index_snapshot(example_snapshot))
    a001 = lessons["A001"]
    assert a001.title == "Aula 01 - Boas-vindas"
    assert "[site oficial](https://example.com)" in a001.description
    assert lessons["A002"].title_source is TitleSource.FILE_NAME
    assert lessons["A002"].title == "02 - Variaveis e tipos"


def test_example_album_and_multiple_materials(example_snapshot):
    lessons = lessons_by_ref(index_snapshot(example_snapshot))
    album = lessons["A003"].materials
    assert [m.message_id for m in album] == [12, 13, 14]
    assert [m.reason for m in album] == [MatchReason.TAG, MatchReason.ALBUM, MatchReason.ALBUM]
    assert [m.message_id for m in lessons["A004"].materials] == [15, 16]


def test_example_report(example_snapshot):
    report = index_snapshot(example_snapshot).report
    assert report.summary.message_ids == [2, 3]
    assert [u.ref for u in report.unresolved] == ["A099"]
    assert [(d.ref, d.ignored_at) for d in report.duplicates_in_summary] == [("A002", ["3:5"])]
    assert [m.ref for m in report.multi_message_refs] == ["A004"]
    assert report.refs_not_in_summary == {"A050": [19]}
    assert [o.message_ids for o in report.orphans] == [[19], [20]]
    assert report.stats.unresolved_lessons == 1


def test_summary_messages_are_not_materials():
    result = index_snapshot(snapshot(
        msg(1, "= M\n#A001\n#A002"),
        msg(2, "#A001", media="video"),
    ))
    lessons = lessons_by_ref(result)
    assert [m.message_id for m in lessons["A001"].materials] == [2]
    assert not lessons["A002"].resolved


def test_message_shared_by_two_refs_is_reported():
    result = index_snapshot(snapshot(
        msg(1, "= M\n#A001\n#A002"),
        msg(2, "#A001 #A002 Aula dupla", media="video"),
    ))
    assert [(s.message_id, s.refs) for s in result.report.shared_messages] == [(2, ["A001", "A002"])]


def test_generated_title_follows_presentation_order():
    result = index_snapshot(snapshot(
        msg(1, "= M\n#X1\n#X2"),
        msg(2, "#X1", media="video"),
        msg(3, "#X2", media="video"),
    ))
    assert [l.title for l in result.course.lessons()] == ["Aula 1", "Aula 2"]


def test_fallback_is_chronological_and_groups_albums():
    result = index_snapshot(snapshot(
        msg(1, "Bem-vindos"),
        msg(2, "Primeira aula\nDescrição", media="video"),
        msg(3, "Fotos", media="photo", grouped_id=9),
        msg(4, "", media="photo", grouped_id=9),
        msg(5, "", media="document", file_name="material.pdf"),
    ))
    course = result.course
    assert course.strategy is Strategy.FALLBACK
    assert result.report.summary.fallback_reason == "nenhum sumário encontrado"
    (module,) = course.sections
    assert module.title == "Aulas"
    assert [l.title for l in module.lessons] == ["Primeira aula", "Fotos", "material"]
    assert [m.message_id for m in module.lessons[1].materials] == [3, 4]
