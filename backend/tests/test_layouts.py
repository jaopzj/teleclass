"""Escolha de layout e regressão do layout original."""

import json

import pytest

from app.indexing.layouts import UnknownLayout
from app.indexing.pipeline import IndexingOptions, index_snapshot
from app.indexing.storage import load_snapshot
from app.indexing.structure import Strategy

from .conftest import FIXTURES, msg, snapshot


def test_example_course_is_identical_to_golden(example_snapshot):
    """O layout original não pode mudar nada: curso, relatório e sumário iguais ao gravado."""
    golden = json.loads((FIXTURES / "golden" / "curso_exemplo.indexed.json").read_text(encoding="utf-8"))
    result = index_snapshot(example_snapshot).to_dict()
    assert result["layout"] == "tagged_summary"
    for key in ("course", "report", "outline"):
        assert result[key] == golden[key], key


def test_example_course_rejects_module_menu(example_snapshot):
    result = index_snapshot(example_snapshot)
    candidate = next(c for c in result.layout_candidates if c["name"] == "module_menu")
    assert candidate["accepted"] is False


def test_menu_channel_uses_module_menu():
    result = index_snapshot(load_snapshot(FIXTURES / "curso_menus.json"))
    assert result.layout == "module_menu"
    assert result.course.strategy is Strategy.MODULE_MENU


def test_layout_can_be_forced():
    menus = load_snapshot(FIXTURES / "curso_menus.json")
    result = index_snapshot(menus, IndexingOptions(layout="tagged_summary"))
    assert result.layout == "tagged_summary"
    assert result.course.strategy is not Strategy.MODULE_MENU
    with pytest.raises(UnknownLayout):
        index_snapshot(menus, IndexingOptions(layout="inexistente"))


def test_tagged_videos_after_text_header_stay_in_original_layout():
    """Cabeçalho de texto seguido de mídias que já têm a tag: o layout original resolve."""
    snap = snapshot(
        msg(1, "#I01\nMódulo 1\n#A01 - Primeira\n#A02 - Segunda"),
        msg(2, "#A01 Primeira", media="video"),
        msg(3, "#A02 Segunda", media="video"),
    )
    assert index_snapshot(snap).layout == "tagged_summary"


def test_menu_without_content_is_not_enough():
    snap = snapshot(
        msg(1, "#I01\nMódulo 1\n#J01 - Primeira\n#J02 - Segunda"),
        msg(2, "Aula avulsa", media="video"),
    )
    assert index_snapshot(snap).layout == "tagged_summary"
