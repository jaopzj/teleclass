"""Identificação das mensagens que formam o sumário do curso.

A busca não depende de frases como "Clique aqui para ver o sumário": cada
mensagem de texto (sem mídia) é avaliada pelos interpretadores registrados, e
mensagens próximas com sinal de sumário são agrupadas em um bloco. Isso cobre
sumários divididos em várias mensagens por causa do limite de caracteres.

Regras do agrupamento (primeira versão, ajustar com dados reais):
- um bloco precisa de pelo menos uma mensagem com sinal forte;
- mensagens com sinal fraco (ex.: só uma linha `#A050 #A051`) entram apenas
  como continuação de um bloco;
- até `max_gap` mensagens de texto sem sinal podem ficar entre as partes;
  uma mensagem com mídia encerra o bloco;
- se houver mais de um bloco, vence o que tiver mais referências (empate: o
  mais recente, que costuma ser a versão atualizada). Os demais aparecem no
  relatório como candidatos descartados.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from .models import SourceMessage
from .outline import OutlineParser, OutlineSource, Signal, SignalStrength


@dataclass(slots=True)
class SummaryBlock:
    parser: OutlineParser
    messages: list[SourceMessage] = field(default_factory=list)
    signals: list[Signal] = field(default_factory=list)

    @property
    def message_ids(self) -> list[int]:
        return [m.id for m in self.messages]

    @property
    def ref_count(self) -> int:
        return sum(s.refs for s in self.signals)

    @property
    def has_strong(self) -> bool:
        return any(s.strength is SignalStrength.STRONG for s in self.signals)

    def sources(self) -> list[OutlineSource]:
        return [OutlineSource(str(m.id), m.text) for m in self.messages]


@dataclass(slots=True)
class SummaryDetection:
    chosen: SummaryBlock | None
    discarded: list[SummaryBlock] = field(default_factory=list)


def detect_summary(
    messages: Sequence[SourceMessage],
    parsers: Sequence[OutlineParser],
    *,
    max_gap: int = 2,
) -> SummaryDetection:
    blocks: list[SummaryBlock] = []
    for parser in parsers:
        blocks.extend(_blocks_for(parser, messages, max_gap))
    if not blocks:
        return SummaryDetection(chosen=None)
    ranked = sorted(blocks, key=lambda b: (b.ref_count, b.messages[0].id), reverse=True)
    return SummaryDetection(chosen=ranked[0], discarded=ranked[1:])


def _blocks_for(
    parser: OutlineParser, messages: Sequence[SourceMessage], max_gap: int
) -> list[SummaryBlock]:
    blocks: list[SummaryBlock] = []
    current: SummaryBlock | None = None
    gap = 0

    def close() -> None:
        nonlocal current
        if current and current.has_strong:
            blocks.append(current)
        current = None

    for message in messages:
        if message.has_media:
            close()
            continue
        signal = parser.signal(message.text)
        if signal.strength is SignalStrength.NONE:
            if current is not None:
                gap += 1
                if gap > max_gap:
                    close()
            continue
        if current is None:
            current = SummaryBlock(parser)
        elif not current.has_strong and signal.strength is SignalStrength.STRONG and gap:
            # Fragmento fraco solto antes de um sumário de verdade: recomeça.
            current = SummaryBlock(parser)
        current.messages.append(message)
        current.signals.append(signal)
        gap = 0
    close()
    return blocks
