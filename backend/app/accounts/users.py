"""Contas da plataforma: nome de usuário e senha (hash scrypt).

Separadas da conta do Telegram: entrar no Teleaula não toca no Telegram, e a
conta do Telegram vinculada fica em `telegram_accounts` (app.telegram.accounts).
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass

from ..errors import AppError
from ..learning.db import Database, utcnow
from .passwords import DUMMY_HASH, hash_password, needs_rehash, verify_password
from .validation import normalize_username, username_problem, validate_new_password, validate_username

# Antes das contas existirem, progresso e anotações eram gravados com este id.
LEGACY_USER_ID = "local"


@dataclass(frozen=True, slots=True)
class User:
    id: str
    username: str
    created_at: str

    def to_dict(self) -> dict:
        return {"id": self.id, "username": self.username, "created_at": self.created_at}


class UsernameTaken(AppError):
    def __init__(self) -> None:
        super().__init__(409, "username_taken", "Este nome de usuário já está em uso.", field="username")


class InvalidCredentials(AppError):
    def __init__(self) -> None:
        # Mesma mensagem para usuário inexistente e senha errada (evita enumeração).
        super().__init__(401, "invalid_credentials", "Usuário ou senha incorretos.")


class UserStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    def get(self, user_id: str) -> User | None:
        with self.db.connect() as conn:
            row = conn.execute("SELECT id, username, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
        return User(row["id"], row["username"], row["created_at"]) if row else None

    def count(self) -> int:
        with self.db.connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    def is_available(self, username: str) -> tuple[bool, str | None]:
        username = normalize_username(username)
        problem = username_problem(username)
        if problem:
            return False, problem
        with self.db.connect() as conn:
            taken = conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
        return (False, "Este nome de usuário já está em uso.") if taken else (True, None)

    def create(self, username: str, password: str) -> User:
        username = validate_username(username)
        validate_new_password(password, username)
        user = User(uuid.uuid4().hex, username, utcnow())
        password_hash = hash_password(password)
        try:
            with self.db.connect() as conn:
                first = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
                conn.execute(
                    "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
                    (user.id, user.username, password_hash, user.created_at),
                )
                if first:
                    # A primeira conta herda o progresso e as anotações de antes do login.
                    for table in ("lesson_progress", "lesson_notes"):
                        conn.execute(f"UPDATE {table} SET user_id = ? WHERE user_id = ?", (user.id, LEGACY_USER_ID))
        except sqlite3.IntegrityError as exc:
            raise UsernameTaken() from exc
        return user

    def authenticate(self, username: str, password: str) -> User:
        username = normalize_username(username)
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT id, username, created_at, password_hash FROM users WHERE username = ?", (username,)
            ).fetchone()
        if row is None:
            verify_password(password, DUMMY_HASH)
            raise InvalidCredentials()
        if not verify_password(password, row["password_hash"]):
            raise InvalidCredentials()
        with self.db.connect() as conn:
            conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (utcnow(), row["id"]))
            if needs_rehash(row["password_hash"]):
                conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), row["id"]))
        return User(row["id"], row["username"], row["created_at"])

    def check_password(self, user_id: str, password: str) -> bool:
        with self.db.connect() as conn:
            row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        return bool(row) and verify_password(password, row["password_hash"])
