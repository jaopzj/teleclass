"""Coleta das mensagens de um canal e conversão para `SourceMessage`.

Somente leitura: nunca envia mensagens nem entra em canais. Links de convite
só funcionam se a conta já for membro (PLANO.md, 4.4 e 9).
"""

from __future__ import annotations

from typing import Awaitable, Callable

from telethon import TelegramClient, functions, types
from telethon.tl.custom.message import Message

from ..indexing.models import ChannelSnapshot, MediaInfo, MediaKind, SourceMessage
from .links import ChannelLink, LinkKind, parse_channel_link

ProgressCallback = Callable[[int], Awaitable[None] | None]


class NotAMember(PermissionError):
    pass


async def resolve_channel(client: TelegramClient, link: ChannelLink):
    if link.kind is LinkKind.USERNAME:
        return await client.get_entity(link.value)
    if link.kind is LinkKind.PRIVATE_ID:
        return await client.get_entity(types.PeerChannel(int(link.value)))
    invite = await client(functions.messages.CheckChatInviteRequest(hash=link.value))
    if isinstance(invite, (types.ChatInviteAlready, types.ChatInvitePeek)):
        return invite.chat
    raise NotAMember(
        "A conta não participa deste canal. Entre pelo app do Telegram e tente de novo."
    )


def media_from_message(message: Message) -> MediaInfo | None:
    if message.web_preview or not message.media or not message.file:
        return None
    if message.video or message.video_note:
        kind = MediaKind.VIDEO
    elif message.voice:
        kind = MediaKind.VOICE
    elif message.audio:
        kind = MediaKind.AUDIO
    elif message.photo:
        kind = MediaKind.PHOTO
    elif message.document:
        mime = message.file.mime_type or ""
        kind = MediaKind.VIDEO if mime.startswith("video/") else MediaKind.DOCUMENT
    else:
        kind = MediaKind.OTHER
    file = message.file
    return MediaInfo(
        kind=kind,
        file_name=file.name,
        mime_type=file.mime_type,
        size=file.size,
        duration=file.duration,
        width=file.width,
        height=file.height,
    )


def to_source_message(message: Message) -> SourceMessage:
    return SourceMessage(
        id=message.id,
        date=message.date,
        text=message.raw_text or "",
        markdown=message.text or None,
        grouped_id=message.grouped_id,
        media=media_from_message(message),
    )


async def collect_channel(
    client: TelegramClient,
    link: str,
    *,
    on_progress: ProgressCallback | None = None,
) -> ChannelSnapshot:
    """Lê o histórico completo do canal, do mais antigo para o mais novo."""
    entity = await resolve_channel(client, parse_channel_link(link))
    snapshot = ChannelSnapshot(
        channel_id=entity.id,
        title=getattr(entity, "title", None),
        username=getattr(entity, "username", None),
    )
    async for message in client.iter_messages(entity, reverse=True):
        if isinstance(message, types.MessageService):
            continue  # mensagens de serviço (fixou, mudou o título...)
        snapshot.messages.append(to_source_message(message))
        if on_progress and len(snapshot.messages) % 200 == 0:
            result = on_progress(len(snapshot.messages))
            if result is not None:
                await result
    return snapshot
