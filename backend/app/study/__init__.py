"""Rastreamento do tempo de estudo e métricas do aluno.

- `sources`: origens de tempo (vídeo, temporizador) e a validação de cada uma;
- `ledger`: sessões, trechos, intervalos creditados e consolidado diário;
- `days`: fuso horário, dia local e divisão na meia-noite;
- `metrics`: definições das métricas e consolidação para a interface;
- `preferences`: fuso horário de cada pessoa.

Arquitetura e regras: docs/metricas-de-estudo.md.
"""

from .days import InvalidTimezone, load_timezone
from .ledger import SessionNotFound, StudyLedger
from .metrics import StudyMetrics
from .preferences import PreferencesStore
from .sources import SegmentClaim, SessionContext, StudySource

__all__ = [
    "InvalidTimezone",
    "PreferencesStore",
    "SegmentClaim",
    "SessionContext",
    "SessionNotFound",
    "StudyLedger",
    "StudyMetrics",
    "StudySource",
    "load_timezone",
]
