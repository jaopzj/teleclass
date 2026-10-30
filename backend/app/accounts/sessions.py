"""Sessões de login da plataforma.

O navegador guarda um token aleatório num cookie HttpOnly; o banco guarda só o
SHA-256 dele. Quem lê o banco não consegue se passar pela pessoa, e o
JavaScript da página nunca vê o token.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from ..learning.db import Database, utcnow

SESSION_TTL = timedelta(days=30)
# A validade é renovada no uso, no máximo uma vez por hora (evita gravar a cada pedido).
RENEW_AFTER = timedelta(hours=1)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii", "ignore")).hexdigest()


class SessionStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    def create(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        now = utcnow()
        with self.db.connect() as conn:
            conn.execute(
                "INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (_hash(token), user_id, now, now, utcnow(SESSION_TTL)),
            )
        return token

    def resolve(self, token: str | None) -> str | None:
        """Id do usuário dono do token, ou None se o token não vale (ou expirou)."""
        if not token or len(token) > 128:
            return None
        key = _hash(token)
        now = utcnow()
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT user_id, last_seen_at, expires_at FROM auth_sessions WHERE token_hash = ?", (key,)
            ).fetchone()
            if row is None:
                return None
            if row["expires_at"] <= now:
                conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (key,))
                return None
            last_seen = datetime.fromisoformat(row["last_seen_at"])
            if datetime.fromisoformat(now) - last_seen > RENEW_AFTER:
                conn.execute(
                    "UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?",
                    (now, utcnow(SESSION_TTL), key),
                )
        return row["user_id"]

    def revoke(self, token: str | None) -> None:
        if token:
            with self.db.connect() as conn:
                conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (_hash(token),))

    def revoke_all(self, user_id: str) -> None:
        with self.db.connect() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))

    def purge_expired(self) -> None:
        with self.db.connect() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (utcnow(),))
