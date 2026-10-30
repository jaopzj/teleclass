"""Contrato dos interpretadores de sumário."""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Protocol, Sequence

from .models import Outline, OutlineSource


class SignalStrength(IntEnum):
    NONE = 0
    WEAK = 1  # pode ser continuação de um sumário (ex.: só uma linha de referências)
    STRONG = 2  # parece, por si só, um sumário


@dataclass(frozen=True, slots=True)
class Signal:
    strength: SignalStrength
    headings: int = 0
    refs: int = 0

    @classmethod
    def none(cls) -> Signal:
        return cls(SignalStrength.NONE)


class OutlineParser(Protocol):
    """Um formato de sumário.

    `signal` avalia um texto isolado (usado para encontrar o sumário no canal);
    `parse` interpreta uma sequência de textos como um único sumário, sem
    reiniciar a hierarquia entre eles.
    """

    name: str

    def signal(self, text: str) -> Signal: ...

    def parse(self, sources: Sequence[OutlineSource]) -> Outline: ...
