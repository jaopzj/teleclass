"""Indexação de canais: do conjunto de mensagens até a estrutura do curso.

Etapas (cada uma em seu módulo, sem depender do Telegram):

1. `summary`   identifica as mensagens que formam o sumário;
2. `outline`   interpreta o texto do sumário (camada independente da fonte);
3. `resolver`  localiza no canal as mensagens de cada identificador;
4. `metadata`  extrai título, descrição e mídias de cada aula;
5. `builder`   monta a hierarquia final (ou o fallback cronológico);
6. `report`    gera o relatório de inspeção.

`pipeline.index_snapshot` encadeia tudo.
"""
