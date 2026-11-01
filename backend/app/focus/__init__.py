"""Temporizador de estudos: técnicas, sessões com estado no servidor, metas e gamificação.

- `plans`: técnicas prontas (Pomodoro, 52/17, Deep Work, personalizado, cronômetro) e o plano de etapas;
- `methods`: métodos de estudo criados pelo aluno;
- `engine`: sessões, transições derivadas de instantes do servidor, bloqueio de pausa;
- `rewards`: XP, níveis, títulos e conquistas;
- `goals`: metas diária e semanal;
- `stats`: histórico e estatísticas;
- `notices`: avisos e preferências de notificação.

Arquitetura e regras: docs/temporizador.md.
"""

from .engine import FocusService, Target
from .goals import GoalStore
from .methods import MethodStore
from .notices import NoticeStore
from .stats import FocusStats

__all__ = ["FocusService", "FocusStats", "GoalStore", "MethodStore", "NoticeStore", "Target"]
