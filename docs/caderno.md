# Caderno Digital

O Caderno reúne dois tipos de anotação, guardados na mesma tabela `notes`:

- **Nota rápida** (`kind = quick`): escrita no painel da aula, presa a um curso,
  uma aula e (opcionalmente) a um instante do vídeo. Editor compacto: negrito,
  itálico, sublinhado, listas, títulos, links, destaques coloridos e marcas de
  tempo.
- **Documento** (`kind = page`): criado no Caderno (`/caderno`). Pode ficar em
  pastas, ser vinculado a um curso, módulo ou aula, e usa o editor completo
  (tabelas, imagens, anexos, código com destaque de sintaxe, fórmulas KaTeX,
  checklists, citações, avisos e referências `@` a cursos/módulos/aulas).

Converter uma nota rápida em documento só muda o `kind`: é a mesma linha, com
o mesmo id, histórico e vínculo, então nada é duplicado. Um documento sem curso
pode ser vinculado depois ("Vincular a uma aula").

As anotações por aula antigas (`lesson_notes`) são convertidas em notas rápidas
na primeira inicialização depois da migração 5 (`NotebookStore.import_legacy`).

## Conteúdo estruturado, não HTML

O editor (Tiptap/ProseMirror) envia o documento como JSON. O servidor
(`backend/app/notebook/document.py`) valida cada nó e marca contra uma lista
fechada, descarta atributos desconhecidos, aceita links só `http(s)`, `mailto`
ou caminhos internos, imagens só de `/api/notebook/files/<id>` e marcas de
tempo de 0 a 24 h. Notas rápidas recusam os blocos exclusivos do editor
completo. Do documento validado saem o texto puro (busca e trechos), a contagem
de palavras, as referências e os arquivos usados.

## Marcas de tempo e referências

- Ao criar uma nota rápida, o painel mostra o tempo atual do player e o
  "congela" no primeiro caractere digitado. O tempo pode ser editado ou
  removido depois; o servidor recusa valores além da duração da aula
  (`timestamp_out_of_range`).
- Clicar numa marca de tempo leva o player até ela. Se a aula não estiver
  aberta, navega para `/cursos/<curso>/aulas/<aula>?t=<segundos>`.
- Digitar `@` no editor completo busca cursos, módulos e aulas
  (`GET /api/notebook/targets`). Tab (ou ⏱) adiciona um tempo, validado contra
  a duração da aula. As referências ficam em `note_refs`; ao abrir a nota o
  servidor informa o estado de cada uma (`ok`, `missing_course`,
  `missing_target`, `out_of_range`), e o chip mostra quando o alvo sumiu.
- A página da aula lista as notas rápidas, os documentos vinculados à aula e os
  documentos que a citam (`GET /api/notebook/lessons/<curso>/<aula>`).

## Organização

Pastas com subpastas (até 8 níveis; o servidor recusa ciclos), favoritas,
fixadas, recentes (`opened_at`), etiquetas por usuário, arquivadas e lixeira.
Excluir uma pasta manda as notas dela e das subpastas para a lixeira; nada é
apagado de vez sem passar pela lixeira.

## Busca

FTS5 (`notes_fts`, `unicode61 remove_diacritics 2`), indexando título e texto.
Acentos são ignorados e cada termo vale como prefixo (`"termo"*`): "heranca" acha "herança" e "poli" acha "polimorfismo". Aspas buscam a frase exata. A busca
pode ser restrita a uma pasta (com subpastas), curso ou etiqueta. Os resultados
trazem título e trecho com os termos destacados; ao abrir um, o editor destaca
as ocorrências e posiciona o cursor na primeira (`?q=` na URL da nota).

## Salvamento, conflitos e histórico

- O editor salva ~1 s depois da última alteração e guarda um rascunho no
  `localStorage` antes de enviar. Sem rede, o status muda para "Sem conexão ·
  salvo neste aparelho" e o envio acontece quando a rede volta. Fechar a aba
  dispara um envio `keepalive`.
- Cada nota tem `revision`. O cliente manda a revisão que conhece; se outro
  aparelho salvou antes, o servidor responde 409 com a versão atual e a pessoa
  escolhe: manter a sua, usar a do servidor ou guardar a sua como cópia.
- Sem alterações locais, a nota aberta confere a revisão a cada 15 s e ao
  voltar o foco para a janela, e se atualiza sozinha.
- Versões: uma a cada ~10 min de edição, antes de sobrescrever num conflito e
  antes de restaurar uma versão antiga (até 100 por nota).

## Arquivos

`POST /api/notebook/files` (multipart). Imagens: PNG, JPEG, GIF ou WebP,
identificadas pelos bytes iniciais (SVG não é aceito), até 10 MB. Anexos: lista
de extensões permitidas (PDF, documentos, planilhas, texto, código, zip...), até
25 MB. Cota de 1 GB por usuário. Os arquivos ficam em
`data/notebook/<usuário>/<id>` e só o dono os baixa; a resposta usa
`nosniff`, `Content-Security-Policy: sandbox` e `attachment` para o que não é
imagem. Arquivos que nenhuma nota usa há mais de um dia são removidos pela
limpeza periódica.

## Isolamento

Todas as rotas exigem login e filtram por `user_id` em cada consulta. Uma nota,
pasta, etiqueta ou arquivo de outra pessoa responde 404, como se não existisse.
Referências e vínculos só aceitam cursos do catálogo do próprio usuário.
