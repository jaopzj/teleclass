"""Layout original: sumário com identificadores (`#A001`) e mídias marcadas com eles.

É o padrão. A lógica continua em `pipeline.index_tagged_summary`, intocada; este
módulo só a expõe como um layout.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ..models import ChannelSnapshot
from .base import LayoutMatch

if TYPE_CHECKING:
    from ..pipeline import IndexingOptions, IndexingResult


class TaggedSummaryLayout:
    name = "tagged_summary"

    def detect(self, snapshot: ChannelSnapshot) -> LayoutMatch:
        # Sempre aplicável: é o que funciona para qualquer canal, inclusive sem sumário.
        return LayoutMatch(0.0, True, {"default": True})

    def index(self, snapshot: ChannelSnapshot, options: IndexingOptions) -> IndexingResult:
        from ..pipeline import index_tagged_summary

        return index_tagged_summary(snapshot, options)
