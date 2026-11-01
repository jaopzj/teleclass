"""Regras de nome de usuário, senha e telefone.

O frontend repete estas regras (frontend/src/auth/validation.ts) para avisar
antes do envio, mas a decisão é sempre do backend.
"""

from __future__ import annotations

import re
import unicodedata

from ..errors import AppError

USERNAME_MIN, USERNAME_MAX = 3, 32
PASSWORD_MIN, PASSWORD_MAX = 8, 128

_USERNAME = re.compile(r"^[a-z][a-z0-9_.]*$")
_PHONE = re.compile(r"^\+[1-9]\d{7,14}$")
RESERVED_USERNAMES = frozenset(
    {"admin", "administrador", "root", "system", "sistema", "api", "local", "teleaula", "telegram", "suporte", "support"}
)
# Senhas comuns demais para serem aceitas, mesmo com 8 caracteres ou mais.
COMMON_PASSWORDS = frozenset(
    {
        "12345678", "123456789", "1234567890", "password", "password1", "senha123", "senha1234",
        "qwerty123", "qwertyuiop", "11111111", "00000000", "abc12345", "iloveyou", "teleaula",
        "teleaula123", "admin123", "abcd1234", "87654321", "aaaaaaaa", "senhasenha",
    }
)


def normalize_username(value: str) -> str:
    return unicodedata.normalize("NFKC", value or "").strip().lower()


def username_problem(username: str) -> str | None:
    """Motivo pelo qual o nome não pode ser usado, ou None se o formato é válido."""
    if len(username) < USERNAME_MIN:
        return f"Use pelo menos {USERNAME_MIN} caracteres."
    if len(username) > USERNAME_MAX:
        return f"Use no máximo {USERNAME_MAX} caracteres."
    if not username[0].isascii() or not username[0].isalpha():
        return "Comece com uma letra."
    if not _USERNAME.match(username):
        return "Use apenas letras sem acento, números, ponto e sublinhado."
    if ".." in username or username.endswith("."):
        return "O ponto não pode se repetir nem ficar no fim."
    if username in RESERVED_USERNAMES:
        return "Este nome é reservado. Escolha outro."
    return None


def validate_username(value: str) -> str:
    username = normalize_username(value)
    problem = username_problem(username)
    if problem:
        raise AppError(422, "invalid_username", problem, field="username")
    return username


def validate_new_password(password: str, username: str) -> str:
    if len(password) < PASSWORD_MIN:
        raise AppError(422, "weak_password", f"A senha precisa ter pelo menos {PASSWORD_MIN} caracteres.", field="password")
    if len(password) > PASSWORD_MAX:
        raise AppError(422, "weak_password", f"A senha pode ter no máximo {PASSWORD_MAX} caracteres.", field="password")
    lowered = password.lower()
    if lowered in COMMON_PASSWORDS or len(set(password)) < 4:
        raise AppError(422, "weak_password", "Essa senha é fácil de adivinhar. Escolha outra.", field="password")
    if username and username in lowered:
        raise AppError(422, "weak_password", "A senha não pode conter o nome de usuário.", field="password")
    return password


def normalize_phone(value: str) -> str:
    """Formato internacional E.164: `+` seguido só de dígitos (ex.: +5511912345678)."""
    raw = (value or "").strip()
    digits = re.sub(r"\D", "", raw)
    if raw.startswith("00"):
        digits = digits[2:]
    phone = f"+{digits}"
    if not _PHONE.match(phone):
        raise AppError(
            422,
            "invalid_phone",
            "Número inválido. Informe o código do país, o DDD e o número.",
            field="phone",
        )
    return phone


def mask_phone(phone: str) -> str:
    """+5511912345678 -> +55 ••• ••• 5678 (o suficiente para a pessoa reconhecer)."""
    digits = phone.lstrip("+")
    return f"+{digits[:2]} ••• ••• {digits[-4:]}"
