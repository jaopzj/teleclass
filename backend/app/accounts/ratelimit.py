"""Limite de tentativas em memória, por chave (ex.: IP + rota, usuário + ação).

Suficiente para um servidor de um processo só. Cada chave guarda os instantes
das últimas tentativas dentro da janela.
"""

from __future__ import annotations

import math
import time
from collections import deque

from ..errors import AppError


class RateLimiter:
    def __init__(self, clock=time.monotonic) -> None:
        self._hits: dict[str, deque[float]] = {}
        self._clock = clock

    def _window(self, key: str, window: float) -> deque[float]:
        now = self._clock()
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= window:
            hits.popleft()
        return hits

    def retry_after(self, key: str, limit: int, window: float) -> int:
        """Segundos até poder tentar de novo (0 = pode agora)."""
        hits = self._window(key, window)
        if len(hits) < limit:
            return 0
        return max(1, math.ceil(window - (self._clock() - hits[0])))

    def check(self, key: str, limit: int, window: float, message: str | None = None) -> None:
        wait = self.retry_after(key, limit, window)
        if wait:
            raise AppError(
                429,
                "rate_limited",
                message or f"Muitas tentativas. Tente de novo em {format_wait(wait)}.",
                retry_after=wait,
            )

    def record(self, key: str) -> None:
        self._hits.setdefault(key, deque()).append(self._clock())

    def hit(self, key: str, limit: int, window: float, message: str | None = None) -> None:
        """Confere e já conta a tentativa."""
        self.check(key, limit, window, message)
        self.record(key)

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)

    def sweep(self, max_window: float) -> None:
        for key in list(self._hits):
            if not self._window(key, max_window):
                del self._hits[key]


def format_wait(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} segundos" if seconds != 1 else "1 segundo"
    minutes = math.ceil(seconds / 60)
    if minutes < 60:
        return f"{minutes} minutos" if minutes != 1 else "1 minuto"
    hours = math.ceil(minutes / 60)
    return f"{hours} horas" if hours != 1 else "1 hora"
