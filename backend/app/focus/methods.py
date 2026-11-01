"""Métodos de estudo criados pelo aluno ("Revisão de programação": 40/10, 3 ciclos).

Cada método é um plano da técnica `custom` com nome, ligado à conta. Excluir
um método não apaga o histórico: cada sessão guarda uma cópia do plano e do
nome usados (`focus_sessions.plan`), então o histórico continua legível.
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass

from ..errors import AppError
from ..learning.db import Database, utcnow
from .plans import MIN, Plan, Technique, validate_plan

MAX_METHODS = 30
NAME_MAX = 40


class MethodNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "focus_method_not_found", "Método não encontrado.")


class MethodNameTaken(AppError):
    def __init__(self) -> None:
        super().__init__(409, "focus_method_name_taken", "Você já tem um método com este nome.", field="name")


class TooManyMethods(AppError):
    def __init__(self) -> None:
        super().__init__(422, "focus_method_limit", f"Você pode guardar até {MAX_METHODS} métodos.")


class InvalidMethodName(AppError):
    def __init__(self, message: str) -> None:
        super().__init__(422, "invalid_method_name", message, field="name")


@dataclass(frozen=True, slots=True)
class Method:
    id: str
    name: str
    plan: Plan
    created_at: str
    updated_at: str

    def to_dict(self) -> dict:
        p = self.plan
        return {
            "id": self.id,
            "name": self.name,
            "focus_minutes": (p.focus_seconds or 0) // MIN,
            "short_break_minutes": p.short_break_seconds // MIN,
            "long_break_minutes": p.long_break_seconds // MIN,
            "long_break_every": p.long_break_every,
            "cycles": p.cycles,
            "plan": p.to_dict(),
            "timeline": p.timeline(),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def clean_name(name: str) -> str:
    name = " ".join((name or "").split())
    if len(name) < 2:
        raise InvalidMethodName("Dê um nome com pelo menos 2 letras.")
    if len(name) > NAME_MAX:
        raise InvalidMethodName(f"Use até {NAME_MAX} caracteres.")
    return name


def build_plan(focus_minutes: int, short_break_minutes: int, long_break_minutes: int, long_break_every: int | None, cycles: int) -> Plan:
    return validate_plan(
        Plan(
            Technique.CUSTOM,
            focus_minutes * MIN,
            short_break_minutes * MIN,
            long_break_minutes * MIN,
            long_break_every,
            cycles,
        )
    )


def _method(row: sqlite3.Row) -> Method:
    plan = Plan(
        Technique.CUSTOM,
        row["focus_seconds"],
        row["short_break_seconds"],
        row["long_break_seconds"],
        row["long_break_every"],
        row["cycles"],
    )
    return Method(row["id"], row["name"], plan, row["created_at"], row["updated_at"])


class MethodStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    def list(self, user_id: str) -> list[Method]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM focus_methods WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at", (user_id,)
            ).fetchall()
        return [_method(r) for r in rows]

    def get(self, user_id: str, method_id: str) -> Method:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM focus_methods WHERE id = ? AND user_id = ? AND deleted_at IS NULL", (method_id, user_id)
            ).fetchone()
        if row is None:
            raise MethodNotFound()
        return _method(row)

    def create(self, user_id: str, name: str, plan: Plan) -> Method:
        name = clean_name(name)
        now = utcnow()
        with self.db.transaction() as conn:
            count = conn.execute(
                "SELECT COUNT(*) FROM focus_methods WHERE user_id = ? AND deleted_at IS NULL", (user_id,)
            ).fetchone()[0]
            if count >= MAX_METHODS:
                raise TooManyMethods()
            self._check_name(conn, user_id, name, None)
            method_id = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO focus_methods (id, user_id, name, focus_seconds, short_break_seconds, long_break_seconds, "
                "long_break_every, cycles, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (method_id, user_id, name, plan.focus_seconds, plan.short_break_seconds, plan.long_break_seconds,
                 plan.long_break_every, plan.cycles, now, now),
            )
            return _method(conn.execute("SELECT * FROM focus_methods WHERE id = ?", (method_id,)).fetchone())

    def update(self, user_id: str, method_id: str, name: str, plan: Plan) -> Method:
        name = clean_name(name)
        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT id FROM focus_methods WHERE id = ? AND user_id = ? AND deleted_at IS NULL", (method_id, user_id)
            ).fetchone()
            if row is None:
                raise MethodNotFound()
            self._check_name(conn, user_id, name, method_id)
            conn.execute(
                "UPDATE focus_methods SET name = ?, focus_seconds = ?, short_break_seconds = ?, long_break_seconds = ?, "
                "long_break_every = ?, cycles = ?, updated_at = ? WHERE id = ?",
                (name, plan.focus_seconds, plan.short_break_seconds, plan.long_break_seconds, plan.long_break_every,
                 plan.cycles, utcnow(), method_id),
            )
            return _method(conn.execute("SELECT * FROM focus_methods WHERE id = ?", (method_id,)).fetchone())

    def delete(self, user_id: str, method_id: str) -> None:
        with self.db.connect() as conn:
            cursor = conn.execute(
                "UPDATE focus_methods SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
                (utcnow(), method_id, user_id),
            )
        if cursor.rowcount == 0:
            raise MethodNotFound()

    @staticmethod
    def _check_name(conn: sqlite3.Connection, user_id: str, name: str, exclude: str | None) -> None:
        row = conn.execute(
            "SELECT id FROM focus_methods WHERE user_id = ? AND deleted_at IS NULL AND lower(name) = lower(?) AND id != ?",
            (user_id, name, exclude or ""),
        ).fetchone()
        if row:
            raise MethodNameTaken()
