"""Configuração lida do ambiente (ver `.env.example`)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Carrega um `.env` simples (CHAVE=valor) sem sobrescrever o ambiente."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split(" #", 1)[0].strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def _int(value: str | None, default: int) -> int:
    value = (value or "").strip()
    return int(value) if value.isdigit() else default


@dataclass(frozen=True, slots=True)
class Settings:
    api_id: int | None
    api_hash: str | None
    data_dir: Path
    # Trechos de vídeo já baixados: memória e disco (data/cache), em MB. 0 desliga.
    stream_cache_mb: int = 256
    disk_cache_mb: int = 4096

    @property
    def sessions_dir(self) -> Path:
        # Uma sessão do Telethon por usuário. Cada arquivo equivale à senha da conta.
        return self.data_dir / "sessions"

    def session_path(self, user_id: str) -> Path:
        # O Telethon acrescenta ".session".
        return self.sessions_dir / user_id

    @property
    def legacy_session_path(self) -> Path:
        # Sessão única criada pelo antigo `python -m app.cli login` (não é mais usada).
        return self.data_dir / "teleaula.session"

    @property
    def secret_path(self) -> Path:
        return self.data_dir / "secret.key"

    @property
    def snapshots_dir(self) -> Path:
        return self.data_dir / "snapshots"

    @property
    def database_path(self) -> Path:
        return self.data_dir / "teleaula.db"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def notebook_dir(self) -> Path:
        # Imagens e anexos do Caderno Digital, uma pasta por usuário.
        return self.data_dir / "notebook"

    @property
    def thumbs_dir(self) -> Path:
        return self.data_dir / "thumbs"

    @property
    def telegram_configured(self) -> bool:
        return bool(self.api_id and self.api_hash)


def get_settings() -> Settings:
    _load_dotenv(Path(".env"))
    api_id = os.environ.get("TG_API_ID", "").strip()
    return Settings(
        api_id=int(api_id) if api_id.isdigit() else None,
        api_hash=os.environ.get("TG_API_HASH") or None,
        data_dir=Path(os.environ.get("TELEAULA_DATA_DIR", "./data")).resolve(),
        stream_cache_mb=_int(os.environ.get("TELEAULA_STREAM_CACHE_MB"), 256),
        disk_cache_mb=_int(os.environ.get("TELEAULA_DISK_CACHE_MB"), 4096),
    )
