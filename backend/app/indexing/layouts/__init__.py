"""Layouts de canal e a escolha automática entre eles.

A escolha é conservadora: um layout específico só é usado quando a detecção
dele é aceita; caso contrário vale o layout original (`tagged_summary`), que é
o comportamento de sempre. Assim, um layout novo nunca muda canais antigos.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Sequence

from ..models import ChannelSnapshot
from .base import ChannelLayout, LayoutMatch
from .module_menu import ModuleMenuLayout
from .tagged_summary import TaggedSummaryLayout

if TYPE_CHECKING:
    from ..pipeline import IndexingOptions

DEFAULT_LAYOUT = TaggedSummaryLayout()
# Layouts específicos, em ordem de preferência no empate. O padrão fica de fora: é o último recurso.
SPECIFIC_LAYOUTS: tuple[ChannelLayout, ...] = (ModuleMenuLayout(),)


class UnknownLayout(ValueError):
    pass


def layout_names() -> list[str]:
    return [DEFAULT_LAYOUT.name, *(layout.name for layout in SPECIFIC_LAYOUTS)]


def select_layout(
    snapshot: ChannelSnapshot,
    options: IndexingOptions,
    layouts: Sequence[ChannelLayout] = SPECIFIC_LAYOUTS,
) -> tuple[ChannelLayout, list[dict[str, Any]]]:
    """Escolhe o layout e devolve também a avaliação de cada candidato."""
    by_name = {layout.name: layout for layout in (DEFAULT_LAYOUT, *layouts)}
    if options.layout:
        if options.layout not in by_name:
            raise UnknownLayout(f"Layout desconhecido: {options.layout}")
        return by_name[options.layout], [{"name": options.layout, "forced": True}]

    candidates: list[dict[str, Any]] = []
    best: tuple[ChannelLayout, LayoutMatch] | None = None
    for layout in layouts:
        match = layout.detect(snapshot)
        candidates.append(
            {"name": layout.name, "score": round(match.score, 3), "accepted": match.accepted,
             "evidence": match.evidence}
        )
        if match.accepted and (best is None or match.score > best[1].score):
            best = (layout, match)
    return (best[0] if best else DEFAULT_LAYOUT), candidates


__all__ = [
    "ChannelLayout",
    "DEFAULT_LAYOUT",
    "LayoutMatch",
    "ModuleMenuLayout",
    "SPECIFIC_LAYOUTS",
    "TaggedSummaryLayout",
    "UnknownLayout",
    "layout_names",
    "select_layout",
]
