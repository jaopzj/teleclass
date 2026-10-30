"""Vídeos, arquivos e miniaturas das aulas, servidos a partir do Telegram.

Só mensagens que pertencem a um curso indexado podem ser pedidas: a rota
recebe o curso e confere se a mensagem faz parte dele.
"""

from __future__ import annotations

import unicodedata
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from telethon import errors

from ..courses import Course, CourseNotFound
from ..streaming.range import ByteRange, RangeNotSatisfiable, parse_range
from ..streaming.streamer import stream_range
from ..telegram.media import ChannelRef, MediaUnavailable, TelegramMedia
from ..telegram.clients import TelegramReauthRequired
from .deps import AppState, get_media, get_state, get_user_id

router = APIRouter(prefix="/api/courses", tags=["mídia"])

# Pedidos abertos (`bytes=N-`) recebem no máximo esta janela por resposta.
STREAM_WINDOW = 16 * 1024 * 1024


def _course(state: AppState, course_id: str, message_id: int) -> Course:
    try:
        course = state.catalog.get(course_id)
    except CourseNotFound as exc:
        raise HTTPException(404, "Curso não encontrado") from exc
    if not course.has_media(message_id):
        raise HTTPException(404, "Arquivo não pertence a este curso")
    return course


def _channel(course: Course) -> ChannelRef:
    return ChannelRef(course.channel_id, course.username)


@router.api_route("/{course_id}/media/{message_id}", methods=["GET", "HEAD"])
async def stream_media(
    course_id: str,
    message_id: int,
    request: Request,
    download: bool = False,
    state: AppState = Depends(get_state),
    user_id: str = Depends(get_user_id),
    media: TelegramMedia = Depends(get_media),
):
    course = _course(state, course_id, message_id)
    info = course.media_info(message_id)
    channel = _channel(course)
    try:
        size = info.size if info and info.size else await media.file_size(channel, message_id)
    except MediaUnavailable as exc:
        raise HTTPException(410, str(exc)) from exc
    except errors.UnauthorizedError as exc:
        await state.clients.revoked(user_id)
        raise TelegramReauthRequired() from exc

    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": _disposition(info.file_name if info else None, download),
    }
    mime = (info.mime_type if info else None) or "application/octet-stream"
    try:
        byte_range = parse_range(request.headers.get("range"), size, window=STREAM_WINDOW)
    except RangeNotSatisfiable:
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})

    if size == 0:
        return Response(b"", media_type=mime, headers=headers)
    status = 206
    if byte_range is None:
        byte_range, status = ByteRange(0, size - 1), 200
    else:
        headers["Content-Range"] = f"bytes {byte_range.start}-{byte_range.end}/{size}"
    headers["Content-Length"] = str(byte_range.length)

    if request.method == "HEAD":
        return Response(status_code=status, media_type=mime, headers=headers)
    try:
        # Garante que a mensagem existe e que a conta do usuário a acessa antes de
        # responder com 200/206 (inclusive para trechos que já estão no cache).
        await media.message(channel, message_id)
    except MediaUnavailable as exc:
        raise HTTPException(410, str(exc)) from exc
    except errors.UnauthorizedError as exc:
        await state.clients.revoked(user_id)
        raise TelegramReauthRequired() from exc
    body = stream_range(media.chunks(channel, message_id), byte_range)
    return StreamingResponse(body, status_code=status, media_type=mime, headers=headers)


@router.get("/{course_id}/media/{message_id}/thumb")
async def thumbnail(
    course_id: str,
    message_id: int,
    state: AppState = Depends(get_state),
    user_id: str = Depends(get_user_id),
    media: TelegramMedia = Depends(get_media),
):
    course = _course(state, course_id, message_id)
    folder = state.settings.thumbs_dir / str(course.channel_id or course.id)
    path = folder / f"{message_id}.jpg"
    missing = folder / f"{message_id}.none"
    cache = {"Cache-Control": "private, max-age=86400"}
    if path.is_file():
        return Response(path.read_bytes(), media_type="image/jpeg", headers=cache)
    if missing.is_file():
        raise HTTPException(404, "Sem miniatura")
    async with state.thumbs_semaphore:
        try:
            data = await media.thumbnail(_channel(course), message_id)
        except MediaUnavailable as exc:
            raise HTTPException(410, str(exc)) from exc
        except errors.UnauthorizedError as exc:
            await state.clients.revoked(user_id)
            raise TelegramReauthRequired() from exc
    folder.mkdir(parents=True, exist_ok=True)
    if not data:
        missing.touch()
        raise HTTPException(404, "Sem miniatura")
    path.write_bytes(data)
    return Response(data, media_type="image/jpeg", headers=cache)


def _disposition(file_name: str | None, download: bool) -> str:
    kind = "attachment" if download else "inline"
    if not file_name:
        return kind
    plain = unicodedata.normalize("NFKD", file_name)
    ascii_name = plain.encode("ascii", "ignore").decode().replace('"', "").strip() or "arquivo"
    return f"{kind}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(file_name)}"
