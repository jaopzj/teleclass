from app.indexing.refs import RefExtractor


def test_accepts_any_prefix_with_digits():
    refs = RefExtractor()
    assert refs.keys("#A001 #F001 #D001 #aula12 #M1A2") == ["A001", "F001", "D001", "AULA12", "M1A2"]


def test_ignores_plain_hashtags_and_inner_hashes():
    refs = RefExtractor()
    assert refs.keys("#java #dica C#10 abc#A001") == []


def test_normalizes_case_and_deduplicates():
    assert RefExtractor().keys("#a001 #A001") == ["A001"]


def test_strip_removes_refs():
    assert RefExtractor().strip("#A001 Aula 1  #A002") == "Aula 1"
