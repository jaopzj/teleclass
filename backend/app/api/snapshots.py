from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..indexing.pipeline import index_snapshot
from ..snapshots import SnapshotNotFound
from .deps import AppState, get_state, get_user_id, require_telegram

# Cada usuário tem a própria biblioteca: coleta, lista e indexa só os seus snapshots.
router = APIRouter(prefix="/api/snapshots", tags=["snapshots"], dependencies=[Depends(get_user_id)])


class CollectRequest(BaseModel):
    link: str


@router.get("")
async def list_snapshots(state: AppState = Depends(get_state), user_id: str = Depends(get_user_id)) -> list[dict]:
    return [
        {
            "name": s.name,
            "title": s.title,
            "channel_id": s.channel_id,
            "messages": s.messages,
            "modified_at": s.modified_at.isoformat(),
        }
        for s in state.libraries.store(user_id).list()
    ]


@router.post("")
async def collect(
    body: CollectRequest, state: AppState = Depends(get_state), user_id: str = Depends(get_user_id)
) -> dict:
    from ..telegram.collector import NotAMember, collect_channel
    from ..telegram.links import InvalidLink

    require_telegram(state, user_id)
    client = await state.clients.client(user_id)
    if state.collect_lock.locked():
        raise HTTPException(409, "Já existe uma coleta em andamento")
    async with state.collect_lock:
        try:
            snapshot = await collect_channel(client, body.link)  # type: ignore[arg-type]
        except InvalidLink as exc:
            raise HTTPException(422, str(exc)) from exc
        except NotAMember as exc:
            raise HTTPException(403, str(exc)) from exc
        except ValueError as exc:  # Telethon: usuário/canal inexistente
            raise HTTPException(404, f"Canal não encontrado: {exc}") from exc
    name = state.libraries.store(user_id).save(snapshot)
    return {"name": name, "messages": len(snapshot.messages)}


@router.get("/{name}/index")
async def index(name: str, state: AppState = Depends(get_state), user_id: str = Depends(get_user_id)) -> dict:
    try:
        snapshot = state.libraries.store(user_id).load(name)
    except SnapshotNotFound as exc:
        raise HTTPException(404, "Snapshot não encontrado") from exc
    result = index_snapshot(snapshot)
    return {"name": name, **result.to_dict()}
