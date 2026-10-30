"""Hash de senhas com scrypt (biblioteca padrão, sem dependências extras).

Formato gravado: `scrypt$n$r$p$sal$hash` (sal e hash em base64). Os parâmetros
ficam no próprio valor, então podem ser aumentados no futuro sem invalidar as
senhas antigas (`needs_rehash`).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

N, R, P = 2**14, 8, 1
KEY_LENGTH = 64


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _derive(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=KEY_LENGTH, maxmem=64 * 1024 * 1024
    )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"scrypt${N}${R}${P}${_b64(salt)}${_b64(_derive(password, salt, N, R, P))}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, expected = stored.split("$")
        if scheme != "scrypt":
            return False
        actual = _derive(password, base64.b64decode(salt), int(n), int(r), int(p))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, base64.b64decode(expected))


def needs_rehash(stored: str) -> bool:
    return not stored.startswith(f"scrypt${N}${R}${P}$")


# Usado quando o usuário não existe, para o login levar o mesmo tempo nos dois casos
# (não revela pela demora quais nomes de usuário existem).
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
