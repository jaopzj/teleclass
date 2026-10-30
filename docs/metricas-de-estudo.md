# Métricas de estudo: arquitetura e regras

O painel **Seu estudo** (tela inicial, acima dos cursos) mostra seis
indicadores. Todos são calculados no servidor a partir de registros reais de
reprodução e do progresso das aulas que já existia. O front-end só captura
eventos do player e apresenta números prontos.

## Visão geral

```
<video> ──eventos──▶ PlaybackTracker ──trechos──▶ StudyRecorder ──▶ fila (localStorage)
 (player)            study/tracker.ts             study/recorder.ts    study/queue.ts
                                                                          │ POST
                                                                          ▼
                       /api/study/sessions, /api/study/sessions/{id}/segments  (api/study.py)
                                                                          │
                     validação geral + regra da origem ──▶ StudyLedger (study/ledger.py)
                     (study/sources.py)                    study_sessions, study_segments,
                                                           study_intervals, study_daily
                                                                          │
 lesson_progress (conclusão, já existia) ──┐                              ▼
 catálogo de cursos (snapshots) ───────────┴──▶ StudyMetrics (study/metrics.py) ──▶ GET /api/study/metrics
                                                                          │
                                         metricsStore.ts (cache + invalidação) ──▶ StudyOverview.tsx
```

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Captura | `frontend/src/study/tracker.ts` | Abre e fecha trechos de reprodução efetiva a partir dos eventos do `<video>`, com relógio monotônico. Não conhece rede nem métricas. |
| Sessão | `frontend/src/study/recorder.ts` | Abre a sessão no servidor no primeiro play, numera os trechos e converte para "ms desde a abertura". |
| Envio | `frontend/src/study/queue.ts` | Fila persistente, reenvio com espera crescente, `keepalive` ao fechar a página. |
| Validação | `backend/app/study/sources.py`, `ledger.py` | Regras gerais e por origem; nada do cliente é aceito sem conferência. |
| Persistência | `backend/app/study/ledger.py` | Livro-razão sem sobreposição por usuário e consolidado diário, numa transação. |
| Consolidação | `backend/app/study/metrics.py` | Definição única de cada métrica (funções puras, testadas sem banco). |
| Apresentação | `frontend/src/study/StudyOverview.tsx` | Só exibe. Cache e invalidação em `metricsStore.ts`. |

## Como o tempo é medido

### No navegador

Um trecho fica aberto **somente enquanto o vídeo está de fato tocando**: não
pausado, não terminado, sem salto em andamento, sem erro, com dados para tocar
(`readyState ≥ 3`) e com a posição avançando. O trecho fecha em:

- `pause`, `ended`, `error`, `emptied`, `abort`;
- `waiting` / `stalled` (buffering) e `seeking` (salto);
- troca de velocidade (`ratechange`): cada trecho tem uma velocidade só;
- posição parada por mais de 2,5 s sem nenhum evento (travamento silencioso,
  aba congelada pelo navegador): o trecho termina no **último avanço
  observado**, então o tempo parado nunca entra;
- salto sem evento de `seeking` (a posição pula para frente ou para trás);
- a cada 15 s, para enviar aos poucos (o trecho seguinte começa exatamente
  onde o anterior terminou).

O tempo é medido com `performance.now()`, que é monotônico: ajustar o relógio
do computador ou trocar o fuso não altera nada. Aba em segundo plano **com o
vídeo tocando** conta (aula ouvida); aba em segundo plano com o vídeo parado
não conta, porque não há trecho aberto.

### Velocidade de reprodução

Conta o **tempo cronológico**. Dez minutos de relógio em 2× são dez minutos
de estudo (e vinte de vídeo). O cliente envia a velocidade e as posições do
vídeo no início e no fim do trecho só para que o servidor confira a coerência.

### No servidor

1. **Sessão** (`POST /api/study/sessions`). O cliente gera um UUID e informa
   origem, curso e aula. O servidor confere que a aula existe na biblioteca da
   própria pessoa e tem vídeo, e grava `opened_at` com o **próprio relógio**.
   Repetir a abertura devolve a mesma sessão; um id de outra pessoa ou de outra
   aula responde 404, sem revelar nada.
2. **Trechos** (`POST /api/study/sessions/{id}/segments`, até 50 por pedido).
   Cada trecho traz `seq`, `start_ms` e `end_ms` (desde a abertura, relógio
   monotônico do cliente) e, para vídeo, `media_from`, `media_to` e `rate`.
3. **Ancoragem.** O intervalo real é `opened_at + end_ms` menos o tempo
   creditado. O cliente marca a origem dos tempos quando recebe a resposta da
   abertura, que é depois de `opened_at`; por isso um intervalo nunca fica
   adiantado em relação ao real. Trechos que terminariam no futuro são
   recusados.
4. **União.** Tempo que já foi creditado à pessoa no mesmo intervalo (outra
   aba, outro dispositivo, outra origem) é descontado. Os intervalos de um
   usuário em `study_intervals` nunca se sobrepõem: duas abas tocando juntas
   contam o tempo uma vez.
5. **Dia local.** Cada pedaço é dividido na meia-noite do fuso da pessoa e
   somado a `study_daily`.

Tudo numa transação `BEGIN IMMEDIATE`: pedidos simultâneos são serializados e
uma falha no meio não deixa nada pela metade.

### Validação (recusas e ajustes)

Cada trecho recebe `accepted`, `adjusted` (creditado em parte) ou `rejected`,
com o motivo. O resultado fica gravado em `study_segments` para auditoria.

| Regra | Motivo | Efeito |
|---|---|---|
| mesma sessão e `seq` já recebidos | `duplicate: true` | devolve a decisão original, não credita de novo |
| fim antes do início | `invalid_interval` | recusa |
| trecho maior que 300 s | `segment_too_long` | recusa |
| trecho depois de 12 h de sessão | `session_expired` | recusa (o cliente abre outra sessão antes disso) |
| termina no futuro (folga de 2 s) | `in_future` | recusa |
| enviado mais de 7 dias depois | `too_late` | recusa |
| sobrepõe outro trecho da mesma sessão | `overlap` | recusa |
| sobrepõe tempo já creditado (outra aba) | `overlap` | credita só a parte nova |
| velocidade fora de 0,25× a 4× | `invalid_rate` | recusa |
| posição negativa, voltando ou além da duração | `media_out_of_range` | recusa |
| vídeo não andou | `no_playback` | recusa |
| tempo declarado maior que avanço ÷ velocidade (+10% ou 1 s) | `media_mismatch` | credita só avanço ÷ velocidade |
| aula removida do curso depois da abertura | `lesson_unavailable` | recusa |

O usuário vem sempre do cookie de sessão, nunca do corpo do pedido. Limites
de pedidos: 60 aberturas e 120 envios por minuto por usuário.

### Falhas, recarregar e fechar o navegador

- Trechos ficam na fila do `localStorage` até o servidor responder. Recarregar
  a página, cair a conexão ou fechar o navegador não perde o que já foi
  medido: na próxima vez que o app abrir, a fila é enviada. Como o intervalo é
  ancorado na abertura da sessão, o tempo cai no dia em que aconteceu, mesmo
  enviado no dia seguinte.
- Ao ocultar a aba, fechar a página ou trocar de aula, o trecho em andamento é
  fechado e enviado com `keepalive`.
- Reenvios são inofensivos: `(sessão, seq)` é único.
- Recusas do servidor tiram o trecho da fila; erros passageiros (sem conexão,
  servidor fora, limite de pedidos) mantêm e tentam de novo (2 s a 60 s).
- Se a sessão não chegar a ser aberta (sem resposta do servidor), os trechos
  dela são descartados: sem origem confiável não há como ancorar o tempo. Em
  dúvida, o sistema deixa de contar em vez de contar errado.
- A fila guarda o usuário de cada trecho e só envia os do usuário logado.

## Definições das métricas

Constantes em `backend/app/study/metrics.py`.

| Indicador | Definição |
|---|---|
| **Hoje** | Soma dos intervalos creditados no dia local de hoje. |
| **Esta semana** | Soma de segunda-feira até hoje (semana de segunda a domingo). Comparação: mesmo intervalo de dias da semana anterior (seg até o mesmo dia da semana). |
| **Dia ativo** | Dia com **10 minutos** ou mais de estudo creditado (`ACTIVE_DAY_SECONDS`). Alguns segundos de vídeo não fazem um dia de estudo. |
| **Sequência** | Dias ativos consecutivos terminando hoje. Se hoje ainda não atingiu o mínimo, termina ontem: a sequência só quebra quando um dia **termina** sem o mínimo. O painel mostra também o recorde. |
| **Média diária** (principal) | Total dos últimos **7 dias completos** (ontem e os 6 anteriores) ÷ número desses dias. Hoje fica de fora por estar incompleto. Dias anteriores ao primeiro estudo não entram (quem começou há 3 dias tem a média sobre 3 dias). Sem nenhum dia completo, não há média ("—"). |
| Média por dia ativo | Mesma janela; soma dos dias ativos ÷ quantidade de dias ativos. Aparece como complemento quando há dias inativos na janela. |
| **Aulas concluídas** | Aulas com `completed = 1` em `lesson_progress` que existem hoje nos cursos da pessoa e são válidas. A chave `(usuário, curso, aula)` garante uma contagem por aula, mesmo concluída de novo ou em outro dispositivo. "Nesta semana" usa `completed_at` (primeira conclusão) no fuso da pessoa. |
| **Progresso geral** | Σ aulas concluídas ÷ Σ aulas válidas, somando todos os **cursos iniciados**. Cada aula pesa igual: um curso de 10 aulas com 9 concluídas e um de 90 com 1 dão 10%, não a média 45%. |

### Regras de progresso (valem para todas as telas)

Ficam em `backend/app/learning/summary.py` e são usadas pela biblioteca, pela
página do curso e pelas métricas:

- **Aula válida**: existe hoje no curso e não está indisponível (citada no
  sumário, mas sem mensagem no canal). Aulas só com arquivos ou texto são
  válidas, porque podem ser concluídas.
- **Curso iniciado**: tem aula assistida ou concluída.
- **Percentual**: arredondado para baixo e limitado a 0–100. Só mostra 100%
  com todas as aulas válidas concluídas.
- **Cursos sem aulas válidas** ficam fora do progresso geral
  (`without_lessons` informa quantos).
- **Mudanças no curso**: tudo é recalculado sobre a estrutura atual. Aulas
  novas aumentam o total; aulas removidas ou que ficaram indisponíveis deixam
  de contar (a conclusão continua gravada e volta a contar se a aula voltar).
  Como nenhum percentual é guardado, não há histórico inconsistente.

### Fuso horário

- Cada pessoa tem um fuso (`user_preferences.timezone`, nome IANA validado).
  Na primeira sessão de estudo, o fuso do navegador é gravado se ainda não
  houver um. O painel avisa quando o dispositivo está em outro fuso e oferece
  trocar.
- O dia local de cada intervalo é fixado **no momento do registro**, com o
  fuso em vigor (`study_intervals.local_day`). Trocar de fuso não reescreve o
  passado: o que foi estudado num dia continua naquele dia.
- Sessões que atravessam a meia-noite são divididas entre os dois dias,
  inclusive em dias de horário de verão (23 ou 25 horas, meia-noite
  inexistente).
- Instantes vêm do relógio do servidor; o relógio do dispositivo não entra.
- No Windows, os fusos vêm do pacote `tzdata` (dependência do projeto).

## Tabelas (migração 3)

| Tabela | Conteúdo |
|---|---|
| `user_preferences` | `user_id`, `timezone`, `updated_at`. |
| `study_sessions` | Uma por aula aberta e tocada: `id` (UUID do cliente), `user_id`, `source`, `course_id`, `lesson_key`, `opened_at` (relógio do servidor), `last_activity_at`, `credited_seconds`. |
| `study_segments` | Cada trecho relatado, aceito ou não: tempos e posições declarados, `claimed_seconds`, `credited_seconds`, `status`, `reason`, `received_at`. Chave `(session_id, seq)`: é o que torna o envio idempotente. |
| `study_intervals` | **Livro-razão**: intervalos creditados, sem sobreposição por usuário, já divididos por dia local, com a origem e o fuso usado. Fonte da verdade do tempo. |
| `study_daily` | Consolidado `(user_id, day, source) → seconds`, mantido na mesma transação. As métricas leem daqui. `StudyLedger.rebuild_daily()` refaz a partir do livro-razão. |

Apagar a conta apaga tudo em cascata.

## API

| Rota | Uso |
|---|---|
| `POST /api/study/sessions` | `{id, source, course_id, lesson_key, timezone?}` → sessão. |
| `POST /api/study/sessions/{id}/segments` | `{segments: [{seq, start_ms, end_ms, media_from, media_to, rate}]}` → `{session, results: [{seq, status, credited_seconds, reason, duplicate}]}`. |
| `GET /api/study/metrics` | Todas as métricas, com as regras usadas (`rules`) e o fuso. |
| `GET/PUT /api/study/preferences` | Fuso horário. `PUT` com fuso desconhecido → 422 `invalid_timezone`. |

## Atualização do painel

- `metricsStore.ts` guarda as métricas em memória. O painel recarrega ao abrir
  a tela inicial e ao voltar para a aba **somente** se algo mudou ou se o dado
  tem mais de 60 s.
- Marcam como desatualizado: trecho creditado pelo servidor, aula concluída ou
  desmarcada, troca de fuso.
- Ao terminar ou pausar uma aula, os trechos são enviados na hora; ao voltar
  para o início, o painel já mostra o tempo novo sem recarregar a página.

## Nova origem: temporizador

A estrutura já está pronta. Para ligar o temporizador:

1. Em `backend/app/study/sources.py`, `TimerPolicy.enabled = True` (a regra já
   existe: credita o tempo decorrido e recusa posições de vídeo).
2. Em `api/study.py`, aceitar a abertura com `source: "timer"` (já aceita;
   hoje responde `study_source_unavailable`).
3. No front-end, um "tracker" do temporizador que emite `PlaybackSegment` sem
   posições de vídeo e usa o mesmo `StudyRecorder`/fila (o recorder precisa só
   aceitar a origem como parâmetro).

Os limites gerais (sem futuro, sem sobreposição, trecho máximo, idempotência)
valem sem mudança, e o tempo do temporizador soma no mesmo livro-razão. Tempo
de vídeo e de temporizador simultâneos contam uma vez. A origem fica gravada em
cada intervalo e em `total.by_source`.

## Limitações conhecidas

- O servidor limita o tempo creditado ao tempo real decorrido, ao avanço do
  vídeo e à duração da aula, e nunca conta duas vezes o mesmo instante. Mas
  não consegue provar que um vídeo foi assistido: um cliente modificado
  poderia declarar reprodução plausível dentro desses limites. Para uma
  plataforma pessoal, rodando em `127.0.0.1`, isso é aceitável.
- Tempo tocado antes da resposta da abertura da sessão (normalmente menos de
  um segundo, no primeiro play) não é contado.
- Trechos de uma sessão cuja abertura nunca foi confirmada são descartados.
- Se o navegador bloquear o `localStorage` (modo privado), a fila fica só em
  memória: fechar o navegador antes do envio perde os últimos segundos.
- Tempo estudado antes desta versão não existe: as métricas de tempo começam
  a partir da atualização. Aulas concluídas e progresso usam o histórico que
  já existia.
