# Minha Rotina

Planejamento do dia: rotinas reutilizáveis, atividades avulsas, timeline, agenda,
cronômetro por atividade e evolução. Página em `/rotina` (abas Meu dia, Agenda,
Minhas rotinas e Evolução). Código: `backend/app/routine/` (regras e banco),
`backend/app/api/routine.py` (API) e `frontend/src/routine/` (interface).

## Modelo

| Tabela | O que guarda |
| --- | --- |
| `routines` | Modelo: nome, ícone, cor, modalidade (por horário, por sequência, flexível), estado (ativa, pausada, arquivada) e exclusão lógica |
| `routine_schedules` | Dias da semana (segunda = 0), data de início e fuso |
| `routine_activities` | Atividades do modelo, na ordem da rotina |
| `routine_days` | Rotina aplicada a uma data (pela agenda ou à mão). É a chave que impede gerar duas vezes |
| `activity_occurrences` | A atividade de um dia: cópia dos campos do modelo, status, horário, tempo registrado |
| `activity_logs` | Histórico de mudanças de cada ocorrência |

Cada ocorrência é uma cópia. Mudar a rotina nunca reescreve o passado.

## Geração e mudanças no modelo

- As ocorrências são geradas de hoje até hoje + 42 dias, sob demanda, quando a
  agenda ou o dia são abertos. Datas passadas nunca são geradas, nem datas
  anteriores ao início da rotina. Reativar uma rotina pausada recomeça a partir de hoje.
- Uma ocorrência é **intocada** quando está pendente, não foi editada, não foi
  reagendada, não tem tempo manual e não teve cronômetro. O sistema só altera ou
  apaga ocorrências intocadas.
- Editar a rotina atualiza as ocorrências intocadas de hoje em diante.
- Tirar um dia da semana, pausar, arquivar ou excluir a rotina remove as
  ocorrências intocadas **a partir de amanhã**. Hoje e o passado ficam como estão.
- Excluir é lógico: o histórico e as estatísticas continuam.
- Atividades sem horário não ganham horário artificial (rotinas por sequência
  funcionam sem horário). Ficam em "Sem horário" e podem ser reordenadas arrastando.

## Aplicar rotina à mão e editar ocorrências

- Antes de aplicar, a prévia mostra atividades com o mesmo nome já no dia e
  horários que se sobrepõem. A pessoa escolhe pular as repetidas ou incluí-las.
  Um horário de início opcional desloca a rotina inteira.
- Desfazer a aplicação tira as ocorrências intocadas daquele dia.
- Editar uma ocorrência que veio de rotina pergunta o alcance: só este dia,
  este e os próximos, ou a rotina inteira.
- Conflitos de horário são avisados, nunca bloqueados. Horários que só se tocam
  (uma termina às 09:15, outra começa às 09:15) não conflitam. Puladas e
  canceladas não contam.

## Status, dias e cronômetro

- Status: pendente, em andamento, concluída, pulada (motivo opcional) e cancelada.
- **Só hoje pode ser concluído.** Dias que já passaram não aceitam conclusão
  (uma atividade concluída no dia continua concluída). Dias seguintes só podem
  ser editados, reagendados, cancelados ou removidos: nada de concluir, pular ou
  cronometrar. O servidor recusa com `409 activity_not_today`.
- Concluir pela timeline pergunta quanto tempo levou (ou "Concluir sem tempo").
  Se a atividade já tem tempo do Foco, conclui direto.
- **O cronômetro é o do Foco.** "Iniciar" numa atividade de hoje começa uma
  sessão do Foco (cronômetro livre), com o nome da atividade como objetivo e o
  curso ou aula vinculados. `POST /api/focus/sessions` aceita `activity_id`, e
  `focus_sessions.activity_id` guarda a ligação. O tempo de foco dessas sessões
  é o tempo da atividade: os mesmos dados de metas, XP e estatísticas do Foco.
- Pausar, retomar e parar valem tanto na timeline quanto no widget do Foco.
  Parar devolve a atividade para pendente com o tempo guardado. Concluir, pular,
  cancelar ou remover a atividade encerra a sessão do Foco dela.
- Uma sessão do Foco por vez. Se já houver uma rodando, a interface pergunta se
  deve parar (ou concluir a atividade dela) e iniciar a nova.

## Progresso e sequência

- O progresso do dia conta só as atividades obrigatórias. Opcionais aparecem à parte.
- **Progresso por tempo** (`time_progress`): tempo feito ÷ tempo planejado, nas
  atividades obrigatórias com duração. Cada atividade conta no máximo a própria
  duração, então passar do tempo em uma não esconde o que faltou em outra. Mostra
  se uma atividade ou rotina foi feita inteira, pela metade, 10%, 25% etc. Aparece
  na timeline, no resumo e na Evolução (por dia e por rotina).
- **Dia consistente** (decisão do produto, 2026-11-09): concluir pelo menos metade
  das atividades obrigatórias do dia, e no mínimo uma. Os valores ficam em
  `CONSISTENCY_MIN_RATIO` e `CONSISTENCY_MIN_COMPLETED` (`rules.py`).
- A sequência conta dias consistentes seguidos. Dias sem nada planejado não
  interrompem. O dia de hoje ainda aberto também não interrompe.
- Não há mensagens negativas quando a sequência acaba.

## API

Prefixo `/api/routine`, sessão obrigatória, limite de 240 pedidos por minuto.

| Rota | Uso |
| --- | --- |
| `GET/POST /routines`, `GET/PUT/DELETE /routines/{id}`, `POST /routines/{id}/status` | Rotinas |
| `GET /day/{dia}` | Ocorrências, resumo, conflitos, rotinas aplicadas, sequência e cronômetro |
| `GET /agenda?from&to` | Período de até 62 dias |
| `GET /stats?from&to` | Evolução (padrão: últimos 28 dias) |
| `POST /apply/preview`, `POST /apply`, `DELETE /apply/{rotina}/{dia}` | Aplicar e desfazer |
| `POST /occurrences`, `GET/PATCH/DELETE /occurrences/{id}` | Ocorrências |
| `POST /occurrences/{id}/status`, `/reschedule`, `POST /occurrences/reorder` | Status, reagendar, ordem |
| `POST /api/focus/sessions` com `activity_id` | Cronômetro (do Foco) |

## Interface

- Cores de rotina e atividade usam os tokens `--tone-*` de `ui/tokens.css`
  (céu, verde-água, verde, âmbar, coral, rosa, violeta, ardósia).
- Ícones: um conjunto de ícones Phosphor em 10 categorias, com busca em português.
- A faixa do dia (um segmento por atividade obrigatória) é o elemento de destaque
  do resumo.
- A especificação pede tema escuro, mas o app só tem o tema claro (veja
  [identidade-visual.md](identidade-visual.md)). A página segue o tema atual.

Testes: `backend/tests/test_routine.py` e `frontend/src/routine/domain.test.ts`.
