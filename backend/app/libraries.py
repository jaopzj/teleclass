"""Biblioteca de cursos de cada usuário.

Cada usuário tem a própria pasta de snapshots (`data/snapshots/<id do usuário>/`)
e o próprio catálogo: um usuário nunca vê, abre ou assiste a cursos coletados
por outro. Progresso e anotações já são gravados por usuário no banco.
"""

from __future__ import annotations

import logging
import shutil
import threading
from pathlib import Path

from .courses import CourseCatalog
from .snapshots import SnapshotStore

log = logging.getLogger("teleaula")


class Libraries:
    def __init__(self, snapshots_dir: Path) -> None:
        self.root = snapshots_dir
        self._catalogs: dict[str, CourseCatalog] = {}
        self._lock = threading.Lock()

    def directory(self, user_id: str) -> Path:
        # Ids de usuário são hexadecimais (uuid4().hex): não escapam da pasta.
        if not user_id.isalnum():
            raise ValueError("id de usuário inválido")
        return self.root / user_id

    def store(self, user_id: str) -> SnapshotStore:
        return self.catalog(user_id).store

    def catalog(self, user_id: str) -> CourseCatalog:
        with self._lock:
            catalog = self._catalogs.get(user_id)
            if catalog is None:
                catalog = self._catalogs[user_id] = CourseCatalog(SnapshotStore(self.directory(user_id)))
            return catalog

    def adopt_legacy(self, user_id: str) -> int:
        """Move para o usuário os snapshots soltos em `data/snapshots/` (de antes das contas)."""
        if not self.root.is_dir():
            return 0
        legacy = [p for p in self.root.glob("*.json") if p.is_file()]
        if not legacy:
            return 0
        target = self.directory(user_id)
        target.mkdir(parents=True, exist_ok=True)
        for path in legacy:
            shutil.move(str(path), str(target / path.name))
        log.info("%d curso(s) de antes do login movidos para a primeira conta", len(legacy))
        return len(legacy)
