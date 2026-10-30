"""Camada de interpretação de sumários, independente do Telegram.

Recebe textos em ordem (`OutlineSource`) e devolve um `Outline`: uma árvore de
seções com referências. Novos formatos de sumário são novos `OutlineParser`s
registrados em `DEFAULT_PARSERS`; o resto do pipeline não muda.
"""

from .base import OutlineParser, Signal, SignalStrength
from .marker import MarkerOutlineParser
from .models import Outline, OutlineSource, RefEntry, Section

DEFAULT_PARSERS: tuple[OutlineParser, ...] = (MarkerOutlineParser(),)

__all__ = [
    "DEFAULT_PARSERS",
    "MarkerOutlineParser",
    "Outline",
    "OutlineParser",
    "OutlineSource",
    "RefEntry",
    "Section",
    "Signal",
    "SignalStrength",
]
