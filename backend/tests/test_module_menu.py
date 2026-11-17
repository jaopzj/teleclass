"""Layout de menus por módulo (#I01 lista #J01, cabeçalho #J01 seguido das mídias)."""

import pytest

from app.courses.catalog import LessonKind, build_course
from app.indexing.layouts.module_menu.parsing import Marker, MenuParser, marker_of, prefix, video_title
from app.indexing.pipeline import index_snapshot
from app.indexing.refs import RefExtractor
from app.indexing.resolver import MatchReason
from app.indexing.storage import load_snapshot
from app.indexing.structure import TitleSource

from .conftest import FIXTURES, msg, snapshot

parser = MenuParser(RefExtractor())


@pytest.fixture
def menus_snapshot():
    return load_snapshot(FIXTURES / "curso_menus.json")


def keys(section):
    return [lesson.ref for lesson in section.lessons]


# --- leitura dos textos ---------------------------------------------------------

def test_menu_with_emoji_arrow_and_content_label():
    menu = parser.menu(
        "✳️ #I01\n\n➡ MODULO 00 - AULAS ESSENCIAIS\n\n► Conteúdo:\n"
        "#J01 - AULAS PARA A ESTRUTURA\n\n#J02 – OS REPERTORIOS\n#J03: TERCEIRA"
    )
    assert menu.key == "I01"
    assert menu.title == "MODULO 00 - AULAS ESSENCIAIS"
    assert [(e.key, e.label) for e in menu.entries] == [
        ("J01", "AULAS PARA A ESTRUTURA"), ("J02", "OS REPERTORIOS"), ("J03", "TERCEIRA"),
    ]


def test_menu_title_on_same_line_and_content_without_accent():
    menu = parser.menu("#I07 MODULO 06\nConteudo:\n#P01 - Uma aula")
    assert menu.title == "MODULO 06"
    assert [e.key for e in menu.entries] == ["P01"]


def test_header_is_not_a_menu():
    text = "#J01\n1 AULAS ESSENCIAIS PARA ENTENDER A ESTRUTURA\n\n▶️ Vídeo aulas abaixo"
    assert parser.menu(text) is None
    header = parser.header(text)
    assert (header.key, header.title, header.marker) == (
        "J01", "1 AULAS ESSENCIAIS PARA ENTENDER A ESTRUTURA", Marker.VIDEOS,
    )


@pytest.mark.parametrize("line, expected", [
    ("♻️ Materiais de apoio abaixo", Marker.MATERIALS),
    ("MATERIAL DE APOIO ABAIXO", Marker.MATERIALS),
    ("▶️ Vídeo aulas abaixo", Marker.VIDEOS),
    ("Videoaulas a seguir", Marker.VIDEOS),
    ("1 AULAS ESSENCIAIS PARA ENTENDER A ESTRUTURA", None),
])
def test_markers(line, expected):
    assert marker_of(line) is expected


def test_helpers():
    assert prefix("J01") == "J" and prefix("I12") == "I"
    assert video_title("Videoaula - Estrategias para argumentar") == "Estrategias para argumentar"
    assert video_title("Vídeo aula: Introdução") == "Introdução"


# --- curso montado ----------------------------------------------------------------

def test_modules_follow_menus(menus_snapshot):
    course = index_snapshot(menus_snapshot).course
    assert [s.title for s in course.sections] == [
        "MODULO 00 - AULAS ESSENCIAIS PARA ENTENDER REDACAO",
        "MODULO 01 - PROPOSTA DE INTERVENCAO",
    ]


def test_multiple_videos_and_materials_become_a_subtopic(menus_snapshot):
    module = index_snapshot(menus_snapshot).course.sections[0]
    j01 = module.children[0]
    assert j01.title == "AULAS ESSENCIAIS PARA ENTENDER A ESTRUTURA"
    assert keys(j01) == ["J01.m12", "J01.m13", "J01.m14", "J01.materiais"]
    first = j01.lessons[0]
    assert first.title.startswith("Estrutura textual - Estrutura basica")
    assert first.title_source is TitleSource.CAPTION
    assert first.materials[0].reason is MatchReason.SEQUENCE and first.materials[0].via == 11
    # O cabeçalho repetido (#J01 antes dos PDFs) volta para a mesma aula.
    assert [m.message_id for m in j01.lessons[-1].materials] == [16, 17, 18]


def test_loose_text_does_not_close_the_lesson(menus_snapshot):
    j02 = index_snapshot(menus_snapshot).course.sections[0].children[1]
    assert keys(j02) == ["J02.m20", "J02.m22"]


def test_listed_without_content_is_unresolved(menus_snapshot):
    result = index_snapshot(menus_snapshot)
    j03 = result.course.sections[0].children[2]
    assert [l.resolved for l in j03.lessons] == [False]
    assert [u.ref for u in result.report.unresolved] == ["J03"]


def test_simple_module_stays_flat_and_in_menu_order(menus_snapshot):
    module = index_snapshot(menus_snapshot).course.sections[1]
    assert module.children == []
    # O menu continua na mensagem 31 (limite de caracteres); K05 não está no menu e vai para o fim.
    assert keys(module) == ["K01.m33", "K02", "K03.m37", "K04", "K05.m40"]
    k01, k02, k03, k04, k05 = module.lessons
    assert k01.title == "AULA 01 - OS CINCO ELEMENTOS"
    assert k01.description == "Videoaula - Agente, ação, meio, finalidade e detalhamento"
    assert [m.media.file_name for m in k02.materials] == ["Lista_de_exercicios.pdf"]
    assert k04.description == "Leia o resumo em https://example.com/resumo"
    assert k05.title_source is TitleSource.HEADER


def test_report(menus_snapshot):
    report = index_snapshot(menus_snapshot).report
    assert report.summary.parser == "module_menu"
    assert report.summary.message_ids == [10, 30, 31]
    assert report.refs_not_in_summary == {"K05": [39]}
    assert [o.message_ids for o in report.orphans] == [[3]]
    assert report.stats.lessons == 12


def test_positions_are_linear(menus_snapshot):
    lessons = index_snapshot(menus_snapshot).course.lessons()
    assert [l.position for l in lessons] == list(range(1, len(lessons) + 1))
    assert lessons[0].ref == "J01.m12"


def test_keys_survive_a_new_video_in_the_middle():
    def channel(*extra):
        return snapshot(
            msg(1, "#I01\nMódulo\n#J01 - Aula um\n#J02 - Aula dois"),
            msg(2, "#J01\nAula um\nVídeo aulas abaixo"),
            msg(3, "Parte A", media="video"),
            *extra,
            msg(5, "Parte B", media="video"),
            msg(6, "#J02\nAula dois\nVídeo aulas abaixo"),
            msg(7, "Única", media="video"),
        )

    before = {l.ref for l in index_snapshot(channel()).course.lessons()}
    after = {l.ref for l in index_snapshot(channel(msg(4, "Nova", media="video"))).course.lessons()}
    assert before <= after and after - before == {"J01.m4"}


def test_same_tag_in_two_menus_is_scoped_by_menu():
    snap = snapshot(
        msg(1, "#I01\nMódulo 1\n#J01 - Um\n#J02 - Dois"),
        msg(2, "#J01\nUm"), msg(3, "a", media="video"),
        msg(4, "#J02\nDois"), msg(5, "b", media="video"),
        msg(10, "#I02\nMódulo 2\n#J01 - Outro um"),
        msg(11, "#J01\nOutro um"), msg(12, "c", media="video"),
    )
    course = index_snapshot(snap).course
    assert [keys(s) for s in course.sections] == [["I01.J01.m3", "J02.m5"], ["I02.J01.m12"]]


def test_header_in_the_video_caption_itself():
    snap = snapshot(
        msg(1, "#I01\nMódulo\n#J01 - Um\n#J02 - Dois\n#J03 - Três"),
        msg(2, "#J01\nUm"), msg(3, "a", media="video"),
        msg(4, "#J02\nDois"), msg(5, "b", media="video"),
        msg(6, "#J03 Três", media="video"),
    )
    lessons = index_snapshot(snap).course.lessons()
    assert [l.ref for l in lessons] == ["J01.m3", "J02.m5", "J03.m6"]


def test_catalog_kinds_and_navigation(menus_snapshot):
    course = build_course("redacao", menus_snapshot)
    kinds = {l.key: l.kind for l in course.lessons}
    assert kinds["J01.m12"] is LessonKind.VIDEO
    assert kinds["J01.materiais"] is LessonKind.FILE
    assert kinds["J03"] is LessonKind.UNAVAILABLE
    assert kinds["K04"] is LessonKind.TEXT
    first = course.lesson("J01.m12")
    assert course.next(first).key == "J01.m13"
    assert course.lesson("J01.m12").path == [
        "MODULO 00 - AULAS ESSENCIAIS PARA ENTENDER REDACAO",
        "AULAS ESSENCIAIS PARA ENTENDER A ESTRUTURA",
    ]
    assert course.has_media(16) and not course.has_media(3)


# --- canal real com duas partes (índices), tags trocadas e figurinhas -------------

@pytest.fixture
def parts_result():
    return index_snapshot(load_snapshot(FIXTURES / "curso_menus_partes.json"))


def test_index_menus_split_the_channel_into_parts(parts_result):
    titles = [s.title for s in parts_result.course.sections]
    assert titles == [
        "REDACAO - CONTEUDO INEDITO · MODULO 00 - COMECE POR AQUI",
        "REDACAO - CONTEUDO INEDITO · MODULO 01 - AULAS DE ESTRUTURA",
        "REDACAO - CONTEUDO INEDITO · MODULO 02 - AULAS DE REPERTORIO",
        # postado depois da parte 2, mas o índice da parte 1 o lista aqui
        "REDACAO - CONTEUDO INEDITO · MODULO 03 - AULAS MISTAS",
        "REDACAO - CONTEUDO INEDITO · MODULO 04 - OUTROS GENEROS TEXTUAIS",
        "REDACAO - CONTEUDO COMPLETO · MODULO 00 - AULAS ESSENCIAIS",
        "REDACAO - CONTEUDO COMPLETO · MODULO 03 - O QUE FALTA PARA O 1000",
        "REDACAO - CONTEUDO COMPLETO · MODULO 04 - OUTROS GENEROS TEXTUAIS",
    ]
    assert parts_result.report.unresolved == []


def test_repeated_module_tag_is_a_different_module(parts_result):
    first, second = parts_result.course.sections[:2]
    assert keys(first) == ["A01.m26", "A02.m29"]
    assert [l.ref for c in second.children for l in c.lessons] == [
        "B01.m34", "B01.materiais", "B02.m39", "B02.materiais",
    ]


def test_header_with_wrong_tag_is_matched_by_title(parts_result):
    b01 = parts_result.course.sections[1].children[0]
    # o segundo cabeçalho diz #A01, mas o título é o da aula B01
    assert [m.message_id for m in b01.lessons[-1].materials] == [36]


def test_stickers_are_ignored(parts_result):
    files = [m.media.file_name for l in parts_result.course.lessons() for m in l.materials if m.media]
    assert "sticker.webp" not in files
    assert parts_result.report.orphans == []


def test_shifted_menu_tags_follow_the_titles(parts_result):
    module = parts_result.course.sections[2]
    assert [(l.ref, l.title) for l in module.lessons] == [
        ("D01.m95", "AULA 01 - O QUE E REPERTORIO"),
        # fora do menu: entra logo depois da aula que a antecede no canal
        ("D07-508.m509", "AULA 07 - PARA ENTENDER A CRISE URBANA ERMINIA MARICATO"),
        ("D07.m512", "AULA 08 - NOVA EXPOSICAO DE SAMUEL DE SABOIA"),
        ("D08.m517", "AULA 09 - JESSE SOUZA"),
        ("D09.m523", "AULA 10 - BRASIL E OS CONFLITOS GLOBAIS"),  # cabeçalho #D010
        ("D10.m528", "AULA 11 - SUELI CARNEIRO"),
    ]
    assert parts_result.report.refs_not_in_summary == {"D07-508": [508]}


def test_lesson_tags_with_the_index_letter(parts_result):
    module = parts_result.course.sections[6]
    assert [l.ref for c in module.children for l in c.lessons] == ["M01.m463", "M01.m464", "M02.m467"]


def test_same_title_in_two_parts_goes_by_tag(parts_result):
    part1, part2 = parts_result.course.sections[4], parts_result.course.sections[7]
    assert keys(part1) == ["F01.m578"] and keys(part2) == ["N01.m491"]
