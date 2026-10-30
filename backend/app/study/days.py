"""Calendário do usuário: fuso horário, dia local e divisão de intervalos na meia-noite.

Todos os instantes são segundos desde a época (UTC, relógio do servidor). O dia
local de um instante depende do fuso configurado para a pessoa. Um intervalo que
atravessa a meia-noite é dividido em pedaços, um por dia local, inclusive em
dias com horário de verão (dias de 23 ou 25 horas, meia-noite inexistente).
"""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "UTC"
_TZ_NAME = re.compile(r"^[A-Za-z0-9_+\-]+(/[A-Za-z0-9_+\-]+){0,2}$")


class InvalidTimezone(ValueError):
    pass


def load_timezone(name: str) -> ZoneInfo:
    """Fuso IANA (ex.: "America/Sao_Paulo"). Recusa nomes fora do padrão e desconhecidos."""
    if not isinstance(name, str) or len(name) > 64 or not _TZ_NAME.match(name):
        raise InvalidTimezone(name)
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError) as exc:
        raise InvalidTimezone(name) from exc


def local_day(instant: float, tz: ZoneInfo) -> date:
    return datetime.fromtimestamp(instant, tz).date()


def day_start(day: date, tz: ZoneInfo) -> float:
    """Primeiro instante do dia local `day`.

    Se a meia-noite não existe (o relógio pula de 00:00 para 01:00), o resultado
    é o instante da virada, que já pertence ao novo dia.
    """
    return datetime.combine(day, time(0), tzinfo=tz).timestamp()


def split_by_day(start: float, end: float, tz: ZoneInfo) -> list[tuple[date, float, float]]:
    """Divide [start, end) em pedaços contidos num único dia local cada."""
    pieces: list[tuple[date, float, float]] = []
    cursor = start
    while cursor < end:
        day = local_day(cursor, tz)
        boundary = day_start(day + timedelta(days=1), tz)
        piece_end = min(end, boundary)
        if piece_end <= cursor:  # proteção contra fusos malformados: nunca entra em laço
            piece_end = end
        pieces.append((day, cursor, piece_end))
        cursor = piece_end
    return pieces


def week_start(day: date) -> date:
    """Semanas vão de segunda a domingo."""
    return day - timedelta(days=day.weekday())
