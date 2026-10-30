from app.indexing.outline import DEFAULT_PARSERS
from app.indexing.summary import detect_summary

from .conftest import msg


def test_split_summary_is_grouped():
    messages = [
        msg(1, "Siga o menu:\n= 01. Intro\n#A001\n= 02. Dois\n#A002"),
        msg(2, "#A003 #A004"),
        msg(3, "#A001 Aula", media="video"),
    ]
    detection = detect_summary(messages, DEFAULT_PARSERS)
    assert detection.chosen.message_ids == [1, 2]


def test_media_message_ends_block():
    messages = [
        msg(1, "= 01. Intro\n#A001\n#A002"),
        msg(2, "#A001", media="video"),
        msg(3, "#A003 #A004"),  # fraco e isolado: não é sumário
    ]
    detection = detect_summary(messages, DEFAULT_PARSERS)
    assert detection.chosen.message_ids == [1]
    assert detection.discarded == []


def test_largest_block_wins():
    messages = [
        msg(1, "= Velho\n#A001\n#A002"),
        msg(2, "x", media="video"),
        msg(3, "= Novo\n#A001\n#A002\n= Mais\n#A003"),
    ]
    detection = detect_summary(messages, DEFAULT_PARSERS)
    assert detection.chosen.message_ids == [3]
    assert [b.message_ids for b in detection.discarded] == [[1]]


def test_no_summary():
    assert detect_summary([msg(1, "olá"), msg(2, "", media="video")], DEFAULT_PARSERS).chosen is None
