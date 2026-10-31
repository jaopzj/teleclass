"""Avisos do temporizador e preferências de notificação.

Os avisos (`focus_notices`) são gravados na mesma transação que os gerou: fim
de um ciclo, fim da pausa, sessão encerrada, meta cumprida, conquista, novo
nível. Cada aba busca os avisos depois do último que viu (`after`), então um
aviso chega a todos os dispositivos e nunca se repete numa mesma aba.

As preferências dizem quais avisos aparecem e por qual meio (na tela, pelo
sistema operacional, som). O avisos de "a pausa está acabando" é calculado na
interface a partir de `phase_ends_at`, sem gravar nada.
"""

from __future__ import annotations

import json

from ..learning.db import Database, utcnow

NOTICE_KINDS = ("focus_completed", "break_ending", "break_completed", "session_ended", "goal_reached",
                "achievement_unlocked", "level_up")
DEFAULT_PREFERENCES = {
    "in_app": True,
    "system": False,  # notificação do navegador (pede permissão na interface)
    "sound": True,
    "kinds": {kind: True for kind in NOTICE_KINDS},
    "break_ending_seconds": 60,
}
MAX_NOTICES = 30


def merge_preferences(stored: dict | None) -> dict:
    prefs = json.loads(json.dumps(DEFAULT_PREFERENCES))
    if not stored:
        return prefs
    for key in ("in_app", "system", "sound"):
        if isinstance(stored.get(key), bool):
            prefs[key] = stored[key]
    if isinstance(stored.get("kinds"), dict):
        for kind in NOTICE_KINDS:
            if isinstance(stored["kinds"].get(kind), bool):
                prefs["kinds"][kind] = stored["kinds"][kind]
    seconds = stored.get("break_ending_seconds")
    if isinstance(seconds, int) and seconds in (0, 30, 60, 120):
        prefs["break_ending_seconds"] = seconds
    return prefs


class NoticeStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    def after(self, user_id: str, after: int | None) -> tuple[list[dict], int]:
        """Avisos depois de `after` e o cursor atual. Sem `after`, só o cursor (nada antigo é reexibido)."""
        with self.db.connect() as conn:
            cursor = conn.execute(
                "SELECT COALESCE(MAX(id), 0) FROM focus_notices WHERE user_id = ?", (user_id,)
            ).fetchone()[0]
            if after is None or after >= cursor:
                return [], cursor
            rows = conn.execute(
                "SELECT id, kind, payload, at FROM focus_notices WHERE user_id = ? AND id > ? ORDER BY id LIMIT ?",
                (user_id, after, MAX_NOTICES),
            ).fetchall()
        items = [{"id": r["id"], "kind": r["kind"], "at": r["at"], **json.loads(r["payload"])} for r in rows]
        return items, cursor

    def preferences(self, user_id: str) -> dict:
        with self.db.connect() as conn:
            row = conn.execute("SELECT data FROM focus_preferences WHERE user_id = ?", (user_id,)).fetchone()
        return merge_preferences(json.loads(row["data"]) if row else None)

    def set_preferences(self, user_id: str, data: dict) -> dict:
        prefs = merge_preferences({**self.preferences(user_id), **data})
        with self.db.connect() as conn:
            conn.execute(
                "INSERT INTO focus_preferences (user_id, data, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                (user_id, json.dumps(prefs), utcnow()),
            )
        return prefs
