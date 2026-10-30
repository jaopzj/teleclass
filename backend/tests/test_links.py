import pytest

from app.telegram.links import InvalidLink, LinkKind, parse_channel_link


@pytest.mark.parametrize(
    ("link", "kind", "value", "message_id"),
    [
        ("https://t.me/cursojava", LinkKind.USERNAME, "cursojava", None),
        ("t.me/cursojava/42", LinkKind.USERNAME, "cursojava", 42),
        ("@cursojava", LinkKind.USERNAME, "cursojava", None),
        ("https://t.me/+AbC_123-x", LinkKind.INVITE, "AbC_123-x", None),
        ("https://t.me/joinchat/AbC123", LinkKind.INVITE, "AbC123", None),
        ("https://t.me/c/123456/789", LinkKind.PRIVATE_ID, "123456", 789),
    ],
)
def test_parse_channel_link(link, kind, value, message_id):
    parsed = parse_channel_link(link)
    assert (parsed.kind, parsed.value, parsed.message_id) == (kind, value, message_id)


def test_invalid_link():
    with pytest.raises(InvalidLink):
        parse_channel_link("https://example.com/canal")
