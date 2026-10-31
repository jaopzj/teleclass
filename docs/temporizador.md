# Temporizador de estudos

A página **Foco** (`/foco`) reúne o temporizador, as metas, a progressão
(XP, níveis e conquistas), o histórico e as estatísticas. Um widget flutuante
acompanha a sessão em todas as páginas.

## Princípio: o servidor guarda instantes, não conta segundos

Nenhum relógio roda no servidor e o navegador não é a fonte da verdade. Cada
sessão guarda instantes (`phase_started_at`, `phase_ends_at`, `paused_at`,
`run_started_at`). Em toda leitura ou escrita, `FocusService` avança a sessão
até "agora" a partir desses instantes: se a concentração terminou às 10:25 e o
pedido chega às 10:40, o servidor registra a pausa que começou às 10:25 e,
se ela já acabou, o estado "pronto para o próximo ciclo".

Por isso o temporizador sobrevive a recarregar a página, trocar de página,
fechar o navegador e trocar de aparelho: qualquer cliente que pergunte recebe o
mesmo estado. O navegador só desenha a contagem com base em `deadline_at` e na
diferença entre o seu relógio e o do servidor (medida na resposta mais rápida),
então mudar o relógio do computador não altera nada.

## Técnicas

| Técnica | Foco | Pausa | Pausa longa | Ciclos |
|---|---|---|---|---|
| Pomodoro | 25 min | 5 min | 15 min a cada 4 | 4 (1 a 12) |
| 52/17 | 52 min | 17 min | — | 3 |
| Deep Work | 60, 90 ou 120 min | 20 min | — | 1 |
| Personalizado | 5 a 180 min | 0 a 60 min | 0 a 60 min | 1 a 12 |
| Cronômetro livre | sem duração (até 4 h) | — | — | — |

Métodos próprios (até 30 por conta, nome único) guardam um plano
personalizado. Apagar um método não apaga o histórico das sessões que o usaram.

## Regras de tempo

- **Tempo de foco**: só as fases de concentração rodando. É o único tempo que
  conta para metas, XP, estatísticas e o painel "Seu estudo".
- **Tempo pausado**: o botão Pausar congela a fase. Não conta como foco.
- **Tempo de pausa** (descanso): fica no histórico, mas não conta como estudo.
- **Tempo total**: do início ao fim da sessão.
- **Uma sessão ativa por conta** (índice único no banco). Começar outra em
  outro aparelho devolve a sessão que já existe.
- **Sessões abandonadas**: pausada por mais de 45 min, ou parada em "pronto
  para o próximo ciclo" por mais de 30 min, a sessão encerra sozinha como
  "expirada". O foco já feito continua registrado.
- **Sem contagem dupla**: o foco é gravado no mesmo livro-razão de intervalos
  do player (`StudyLedger`). Um minuto com vídeo tocando e o temporizador
  rodando entra uma vez só no painel "Seu estudo".
- **Virada do dia**: o foco é dividido pelo fuso da conta.

## Pausas guiadas e bloqueio

Durante uma pausa agendada, a plataforma mostra a tela de descanso
(respiração, água, alongamento, olhos, contagem e próxima etapa) em todos os
aparelhos da conta, e o servidor recusa o vídeo das aulas com `423
focus_break_lock`. O bloqueio vale só dentro do Teleaula: o navegador não
consegue controlar outros apps, e a tela não promete isso.

"Preciso voltar agora" pede confirmação. Ao confirmar, a pausa acaba, a
plataforma é liberada e **o ciclo que terminou antes dessa pausa fica
invalidado**: ele não conta como ciclo concluído nem dá XP de ciclo. O tempo de
foco já feito, os ciclos anteriores e o XP já ganho continuam valendo.

Um ciclo só é validado quando a pausa seguinte é cumprida (ou, no último ciclo
sem pausa, quando a concentração termina).

## Gamificação

Todo XP é decidido no servidor e gravado em `xp_events` com uma referência
única (`UNIQUE(user_id, ref)`), então repetir um pedido nunca soma duas vezes.

| Origem | XP | Limite |
|---|---|---|
| Foco | 1 por minuto inteiro de concentração | 480 por dia (8 h) |
| Ciclo validado (≥ 15 min de foco) | 10 | 16 ciclos por dia |
| Sessão concluída (≥ 25 min de foco) | 25 | — |
| Meta diária batida | 30 | 1 por dia |
| Meta semanal batida | 100 | 1 por semana |
| Conquista | 20 a 500 conforme a raridade | 1 vez cada |

O teto diário existe para não premiar maratonas: depois de 8 h no dia, o tempo
continua nas estatísticas, mas não rende mais XP.

Níveis: `xp_para_nível(L) = round(60 × (L−1)^1,8 / 10) × 10`. Títulos:
Treineiro (1), Novato (3), Aprendiz (5), Dedicado (8), Discípulo (11),
Estudioso (14), Especialista (17), Veterano (20), Mentor (24), Mestre (28).

As 18 conquistas têm critérios objetivos (sessões concluídas, ciclos Pomodoro,
sessões de Deep Work, sequência de dias, horas de foco, metas batidas etc.),
raridade (comum, incomum, rara, épica, lendária) e mostram o progresso quando
ainda estão bloqueadas.

## Metas

Meta diária (15 min a 12 h) e semanal (1 a 80 h) de tempo de foco. O
progresso aparece em tempo real no temporizador, e bater a meta gera um aviso e
XP uma vez por período.

## Notificações

O servidor grava avisos em `focus_notices` (ciclo concluído, pausa encerrada,
sessão concluída, meta batida, conquista, nível). O cliente busca os avisos
novos junto com o estado e guarda um cursor, para não repetir um aviso já
mostrado. O aviso "a pausa termina em X s" é gerado no navegador a partir do
`deadline_at`. Em **Ajustes**, cada tipo pode ser desligado, e há opções para
avisos na tela, notificações do sistema (pede permissão ao navegador) e som.

## Proteção contra pedidos repetidos e concorrência

- Todo pedido que muda estado leva um `request_id`. Repetir o mesmo pedido
  (por exemplo, depois de uma queda de conexão) devolve a mesma resposta sem
  aplicar duas vezes.
- As ações levam a `version` da sessão. Se outro aparelho mudou a sessão antes,
  a resposta é `409 focus_conflict` com o estado atual, e a tela se atualiza.
- As escritas usam `BEGIN IMMEDIATE`, então dois pedidos simultâneos são
  aplicados um depois do outro.

## API (`/api/focus`)

| Método | Rota | Uso |
|---|---|---|
| GET | `/catalog` | técnicas, métodos, limites |
| GET | `/state?after=` | sessão ativa, avisos novos, resumo do dia |
| POST | `/sessions` | começar (técnica, método, curso/aula, objetivo) |
| POST | `/sessions/{id}/actions` | `pause`, `resume`, `start_next`, `unlock_break`, `stop` |
| GET/POST/PUT/DELETE | `/methods` | métodos próprios |
| GET | `/progress` | XP, nível, conquistas |
| GET/PUT | `/goals` | metas |
| GET | `/history`, `/history/{id}` | histórico paginado e detalhe |
| GET | `/stats?range=` | estatísticas (`7d`, `30d`, `90d`, `365d`, `all`) |
| GET/PUT | `/preferences` | avisos |

## Sons ambientes

Chuva, floresta, café, ondas, lareira, ruído branco e ruído marrom são gerados
no navegador com Web Audio. Não há arquivos de áudio, então não há licença de
terceiros a respeitar.

## Limitações conhecidas

- O bloqueio de pausa vale só no Teleaula. Outros sites e apps continuam livres.
- Notificações do sistema dependem da permissão do navegador e de a aba estar
  aberta. Não há push com o navegador fechado.
- Com o navegador fechado, a sessão avança no servidor, mas o aviso sonoro só
  toca quando alguém abre o app de novo.
- Integração com cursos usa a biblioteca do próprio usuário. Se um snapshot for
  apagado, as sessões antigas mantêm o nome gravado.
