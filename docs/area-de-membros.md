# Área de membros e player: arquitetura

Biblioteca de cursos, página do curso, player com retomada, anotações e
progresso. Implementa PLANO.md 4.7 a 4.9 sobre a indexação já existente.

## Como os vídeos chegam ao navegador

Os vídeos **não têm URL pública** e não são baixados para o disco. O snapshot
guarda só os metadados (id da mensagem, tamanho, MIME, duração, dimensões). No
curso-piloto, 362 das 363 aulas são `video/mp4` (H.264, 1280×720), que o
`<video>` nativo reproduz.

```
<video src="/api/courses/{curso}/media/{mensagem}">
   │  Range: bytes=START-END
   ▼
api/media.py ──▶ streaming/range.py (intervalo; pedidos abertos limitados a 16 MiB)
   │            streaming/streamer.py (blocos de 512 KiB alinhados, corta as pontas)
   ▼
telegram/media.py ──▶ client.iter_download(offset alinhado) ──▶ Telegram
```

- **Velocidade:** 4 blocos são baixados ao mesmo tempo à frente da posição
  pedida (cada pedido ao Telegram tem latência, e em sequência ela se soma).
  Os blocos ficam num cache em memória (`TELEAULA_STREAM_CACHE_MB`, padrão
  256), e um bloco já em download por outro pedido é aproveitado. Ao abrir um
  vídeo, o último bloco (onde muitos MP4 guardam o índice) já é buscado em
  segundo plano. Com 200 ms de latência simulada, os primeiros 4 MB caíram de
  1,75 s para 0,52 s, e voltar a um trecho já visto ficou instantâneo.
- Só mensagens que pertencem ao curso podem ser pedidas (`Course.has_media`).
- A mensagem fica em cache por 10 min. Se a referência do arquivo expirar no
  meio do download, ela é recarregada e o download continua do mesmo offset.
- Canais privados: o canal é encontrado pelo `channel_id` no cache da sessão;
  se não estiver lá, os diálogos são carregados uma vez.
- Respostas: `206` com `Content-Range`, `416` fora do arquivo, `410` se a
  mensagem foi apagada, `503 telegram_not_connected` sem login.
- Miniaturas: `/media/{mensagem}/thumb`, baixadas do Telegram sob demanda (no
  máximo 3 por vez) e guardadas em `data/thumbs/`.

## Modelo

Nada de cadastro paralelo: **cada snapshot é um curso**, e a estrutura vem de
`index_snapshot`, como na tela de indexação. `courses/catalog.py` só acrescenta:

| Conceito | Regra |
|---|---|
| Chave da aula | Identificador do sumário (`A001`) ou `msg-<id>` no fallback. Reindexar não muda a chave, então progresso e anotações continuam valendo. |
| Ordem | Linear, na ordem do sumário, atravessando módulos e subtópicos. Define aula anterior e próxima. |
| Tipo | `video`, `file` (só arquivos), `text` ou `unavailable` (no sumário, sem mensagem). |
| Vídeo principal | O primeiro material de vídeo da aula. |

O catálogo fica em memória e é recalculado quando o arquivo do snapshot muda.

## Progresso e anotações (`learning/`)

SQLite em `data/teleaula.db` (biblioteca padrão, migrações por `user_version`).
Tudo é chaveado por `(usuário, curso, chave da aula)`. Hoje o usuário é sempre
`local` (`TELEAULA_USER`); quando houver login, só `get_user_id` muda.

- **Posição e conclusão são independentes.** Salvar a posição nunca conclui a
  aula; marcar como concluída não depende da posição; uma não apaga a outra.
- **Percentual** = aulas do curso concluídas / aulas do curso. Registros de
  aulas que saíram do curso são ignorados; cada aula conta uma vez.
- **Onde continuar:** a última aula assistida se não estiver concluída; senão a
  próxima pendente depois dela; senão a primeira pendente.
- **Quando a posição é salva:** a cada 10 s tocando, ao pausar, ao terminar, ao
  esconder a aba, ao fechar a página e ao trocar de aula (`keepalive`).
- **Anotações:** um texto por aula. Salvamento automático ~1 s depois de parar
  de digitar (no máximo a cada 6 s), também ao sair do campo e com Ctrl+S.
  O texto fica no `localStorage` até o servidor confirmar. Cada gravação envia
  a revisão em que se baseou; se outra aba/dispositivo gravou antes, a API
  responde `409` com a versão atual e a tela pergunta qual manter.

## API

| Método | Rota | |
|---|---|---|
| GET | `/api/courses` | Biblioteca com progresso |
| GET | `/api/courses/{id}` | Curso com módulos, subtópicos, aulas e progresso |
| GET | `/api/courses/{id}/lessons/{chave}` | Aula, anterior/próxima e anotação |
| PUT | `…/lessons/{chave}/progress` | `{position_seconds, duration_seconds}` |
| PUT | `…/lessons/{chave}/completion` | `{completed}` |
| GET/PUT | `…/lessons/{chave}/notes` | `{body, base_revision}` |
| GET/HEAD | `/api/courses/{id}/media/{mensagem}` | Vídeo/arquivo com Range |
| GET | `/api/courses/{id}/media/{mensagem}/thumb` | Miniatura |

## Frontend

`router.tsx` (History API, sem dependência nova), `pages/` (biblioteca, curso,
aula), `components/` (`VideoPlayer` com botões e atalhos ← → / J L de 10 s, `NotesPanel`, capa, progresso, miniatura),
`hooks/useProgressSync` e `hooks/useNoteAutosave`. A tela de indexação continua
em `/indexacao`. O backend devolve o `index.html` para rotas do app, então
recarregar em `/cursos/...` funciona.

## Pontos de extensão

- Materiais complementares: a aula já expõe `materials` e a rota de mídia serve
  qualquer arquivo do curso (`?download=true`).
- Marcações de tempo nas anotações: nova coluna `at_seconds`/tabela de itens em
  `learning/notes.py`, sem mexer no player.
- Outros formatos: `LessonKind` e `_primary_video` decidem o que o player recebe.
- Cache de blocos em disco (PLANO.md, fase 3): trocar o `ChunkCache` em
  memória por um que grave em `data/cache/`.

## Limitações

- Vídeos fora de MP4/WebM (MKV, AVI, HEVC) mostram "formato não suportado".
- O cache é só em memória: reiniciar o servidor esvazia.
- Uma aula com vários vídeos reproduz só o primeiro.
