"""Conta do Telegram vinculada a cada usuário da plataforma.

Um usuário tem no máximo uma conta do Telegram, e uma conta do Telegram (ou um
telefone) pertence a no máximo um usuário. O telefone não é guardado em texto:
fica só um HMAC (para detectar "telefone já vinculado") e uma versão mascarada
para exibir. A sessão do Telethon fica em `data/sessions/<usuário>.session`.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from ..accounts.validation import mask_phone
from ..learning.db import Database, utcnow


def load_secret(path: Path) -> bytes:
    """Chave local do servidor (criada na primeira execução, fica em data/)."""
    if path.is_file():
        data = path.read_bytes()
        if len(data) >= 32:
            return data
    path.parent.mkdir(parents=True, exist_ok=True)
    data = secrets.token_bytes(32)
    path.write_bytes(data)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return data


@dataclass(frozen=True, slots=True)
class LinkedAccount:
    user_id: str
    telegram_user_id: int
    phone_masked: str
    first_name: str | None
    last_name: str | None
    username: str | None
    linked_at: str

    @property
    def display_name(self) -> str:
        name = " ".join(part for part in (self.first_name, self.last_name) if part)
        return name or (f"@{self.username}" if self.username else "Conta do Telegram")

    def to_dict(self) -> dict:
        return {
            "name": self.display_name,
            "username": self.username,
            "phone": self.phone_masked,
            "linked_at": self.linked_at,
        }


class TelegramAccountConflict(Exception):
    """A conta do Telegram (ou o telefone) já pertence a outro usuário."""


class TelegramAccountStore:
    def __init__(self, db: Database, secret: bytes) -> None:
        self.db = db
        self._secret = secret

    def phone_hmac(self, phone: str) -> str:
        return hmac.new(self._secret, phone.encode(), hashlib.sha256).hexdigest()

    def get(self, user_id: str) -> LinkedAccount | None:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM telegram_accounts WHERE user_id = ?", (user_id,)).fetchone()
        return _account(row) if row else None

    def owner_of_phone(self, phone: str) -> str | None:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT user_id FROM telegram_accounts WHERE phone_hmac = ?", (self.phone_hmac(phone),)
            ).fetchone()
        return row["user_id"] if row else None

    def owner_of_telegram_user(self, telegram_user_id: int) -> str | None:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT user_id FROM telegram_accounts WHERE telegram_user_id = ?", (telegram_user_id,)
            ).fetchone()
        return row["user_id"] if row else None

    def link(self, user_id: str, phone: str, me) -> LinkedAccount:
        """Grava (ou substitui) o vínculo. `me` é o usuário devolvido pelo Telethon."""
        values = (
            user_id,
            int(me.id),
            self.phone_hmac(phone),
            mask_phone(phone),
            getattr(me, "first_name", None),
            getattr(me, "last_name", None),
            getattr(me, "username", None),
            utcnow(),
        )
        try:
            with self.db.connect() as conn:
                conn.execute("DELETE FROM telegram_accounts WHERE user_id = ?", (user_id,))
                conn.execute(
                    "INSERT INTO telegram_accounts (user_id, telegram_user_id, phone_hmac, phone_masked, "
                    "first_name, last_name, username, linked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    values,
                )
        except sqlite3.IntegrityError as exc:
            raise TelegramAccountConflict() from exc
        account = self.get(user_id)
        assert account is not None
        return account

    def unlink(self, user_id: str) -> None:
        with self.db.connect() as conn:
            conn.execute("DELETE FROM telegram_accounts WHERE user_id = ?", (user_id,))


def _account(row) -> LinkedAccount:
    return LinkedAccount(
        user_id=row["user_id"],
        telegram_user_id=row["telegram_user_id"],
        phone_masked=row["phone_masked"],
        first_name=row["first_name"],
        last_name=row["last_name"],
        username=row["username"],
        linked_at=row["linked_at"],
    )
