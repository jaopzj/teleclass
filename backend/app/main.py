"""Aplicação FastAPI.

    uvicorn app.main:app --app-dir backend          # API em http://127.0.0.1:8000

Sempre escuta em 127.0.0.1 por padrão: a sessão do Telegram dá acesso total à
conta, então a API não deve ficar exposta na rede (PLANO.md, 9).
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .api import snapshots, telegram
from .api.deps import AppState
from .config import get_settings
from .snapshots import SnapshotStore

log = logging.getLogger("teleaula")
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    state = AppState(settings=settings, store=SnapshotStore(settings.snapshots_dir))
    if settings.telegram_configured:
        from .telegram.client import create_client

        client = create_client(settings)
        try:
            await client.connect()
            state.telegram = client
        except OSError as exc:
            log.warning("Não foi possível conectar ao Telegram: %s", exc)
    app.state.teleaula = state
    try:
        yield
    finally:
        if state.telegram is not None:
            await state.telegram.disconnect()  # type: ignore[attr-defined]


def create_app() -> FastAPI:
    app = FastAPI(title="Teleaula", lifespan=lifespan)
    app.include_router(telegram.router)
    app.include_router(snapshots.router)
    if FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
    return app


app = create_app()
