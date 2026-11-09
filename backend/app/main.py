"""Aplicação FastAPI.

    uvicorn app.main:app --app-dir backend          # API em http://127.0.0.1:8000

Sempre escuta em 127.0.0.1 por padrão: a sessão do Telegram dá acesso total à
conta, então a API não deve ficar exposta na rede (PLANO.md, 9).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from .accounts import RateLimiter, SessionStore, UserStore
from .api import auth, courses, focus, media, notebook, routine, snapshots, study, telegram
from .api.deps import AppState
from .config import Settings, get_settings
from .errors import AppError
from .focus import FocusService, FocusStats, GoalStore, MethodStore, NoticeStore
from .learning import Database, ProgressStore
from .notebook import FileStore, NotebookStore
from .routine import RoutineStore
from .libraries import Libraries
from .study import PreferencesStore, StudyLedger, StudyMetrics
from .streaming.cache import ChunkCache, DiskChunkCache
from .telegram.accounts import TelegramAccountStore, load_secret
from .telegram.clients import TelegramClients
from .telegram.linking import TelegramLinker

log = logging.getLogger("teleaula")
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
SWEEP_INTERVAL = 60
ORPHAN_SWEEP_EVERY = 60  # voltas da limpeza (~1 h)


def build_state(settings: Settings) -> AppState:
    database = Database(settings.database_path)
    database.migrate()
    limiter = RateLimiter()
    accounts = TelegramAccountStore(database, load_secret(settings.secret_path))
    clients = TelegramClients(
        settings,
        memory_cache=ChunkCache(settings.stream_cache_mb * 1024 * 1024),
        disk_cache=DiskChunkCache(settings.cache_dir, settings.disk_cache_mb * 1024 * 1024),
    )
    libraries = Libraries(settings.snapshots_dir)
    progress = ProgressStore(database)
    ledger = StudyLedger(database)
    preferences = PreferencesStore(database)
    notebook_store = NotebookStore(database)
    imported = notebook_store.import_legacy()
    if imported:
        log.info("%d anotação(ões) de aula convertidas para o Caderno Digital", imported)
    focus_service = FocusService(database, ledger)
    return AppState(
        settings=settings,
        libraries=libraries,
        progress=progress,
        notebook=notebook_store,
        notebook_files=FileStore(database, settings.notebook_dir),
        users=UserStore(database),
        sessions=SessionStore(database),
        limiter=limiter,
        telegram_accounts=accounts,
        clients=clients,
        linker=TelegramLinker(settings, accounts, clients, limiter),
        study=ledger,
        preferences=preferences,
        metrics=StudyMetrics(ledger, preferences, progress, libraries),
        focus=focus_service,
        focus_methods=MethodStore(database),
        focus_goals=GoalStore(database),
        focus_stats=FocusStats(database),
        focus_notices=NoticeStore(database),
        routine=RoutineStore(database, preferences, libraries, focus_service),
    )


async def _sweep(state: AppState) -> None:
    """Fecha vínculos abandonados e limpa sessões e contadores vencidos."""
    rounds = 0
    while True:
        await asyncio.sleep(SWEEP_INTERVAL)
        rounds += 1
        try:
            await state.linker.sweep()
            state.limiter.sweep(max_window=3600)
            await asyncio.to_thread(state.sessions.purge_expired)
            if rounds % ORPHAN_SWEEP_EVERY == 0:
                await asyncio.to_thread(_purge_orphan_files, state)
        except Exception:  # noqa: BLE001
            log.exception("Falha na limpeza periódica")


def _purge_orphan_files(state: AppState) -> None:
    """Uploads que nenhuma anotação usa (ex.: imagem enviada e removida antes de salvar)."""
    for user_id, file_id in state.notebook.orphan_files():
        state.notebook_files.remove(user_id, [file_id])


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    state = build_state(settings)
    if settings.telegram_configured:
        from .telegram.media import fast_crypto_available

        if not fast_crypto_available():
            log.warning(
                "Pacote 'cryptg' não instalado: o streaming fica muito lento. "
                "Rode 'pip install -e .' (ou 'pip install cryptg')."
            )
    else:
        log.warning("TG_API_ID/TG_API_HASH não definidos: o vínculo com o Telegram fica indisponível.")
    if settings.legacy_session_path.is_file():
        log.warning(
            "data/teleaula.session (login antigo pelo terminal) não é mais usado. Cada usuário vincula "
            "o Telegram pela tela de cadastro; depois disso, apague esse arquivo."
        )
    app.state.teleaula = state
    sweeper = asyncio.create_task(_sweep(state))
    try:
        yield
    finally:
        sweeper.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sweeper
        await state.linker.close()
        await state.clients.close()


def _same_origin(request: Request) -> bool:
    """Pedidos que alteram dados só valem vindos da própria página (anti-CSRF)."""
    origin = request.headers.get("origin")
    if not origin:
        return True  # navegadores sempre mandam Origin em POST/PUT/DELETE de outro site
    host = request.headers.get("host", "")
    return urlsplit(origin).netloc == host


def create_app() -> FastAPI:
    app = FastAPI(title="Teleaula", lifespan=lifespan)

    @app.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError):
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
        return JSONResponse(exc.to_dict(), status_code=exc.status, headers=headers)

    @app.middleware("http")
    async def csrf_guard(request: Request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS") and not _same_origin(request):
            return JSONResponse({"detail": "Origem não permitida.", "code": "bad_origin"}, status_code=403)
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    app.include_router(auth.router)
    app.include_router(telegram.router)
    app.include_router(snapshots.router)
    app.include_router(courses.router)
    app.include_router(media.router)
    app.include_router(study.router)
    app.include_router(focus.router)
    app.include_router(notebook.router)
    app.include_router(routine.router)
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
