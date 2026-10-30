"""Aplicação FastAPI.

    uvicorn app.main:app --app-dir backend          # API em http://127.0.0.1:8000

Sempre escuta em 127.0.0.1 por padrão: a sessão do Telegram dá acesso total à
conta, então a API não deve ficar exposta na rede (PLANO.md, 9).
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from .api import courses, media, snapshots, telegram
from .api.deps import AppState
from .config import get_settings
from .courses import CourseCatalog
from .learning import Database, NotesStore, ProgressStore
from .snapshots import SnapshotStore

log = logging.getLogger("teleaula")
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    store = SnapshotStore(settings.snapshots_dir)
    database = Database(settings.database_path)
    database.migrate()
    state = AppState(
        settings=settings,
        store=store,
        catalog=CourseCatalog(store),
        progress=ProgressStore(database),
        notes=NotesStore(database),
    )
    if settings.telegram_configured:
        from .telegram.client import create_client
        from .telegram.media import TelegramMedia

        client = create_client(settings)
        try:
            await client.connect()
            state.telegram = client
            state.media = TelegramMedia(client)
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
    app.include_router(courses.router)
    app.include_router(media.router)
    if FRONTEND_DIST.is_dir():
        # SPA: qualquer rota que não seja da API devolve o index.html (ex.: /cursos/x).
        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404)
            file = (FRONTEND_DIST / path).resolve()
            if path and file.is_file() and file.is_relative_to(FRONTEND_DIST):
                return FileResponse(file)
            return FileResponse(FRONTEND_DIST / "index.html")

    return app


app = create_app()
