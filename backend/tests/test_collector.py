from datetime import datetime, timezone

from telethon import types

from app.indexing.models import MediaKind
from app.telegram.collector import to_source_message

DATE = datetime(2025, 1, 1, tzinfo=timezone.utc)


def telethon_message(**kwargs):
    return types.Message(id=10, peer_id=types.PeerChannel(1), date=DATE, **kwargs)


def test_video_document_is_converted():
    document = types.Document(
        id=1, access_hash=1, file_reference=b"", date=DATE, mime_type="video/mp4",
        size=1234, dc_id=1,
        attributes=[
            types.DocumentAttributeVideo(duration=61, w=1280, h=720),
            types.DocumentAttributeFilename("aula.mp4"),
        ],
    )
    message = telethon_message(
        message="#A001 Aula", media=types.MessageMediaDocument(document=document), grouped_id=5
    )
    source = to_source_message(message)
    assert source.text == "#A001 Aula"
    assert source.grouped_id == 5
    assert source.media.kind is MediaKind.VIDEO
    assert (source.media.file_name, source.media.size, source.media.duration) == ("aula.mp4", 1234, 61)


def test_text_message_has_no_media():
    source = to_source_message(telethon_message(message="= 01. Intro\n#A001"))
    assert source.media is None
    assert source.text == "= 01. Intro\n#A001"
