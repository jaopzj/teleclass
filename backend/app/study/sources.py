"""Origens de tempo de estudo e as regras de validação de cada uma.

Toda origem alimenta o mesmo livro-razão (`ledger.py`) e as mesmas métricas;
o que muda é o que o cliente precisa provar em cada trecho:

- `video`: reprodução de uma aula. O trecho informa o tempo decorrido
  (relógio monotônico do navegador), a posição do vídeo no início e no fim e a
  velocidade. O avanço do vídeo dividido pela velocidade limita o tempo
  creditado: não é possível declarar 15 s de estudo com 2 s de vídeo andando.
- `timer`: temporizador de estudo (ainda sem interface). O trecho informa só
  o tempo decorrido; fica desligado até a interface existir.

Para criar uma origem nova: uma classe com `validate_context` e `credit`,
registrada em `POLICIES`. Os registros existentes não mudam.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

# Velocidades aceitas (o player oferece de 0,5× a 2×; a margem cobre outros players).
MIN_RATE, MAX_RATE = 0.25, 4.0
# Folga para o avanço do vídeo: arredondamentos do `currentTime` e do relógio.
MEDIA_TOLERANCE_SECONDS = 1.0
MEDIA_TOLERANCE_RATIO = 0.10
# Posição final pode passar um pouco da duração do catálogo (metadados arredondados).
DURATION_SLACK_SECONDS = 3.0


class StudySource(StrEnum):
    VIDEO = "video"
    TIMER = "timer"


@dataclass(frozen=True, slots=True)
class SegmentClaim:
    """Um trecho contínuo de estudo, como o cliente o relata."""

    seq: int
    start_ms: int  # relativo à abertura da sessão, relógio monotônico do cliente
    end_ms: int
    media_from: float | None = None
    media_to: float | None = None
    rate: float | None = None

    @property
    def seconds(self) -> float:
        return (self.end_ms - self.start_ms) / 1000


@dataclass(frozen=True, slots=True)
class SessionContext:
    """O que a sessão estuda (validado no servidor ao abrir)."""

    course_id: str | None = None
    lesson_key: str | None = None
    media_duration: float | None = None  # duração do vídeo segundo o catálogo


@dataclass(frozen=True, slots=True)
class Credit:
    seconds: float  # 0 quando recusado
    reason: str | None = None  # por que foi recusado ou reduzido

    @property
    def rejected(self) -> bool:
        return self.seconds <= 0


class VideoPolicy:
    source = StudySource.VIDEO
    enabled = True

    def credit(self, claim: SegmentClaim, context: SessionContext) -> Credit:
        if claim.media_from is None or claim.media_to is None or claim.rate is None:
            return Credit(0, "missing_media")
        if not (MIN_RATE <= claim.rate <= MAX_RATE):
            return Credit(0, "invalid_rate")
        if claim.media_from < 0 or claim.media_to < claim.media_from:
            return Credit(0, "media_out_of_range")
        limit = context.media_duration
        if limit and claim.media_to > limit + DURATION_SLACK_SECONDS:
            return Credit(0, "media_out_of_range")
        advance = claim.media_to - claim.media_from
        if advance <= 0:
            return Credit(0, "no_playback")
        # Tempo cronológico que esse avanço exige na velocidade informada.
        # Em 2×, 20 min de vídeo correspondem a 10 min de estudo.
        expected = advance / claim.rate
        allowed = expected + max(MEDIA_TOLERANCE_SECONDS, expected * MEDIA_TOLERANCE_RATIO)
        if claim.seconds > allowed:
            return Credit(expected, "media_mismatch")
        return Credit(claim.seconds)


class TimerPolicy:
    """Temporizador de estudo: credita o tempo decorrido enquanto ativo.

    Desligado até a interface existir. Os limites gerais (trecho máximo, sem
    sobreposição, nada no futuro) já valem para ele pelo livro-razão.
    """

    source = StudySource.TIMER
    enabled = False

    def credit(self, claim: SegmentClaim, context: SessionContext) -> Credit:
        if claim.media_from is not None or claim.media_to is not None:
            return Credit(0, "unexpected_media")
        return Credit(claim.seconds)


POLICIES = {policy.source: policy for policy in (VideoPolicy(), TimerPolicy())}
