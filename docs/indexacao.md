# Indexação de cursos: arquitetura do piloto

Implementa a seção 6 do PLANO.md: do histórico de um canal até a estrutura
de módulos, subtópicos e aulas, com um relatório que mostra o que não deu certo.

## Fluxo

```
Telegram ──▶ coleta ──▶ snapshot JSON ──▶ detecção do sumário ──▶ interpretação
(Telethon)   telegram/   data/snapshots/   indexing/summary.py     indexing/outline/
                                                                        │
     relatório ◀── montagem da hierarquia ◀── metadados ◀── resolução dos #ids
  indexing/report.py   indexing/builder.py   metadata.py    indexing/resolver.py
```

| Etapa | Módulo | Responsabilidade |
|---|---|---|
| Coleta | `app/telegram/collector.py` | Lê o canal (somente leitura) e converte cada mensagem em `SourceMessage`. É o único código que conhece o Telethon. |
| Snapshot | `app/indexing/storage.py`, `app/snapshots.py` | Grava as mensagens em JSON. Toda a indexação roda sobre o snapshot, sem novas requisições ao Telegram. |
| Detecção do sumário | `app/indexing/summary.py` | Pontua mensagens de texto e agrupa as partes de um sumário dividido em várias mensagens. |
| Interpretação | `app/indexing/outline/` | Transforma textos em uma árvore de seções com referências. Não conhece o Telegram. |
| Identificadores | `app/indexing/refs.py` | Reconhece `#A001`, `#F001`, `#D001`... (qualquer hashtag com dígito). |
| Resolução | `app/indexing/resolver.py` | Encontra as mensagens que contêm cada identificador e expande álbuns. |
| Metadados | `app/indexing/metadata.py` | Título, descrição (Markdown) e mídias de cada aula. |
| Montagem | `app/indexing/builder.py` | Monta a hierarquia na ordem do sumário, ou o fallback cronológico. |
| Inspeção | `app/indexing/report.py`, `render.py` | Não resolvidas, duplicadas, materiais fora do curso etc. |
| Orquestração | `app/indexing/pipeline.py` | `index_snapshot(snapshot)` encadeia tudo. |

## Decisões

- **Snapshot como fronteira.** A coleta grava um JSON e a indexação lê esse JSON.
  Assim as regras podem mudar e ser testadas com dados reais quantas vezes for
  preciso, sem repetir a leitura do canal (e sem risco de FloodWait).
- **Interpretação independente da fonte.** `outline` recebe `OutlineSource(id, texto)`
  e devolve `Outline`. Um novo formato de sumário é uma nova classe que segue
  `OutlineParser` (`signal` + `parse`) registrada em `DEFAULT_PARSERS`. A
  detecção escolhe automaticamente o formato com o melhor resultado.
- **Níveis genéricos.** O número de `=` define o nível. `=` é módulo, `==` é
  subtópico e `===` funcionaria sem mudanças. Uma seção pode ter aulas e
  subseções ao mesmo tempo.
- **Identificadores sem prefixo fixo.** Qualquer hashtag com pelo menos um dígito
  é uma referência; `#java` não é. A comparação ignora maiúsculas/minúsculas.
  O padrão é configurável (`RefExtractor(pattern)`).
- **Uma referência = uma aula.** Todas as mensagens que contêm o identificador
  entram como materiais da mesma aula (vídeo + PDF, por exemplo). Álbuns entram
  inteiros, mesmo que só o primeiro item tenha legenda.
- **Rastreabilidade.** Cada material registra *por que* foi associado
  (`tag`: contém o identificador; `album`: mesmo álbum, `via` a mensagem que o
  trouxe; `chronological`: fallback). Cada aula guarda a linha do sumário em que
  apareceu (`mensagem:linha`) e de onde veio o título (`title_source`).
- **Nada é descartado em silêncio.** Referências sem mensagem viram aulas
  "não resolvidas"; duplicatas no sumário ficam na primeira ocorrência e são
  listadas; mídias que não entraram no curso aparecem como "fora do curso".
- **Dependências.** Só o que o plano prevê: Telethon, FastAPI/Uvicorn e, no
  frontend, React + Vite. Sem banco por enquanto (ver próximos passos).

## Regras de detecção do sumário (v1)

- Só mensagens **sem mídia** são candidatas.
- Sinal **forte**: pelo menos um título `=` e uma referência, ou 3+ referências,
  com pelo menos metade das linhas sendo estruturais.
- Sinal **fraco** (ex.: só `#A050 #A051`): entra apenas como continuação.
- Até 2 mensagens de texto comum podem ficar entre as partes; uma mensagem com
  mídia encerra o bloco.
- Se houver mais de um bloco, vence o que tiver mais referências (empate: o
  mais recente). Os outros aparecem no relatório.

## Limitações conhecidas

- O sumário é identificado pela estrutura; mensagens como "Clique aqui para ver
  o sumário!" que apontam para o sumário por link não são seguidas.
- A correspondência é só pelo identificador na legenda. Canais que identificam
  aulas de outro jeito (nome do arquivo, número no título) caem no fallback.
- Título: legenda → nome do arquivo → rótulo do sumário → `Aula N`, como no
  plano. O rótulo escrito no sumário (`#F001 - Apostila`) só é usado quando não
  há legenda nem nome de arquivo. Vale reavaliar com dados reais.
- Uma mensagem de texto (sem mídia) que contenha um identificador também vira
  material. É o esperado para aulas que são só links, mas pode trazer avisos.
- A coleta pela API é síncrona: em canais muito grandes a requisição demora.
- O login no Telegram é feito pela linha de comando (`app.cli login`); o fluxo
  pelo navegador (PLANO.md, 4.3) ainda não existe.
- Nada é gravado em banco; o resultado é recalculado a cada consulta.

## Próximos passos sugeridos

1. Rodar com o curso piloto, guardar o snapshot e transformar os casos
   encontrados em testes (`backend/tests/fixtures/`).
2. Ajustar as regras de detecção e de título conforme os dados reais.
3. Persistir `telegram_messages`, `modules` e `lessons` (PLANO.md, seção 5),
   incluindo a tabela para subtópicos e a ligação aula → materiais.
4. Coleta em segundo plano com progresso e sincronização incremental (`min_id`).
5. Login pelo navegador e, depois, streaming e player.
