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
    # Aplicativo pessoal: há um único usuário local. O id existe para que progresso
    # e anotações já fiquem associados a um usuário quando houver login (PLANO.md, 9).
    user_id: str = "local"
    # Memória usada para guardar trechos de vídeo já baixados (MB).
    stream_cache_mb: int = 256

    @property
    def session_path(self) -> Path:
        # O Telethon acrescenta ".session". Esse arquivo equivale à senha da conta.
        return self.data_dir / "teleaula"

    @property
    def snapshots_dir(self) -> Path:
        return self.data_dir / "snapshots"

    @property
    def database_path(self) -> Path:
        return self.data_dir / "teleaula.db"

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
        user_id=os.environ.get("TELEAULA_USER", "").strip() or "local",
        stream_cache_mb=_int(os.environ.get("TELEAULA_STREAM_CACHE_MB"), 256),
    )
