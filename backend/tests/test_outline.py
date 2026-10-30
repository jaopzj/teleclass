from app.indexing.outline import MarkerOutlineParser, OutlineSource, SignalStrength


def parse(*texts):
    return MarkerOutlineParser().parse([OutlineSource(str(i), t) for i, t in enumerate(texts, 1)])


def test_modules_subtopics_and_refs():
    outline = parse(
        "= 01. Introdução\n#A001\n= 02. Conceitos\n== 02.1. Variáveis\n#A002 #A003\n== 02.2. Funções\n#A004"
    )
    intro, concepts = outline.sections
    assert intro.title == "01. Introdução" and [r.key for r in intro.refs] == ["A001"]
    assert concepts.refs == []
    assert [c.title for c in concepts.children] == ["02.1. Variáveis", "02.2. Funções"]
    assert [r.key for r in concepts.children[0].refs] == ["A002", "A003"]


def test_double_equals_is_not_a_module():
    outline = parse("= 01. Módulo\n== 01.1. Sub")
    assert len(outline.sections) == 1
    assert outline.sections[0].children[0].level == 2


def test_title_is_preserved_verbatim():
    outline = parse("=   03. Introdução à linguagem Java: história & características!  ")
    assert outline.sections[0].title == "03. Introdução à linguagem Java: história & características!"


def test_hierarchy_continues_across_messages():
    outline = parse("= 01. Intro\n#A001", "#A002 #A003\n= 02. Outro\n#A004")
    assert [r.key for r in outline.sections[0].refs] == ["A001", "A002", "A003"]
    assert [r.location.source_id for r in outline.sections[0].refs] == ["1", "2", "2"]


def test_refs_before_any_module_go_to_implicit_section():
    outline = parse("#A001\n= 01. Intro\n#A002")
    assert outline.sections[0].implicit
    assert outline.warnings


def test_single_ref_label_is_kept():
    outline = parse("= M\n#F001 - Apostila completa\n#A1 #A2 texto")
    refs = outline.sections[0].refs
    assert refs[0].label == "Apostila completa"
    assert refs[1].label is None


def test_separator_lines_are_ignored():
    outline = parse("==========\n= 01. Intro\n#A001\n==========")
    assert [s.title for s in outline.sections] == ["01. Intro"]


def test_signal_strength():
    parser = MarkerOutlineParser()
    assert parser.signal("= 01. Intro\n#A001").strength is SignalStrength.STRONG
    assert parser.signal("#A050 #A051").strength is SignalStrength.WEAK
    assert parser.signal("Aula de hoje sobre #A001 com\nmuito texto\nexplicativo").strength is SignalStrength.NONE
