"""Reconhecimento de identificadores de material (`#A001`, `#F12`, `#D001`...).

A regra padrão não assume nenhum prefixo específico: qualquer hashtag cujo
corpo contenha pelo menos um dígito é tratada como identificador. Hashtags
puramente textuais (`#java`, `#dica`) são ignoradas, porque costumam ser
categorias e não referências a uma mensagem.

A comparação é feita sem diferenciar maiúsculas de minúsculas, como no próprio
Telegram, mas o texto original é preservado para exibição.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

DEFAULT_REF_PATTERN = r"(?<![\w#])#(\w*\d\w*)"


@dataclass(frozen=True, slots=True)
class RefMatch:
    key: str  # forma normalizada, usada para comparar (ex.: "A001")
    raw: str  # como apareceu no texto, sem o "#" (ex.: "a001")
    start: int
    end: int


class RefExtractor:
    """Encontra identificadores em um texto segundo um padrão configurável.

    O padrão deve ter um grupo de captura com o corpo do identificador.
    """

    def __init__(self, pattern: str = DEFAULT_REF_PATTERN) -> None:
        self._regex = re.compile(pattern)

    @staticmethod
    def normalize(raw: str) -> str:
        return raw.upper()

    def find(self, text: str) -> list[RefMatch]:
        return [
            RefMatch(self.normalize(m.group(1)), m.group(1), m.start(), m.end())
            for m in self._regex.finditer(text or "")
        ]

    def keys(self, text: str) -> list[str]:
        """Identificadores normalizados, em ordem e sem repetição."""
        return list(dict.fromkeys(m.key for m in self.find(text)))

    def strip(self, text: str) -> str:
        """Remove os identificadores do texto e limpa espaços que sobrarem."""
        stripped = self._regex.sub("", text or "")
        return re.sub(r"[ \t]{2,}", " ", stripped).strip()
