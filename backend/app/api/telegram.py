from __future__ import annotations

from fastapi import APIRouter, Depends

from .deps import AppState, get_state

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


@router.get("/status")
async def status(state: AppState = Depends(get_state)) -> dict:
    client = state.telegram
    authorized = bool(client) and await client.is_user_authorized()  # type: ignore[union-attr]
    from ..telegram.media import fast_crypto_available

    return {
        "configured": state.settings.telegram_configured,
        "authorized": authorized,
        # Sem cryptg, a criptografia do Telegram roda em Python puro e o vídeo fica lento.
        "fast_crypto": fast_crypto_available(),
    }
