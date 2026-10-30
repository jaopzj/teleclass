# Teleaula — Plano do Projeto

> Plataforma pessoal para assistir cursos indexados em canais do Telegram com experiência de área de membros (estilo Hotmart): lista de módulos e aulas, player próprio e progresso salvo.

---

## 1. Visão geral

### 1.1 Problema
Professores costumam organizar cursos gratuitos em canais do Telegram. O app do Telegram não foi feito para isso:
- não mostra quais vídeos já foram assistidos;
- não permite marcar aulas como concluídas;
- não retoma o vídeo de onde você parou entre sessões e dispositivos;
- não organiza o conteúdo em módulos e aulas.

### 1.2 Solução
Um app que roda **localmente** no computador do usuário, se conecta ao Telegram usando a **conta do próprio usuário** (API de cliente / MTProto), indexa os vídeos de um canal a partir do link e os exibe numa interface de curso, com streaming direto do Telegram e progresso salvo num banco local.

### 1.3 Objetivos
- Colar o link de um canal e ter o curso montado automaticamente.
- Assistir os vídeos dentro do app, sem abrir o Telegram.
- Salvar progresso por aula (posição em segundos, concluída ou não) e por curso (%).
- "Continuar de onde parei" na tela inicial.
- Anotações por aula.
- Acesso opcional pelo celular na mesma rede Wi-Fi.

### 1.4 Fora do escopo (por enquanto)
- Versão pública/multiusuário hospedada na internet.
- Re-hospedagem ou redistribuição dos vídeos.
- Download em massa dos cursos.
- Aplicativo mobile nativo.

---

## 2. Experiência do usuário (fluxo)

### 2.1 Primeira execução
1. O usuário roda o app (`teleaula` ou `docker compose up`) e abre `http://localhost:8000`.
2. Tela **Conectar ao Telegram**: informa o número de telefone.
3. O Telegram envia um código ao app do celular; o usuário digita o código.
4. Se a conta tiver verificação em duas etapas, informa a senha.
5. A sessão é salva localmente. Nas próximas execuções, o app já abre logado.

### 2.2 Adicionar um curso
1. Botão **Adicionar curso** → cola `https://t.me/nomedocanal` (ou link de convite `t.me/+abc...`, ou link de uma mensagem).
2. O backend resolve o canal, lê o histórico e encontra as mensagens com vídeo.
3. O app propõe a estrutura (módulos e aulas) usando as regras da seção 6.
4. O usuário confirma ou ajusta (renomear, reordenar, mover aula de módulo, ocultar).
5. O curso aparece em **Meus cursos**.

### 2.3 Assistir
1. Abre o curso → vê módulos, aulas, duração, status (não iniciada / em andamento / concluída).
2. Clica na aula → o player abre na posição salva.
3. O progresso é salvo automaticamente; a aula é marcada como concluída ao passar de 90% (configurável).
4. Botão **Próxima aula** e autoplay opcional.

### 2.4 Telas
| Tela | Conteúdo |
|---|---|
| Login | Telefone → código → senha 2FA |
| Meus cursos | Cards com capa, título, % concluído, "Continuar" |
| Curso | Módulos em acordeão, lista de aulas, barra de progresso geral |
| Aula | Player, título, descrição (texto da mensagem), anotações, anterior/próxima |
| Editar curso | Arrastar e soltar aulas, renomear módulos, ocultar mensagens |
| Configurações | Pasta de cache, limite de cache, acesso na rede local, sair da conta |

---

## 3. Arquitetura

### 3.1 Visão de alto nível

```
┌──────────────────────┐   HTTP (localhost)   ┌─────────────────────────────┐   MTProto   ┌──────────────────┐
│      Navegador       │ ───────────────────▶ │     Backend local (Python)  │ ──────────▶ │ Servidores do    │
│  Frontend (React)    │ ◀─────────────────── │  FastAPI + Telethon + SQLite│ ◀────────── │ Telegram         │
│  - telas do curso    │  JSON / vídeo (Range)│  - autenticação Telegram    │             │ (vídeos, canais) │
│  - player <video>    │                      │  - indexação de canais      │             └──────────────────┘
└──────────────────────┘                      │  - streaming de vídeo       │
                                              │  - progresso / anotações    │
                                              └──────────────┬──────────────┘
                                                             │
                                                   ┌─────────▼─────────┐
                                                   │  Disco local       │
                                                   │  - teleaula.db     │
                                                   │  - sessão Telegram │
                                                   │  - cache de vídeo  │
                                                   └────────────────────┘
```

**Princípio central:** o navegador nunca fala com o Telegram. O backend é o único cliente do Telegram e funciona como mais um "dispositivo" logado na conta do usuário (aparece em *Configurações → Dispositivos* do Telegram).

### 3.2 Stack

| Camada | Tecnologia | Motivo |
|---|---|---|
| Linguagem backend | Python 3.12+ | Ecossistema maduro para o Telegram |
| Cliente Telegram | **Telethon** | Bem mantido, suporta download parcial com offset (streaming) |
| API HTTP | **FastAPI** + Uvicorn | Assíncrono (combina com o Telethon), `StreamingResponse` |
| Banco | **SQLite** + SQLAlchemy 2 (async) + Alembic | Zero configuração, arquivo único, migrações |
| Frontend | **React + TypeScript + Vite** | SPA leve, build estático servido pelo FastAPI |
| UI | Tailwind CSS | Rapidez para montar o layout |
| Player | `<video>` nativo (opcional: Plyr) | Suporta Range nativamente |
| Empacotamento | `pipx`/`uv` e Docker Compose | Instalação simples |

### 3.3 Estrutura de pastas

```
teleaula/
├── backend/
│   ├── app/
│   │   ├── main.py              # cria o FastAPI, monta rotas e o frontend estático
│   │   ├── config.py            # leitura do .env (pydantic-settings)
│   │   ├── telegram/
│   │   │   ├── client.py        # instância única do TelegramClient, ciclo de vida
│   │   │   ├── auth.py          # fluxo telefone → código → 2FA
│   │   │   ├── resolver.py      # resolve links t.me em entidades
│   │   │   └── media.py         # download parcial, file reference, FloodWait
│   │   ├── indexing/
│   │   │   ├── scanner.py       # varre o histórico do canal
│   │   │   └── structurer.py    # heurísticas de módulos/aulas
│   │   ├── streaming/
│   │   │   ├── range.py         # parse do header Range
│   │   │   ├── streamer.py      # gera os bytes a partir do Telegram
│   │   │   └── cache.py         # cache de blocos em disco (LRU)
│   │   ├── db/
│   │   │   ├── models.py
│   │   │   ├── session.py
│   │   │   └── migrations/
│   │   ├── api/
│   │   │   ├── auth.py
│   │   │   ├── courses.py
│   │   │   ├── lessons.py
│   │   │   ├── progress.py
│   │   │   ├── notes.py
│   │   │   └── stream.py
│   │   └── security.py          # bind local, PIN para acesso na rede
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── pages/               # Login, Home, Course, Lesson, EditCourse, Settings
│   │   ├── components/          # Player, LessonList, ProgressBar, NotesPanel
│   │   ├── api/                 # cliente HTTP tipado
│   │   └── hooks/               # useProgressSync, etc.
│   └── vite.config.ts
├── data/                        # (gitignored) banco, sessão, cache
├── .env.example
├── docker-compose.yml
├── pyproject.toml
├── README.md
└── PLANO.md
```

---

## 4. Backend em detalhe

### 4.1 Configuração (`.env`)

```env
TG_API_ID=123456            # obtido em https://my.telegram.org
TG_API_HASH=abcdef...
TELEAULA_DATA_DIR=./data
TELEAULA_HOST=127.0.0.1     # 0.0.0.0 apenas se quiser acesso pela rede local
TELEAULA_PORT=8000
TELEAULA_LAN_PIN=           # obrigatório se HOST != 127.0.0.1
CACHE_MAX_GB=5
COMPLETION_THRESHOLD=0.9
```

### 4.2 Cliente Telegram (`telegram/client.py`)
- Uma **única instância** de `TelegramClient` por processo, criada no `lifespan` do FastAPI.
- Sessão persistida em `data/teleaula.session` (SQLite do Telethon).
- Na inicialização: `connect()`; se `is_user_authorized()` for falso, a API passa a responder `401 telegram_not_connected` e o frontend leva à tela de login.
- `flood_sleep_threshold` configurado (ex.: 60 s) para o Telethon esperar automaticamente em `FloodWaitError` curtos.

### 4.3 Autenticação (`telegram/auth.py`)
Fluxo em etapas, mantendo o estado entre requisições:

| Etapa | Endpoint | Ação no Telethon |
|---|---|---|
| 1 | `POST /api/auth/phone` `{phone}` | `send_code_request(phone)` → guarda `phone_code_hash` em memória |
| 2 | `POST /api/auth/code` `{code}` | `sign_in(phone, code, phone_code_hash=...)`; se `SessionPasswordNeededError` → responde `{needs_password: true}` |
| 3 | `POST /api/auth/password` `{password}` | `sign_in(password=...)` |
| — | `GET /api/auth/status` | `{connected, user: {name, username}}` |
| — | `POST /api/auth/logout` | `log_out()` e apaga a sessão |

A senha 2FA nunca é gravada; trafega apenas do navegador para o backend local.

### 4.4 Resolução de links (`telegram/resolver.py`)
Formatos aceitos:
- `t.me/usuario` ou `@usuario` → `get_entity("usuario")` (canal público)
- `t.me/+HASH` ou `t.me/joinchat/HASH` → `CheckChatInviteRequest`; se já for membro, usa o chat; se não, pergunta ao usuário se deseja entrar (`ImportChatInviteRequest`), **nunca entra automaticamente**
- `t.me/c/123456/789` → canal privado pelo ID (o usuário precisa ser membro)
- `t.me/usuario/789` → canal + mensagem (pode marcar como "primeira aula")

Guarda no banco o `channel_id` numérico (estável), não o username (que pode mudar).

### 4.5 Indexação (`indexing/scanner.py`)
1. `client.iter_messages(channel, reverse=True)` → percorre do mais antigo para o mais novo.
2. Para cada mensagem, extrai:
   - `id`, `date`, `text`/`caption`, `grouped_id` (álbuns);
   - se tem vídeo (`message.video` ou documento com `mime_type` `video/*`): `duration`, `w`, `h`, `size`, `mime_type`, `file_name`;
   - miniatura (thumb) → baixada pequena e salva no cache para servir como capa da aula;
   - mensagens de texto sem vídeo também são guardadas, porque costumam ser títulos de módulo ("📚 Módulo 2 — ...").
3. Grava em `telegram_messages` (tabela bruta), separada da estrutura do curso.
4. **Sincronização incremental:** guarda `last_message_id`; o botão "Atualizar curso" só busca mensagens com `min_id=last_message_id`.
5. Executa como tarefa em segundo plano; o frontend acompanha por `GET /api/courses/{id}/index-status` (ou SSE).

### 4.6 Estruturação do curso (`indexing/structurer.py`)
Ver seção 6. A saída é uma proposta de `modules` e `lessons` que o usuário pode editar. Edições manuais são preservadas em re-sincronizações (flag `user_edited`).

### 4.7 Streaming de vídeo (`streaming/`)
É a peça mais importante para a experiência "o vídeo está no nosso site".

**Endpoint:** `GET /api/stream/{lesson_id}`

**Funcionamento:**
1. Busca a lição → `channel_id` + `message_id` + `size` + `mime_type`.
2. Lê o header `Range: bytes=START-END` (o `<video>` sempre envia).
3. Responde `206 Partial Content` com:
   - `Content-Type: video/mp4` (ou o MIME original)
   - `Accept-Ranges: bytes`
   - `Content-Range: bytes START-END/SIZE`
   - `Content-Length: END-START+1`
4. Gera o corpo com `StreamingResponse` a partir de `client.iter_download(...)`.

**Alinhamento de blocos:** o Telegram exige offsets alinhados. A estratégia:
- tamanho de bloco fixo `CHUNK = 1 MiB` (1 048 576 bytes, múltiplo de 4096 e divisor de 1 MiB, como exige o MTProto);
- `first_chunk = START // CHUNK`, `offset = first_chunk * CHUNK`;
- baixa a partir de `offset` com `request_size=CHUNK` e descarta os `START - offset` bytes iniciais do primeiro bloco;
- para de gerar quando atinge `END`;
- quando o navegador não envia `END` (`bytes=START-`), limita cada resposta a uma janela (ex.: 8 MiB) para o salto no vídeo ficar rápido.

**Pseudocódigo:**

```python
async def stream_range(msg, start, end):
    chunk = 1024 * 1024
    first = start // chunk
    skip = start - first * chunk
    remaining = end - start + 1

    async for block in client.iter_download(
        msg.media, offset=first * chunk, request_size=chunk
    ):
        if skip:
            block = block[skip:]
            skip = 0
        if len(block) > remaining:
            block = block[:remaining]
        remaining -= len(block)
        yield block
        if remaining <= 0:
            break
```

**File reference expirada:** referências de arquivo do Telegram expiram. Em `FileReferenceExpiredError`, o backend busca a mensagem de novo (`get_messages(channel, ids=message_id)`) e reinicia o download do ponto em que parou. A mensagem fica em cache em memória por alguns minutos para não refazer a busca a cada requisição Range.

**Cache em disco (`streaming/cache.py`):**
- blocos salvos em `data/cache/{channel_id}/{message_id}/{chunk_index}.bin`;
- antes de pedir ao Telegram, verifica se o bloco existe;
- LRU por data de acesso, respeitando `CACHE_MAX_GB`;
- *prefetch* opcional: ao começar uma aula, baixa em segundo plano os próximos ~2 blocos.

**Compatibilidade de formato:**
- MP4 (H.264/AAC) toca direto, que é o caso da maioria dos vídeos do Telegram.
- Para MP4 com o `moov atom` no final, o navegador faz uma requisição extra ao fim do arquivo; o suporte a Range resolve isso.
- MKV/AVI/HEVC: marcados como "formato não suportado pelo navegador". Na fase 4, opção de **remux** com `ffmpeg` (`-c copy` para MP4) gerando uma cópia local.

### 4.8 Progresso (`api/progress.py`)
- O frontend envia `PUT /api/lessons/{id}/progress` `{position_seconds, duration_seconds}`:
  - a cada 10 s durante a reprodução;
  - no `pause`, no `ended` e no `visibilitychange`/`beforeunload` (via `navigator.sendBeacon`).
- O backend grava `position_seconds`, `last_watched_at` e marca `completed=true` se `position/duration >= COMPLETION_THRESHOLD` (nunca desmarca automaticamente).
- O usuário pode marcar ou desmarcar manualmente: `POST /api/lessons/{id}/complete` / `DELETE`.
- **Progresso do curso** = aulas concluídas / aulas visíveis.
- **Continuar assistindo** = lição com o `last_watched_at` mais recente que não está concluída (ou a próxima após a última concluída).

### 4.9 Anotações (`api/notes.py`)
- Texto em Markdown por aula, com marca de tempo opcional (`at_seconds`) para pular ao trecho no vídeo.
- `GET/POST/PATCH/DELETE /api/lessons/{id}/notes`.

---

## 5. Banco de dados

```sql
-- Canal de origem
CREATE TABLE channels (
  id                INTEGER PRIMARY KEY,      -- channel_id do Telegram
  title             TEXT NOT NULL,
  username          TEXT,                     -- pode ser NULL (privado)
  last_message_id   INTEGER DEFAULT 0,
  last_synced_at    DATETIME
);

-- Cópia bruta das mensagens relevantes
CREATE TABLE telegram_messages (
  channel_id   INTEGER NOT NULL REFERENCES channels(id),
  message_id   INTEGER NOT NULL,
  date         DATETIME NOT NULL,
  text         TEXT,
  grouped_id   INTEGER,
  has_video    BOOLEAN NOT NULL,
  duration     INTEGER,
  size         INTEGER,
  mime_type    TEXT,
  file_name    TEXT,
  width        INTEGER,
  height       INTEGER,
  thumb_path   TEXT,
  PRIMARY KEY (channel_id, message_id)
);

-- Curso (um canal pode gerar mais de um curso no futuro)
CREATE TABLE courses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  INTEGER NOT NULL REFERENCES channels(id),
  title       TEXT NOT NULL,
  cover_path  TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  archived    BOOLEAN DEFAULT 0
);

CREATE TABLE modules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  position     INTEGER NOT NULL,
  user_edited  BOOLEAN DEFAULT 0
);

CREATE TABLE lessons (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id    INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  channel_id   INTEGER NOT NULL,
  message_id   INTEGER NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  position     INTEGER NOT NULL,
  hidden       BOOLEAN DEFAULT 0,
  user_edited  BOOLEAN DEFAULT 0,
  FOREIGN KEY (channel_id, message_id) REFERENCES telegram_messages(channel_id, message_id)
);

CREATE TABLE progress (
  lesson_id         INTEGER PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  position_seconds  REAL DEFAULT 0,
  duration_seconds  REAL,
  completed         BOOLEAN DEFAULT 0,
  completed_at      DATETIME,
  last_watched_at   DATETIME
);

CREATE TABLE notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id   INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  at_seconds  REAL,
  body        TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME
);
```

A separação entre `telegram_messages` (dado bruto) e `modules`/`lessons` (estrutura editável) permite re-sincronizar o canal sem perder as edições nem o progresso.

---

## 6. Heurísticas para montar módulos, subtópicos e aulas

A organização do curso deve ser extraída prioritariamente do sumário publicado no canal. Diferentemente da abordagem anterior, não se deve tentar inferir a estrutura do curso apenas pela ordem cronológica das mensagens, pelo nome dos arquivos ou por hashtags isoladas. O sumário estabelece a hierarquia oficial do conteúdo e deve ser utilizado como referência para associar cada material à sua respectiva seção.

O programa deve identificar e interpretar os seguintes elementos:

**1. Identificação do sumário:** procurar mensagens que apresentem o sumário do curso. Podem existir textos introdutórios como "Clique aqui para ver o sumário!", "Siga o conteúdo do menu:" ou outras variações. A identificação não deve depender exclusivamente dessas frases, pois alguns canais podem utilizar formatos diferentes. O principal indicador é a presença de uma estrutura recorrente de títulos e identificadores.

**2. Identificação dos módulos (`=`):** linhas iniciadas por um único sinal de igual, seguidas pelo título do conteúdo, representam módulos do curso.

Exemplo:

`= 01. Introdução`

`= 02. Conceitos de programação`

Cada ocorrência válida de `=` deve iniciar um novo módulo. O título deve ser preservado integralmente, incluindo numeração, pontuação e acentuação.

**3. Identificação dos subtópicos (`==`):** linhas iniciadas por dois sinais de igual representam subdivisões do módulo imediatamente anterior.

Exemplo:

`= 03. Introdução à linguagem Java`

`== 03.1. História e características do Java`

`== 03.2. Instalação e configuração`

Os subtópicos devem ser vinculados ao módulo ao qual pertencem, respeitando a ordem em que aparecem no sumário. A hierarquia deve permitir que um módulo contenha diretamente aulas ou, alternativamente, subtópicos que agrupem suas respectivas aulas.

É importante distinguir `=` de `==` por meio de uma análise do início da linha, evitando que o segundo marcador seja interpretado incorretamente como um módulo independente.

**4. Identificação das aulas e materiais (`#`):** identificadores iniciados por `#` representam referências aos conteúdos publicados no canal.

Exemplos:

`#A001`

`#A002 #A003 #A004`

`#F001`

`#D001`

O programa deve reconhecer identificadores com diferentes prefixos alfanuméricos, sem assumir que todas as aulas utilizam exclusivamente o prefixo `A`. Alguns cursos utilizam `#F`, `#D` ou outras convenções.

Cada identificador deve ser tratado como uma referência individual a uma mensagem ou material do canal. Uma mesma linha pode conter vários identificadores, e todos devem ser associados ao módulo ou subtópico em que aparecem.

**5. Associação dos materiais à hierarquia:** os identificadores `#` devem ser vinculados ao último módulo (`=`) ou subtópico (`==`) válido identificado anteriormente no sumário.

Exemplo:

`= 01. Introdução`

`#A001`

`= 02. Conceitos de programação`

`#A002 #A003 #A004`

Nesse caso, `#A001` pertence ao primeiro módulo, enquanto os três identificadores seguintes pertencem ao segundo.

Quando houver subtópicos, os identificadores devem ser associados ao subtópico atual, e não diretamente ao módulo, mantendo a relação hierárquica entre ambos.

**6. Sumários divididos em várias mensagens:** o sumário não necessariamente estará contido em uma única mensagem. Alguns canais dividem o índice em duas ou mais publicações devido ao limite de caracteres do Telegram ou à organização do próprio canal.

O programa deve, portanto, ser capaz de reconstruir um sumário a partir de mensagens consecutivas ou relacionadas, preservando a ordem original e o contexto da hierarquia.

Uma nova mensagem que contenha a continuação dos módulos, subtópicos ou identificadores deve ser interpretada como parte do mesmo sumário quando houver evidências estruturais dessa continuidade.

A reconstrução não deve reiniciar a hierarquia a cada mensagem. Caso uma mensagem termine com um módulo e a seguinte comece com identificadores `#`, estes ainda devem ser associados ao módulo anterior, desde que não exista um novo marcador de módulo ou subtópico.

**7. Resolução dos identificadores:** depois de reconstruir a estrutura do sumário, o programa deve localizar no histórico do canal as mensagens correspondentes aos identificadores encontrados.

A correspondência deve considerar o identificador como referência principal, e não apenas o conteúdo textual, nome do arquivo ou proximidade temporal.

Uma vez localizada a mensagem, seus respectivos materiais devem ser extraídos e vinculados à aula correspondente. Caso um identificador não possua uma mensagem correspondente, ele deve ser preservado como referência não resolvida, sem ser descartado silenciosamente.

**8. Álbuns e múltiplas mídias:** quando uma aula corresponder a uma mensagem que contenha um álbum de mídias, todos os elementos do mesmo `grouped_id` devem ser preservados e agrupados, respeitando a ordem original do álbum.

Da mesma forma, se uma referência corresponder a uma mensagem com múltiplos arquivos, todos devem permanecer associados à mesma aula, sem gerar aulas independentes indevidamente.

**9. Extração dos metadados da aula:** após localizar a mensagem correspondente, utilizar as seguintes regras:

- **Título:** primeira linha não vazia da legenda. Caso não exista legenda, utilizar o nome do arquivo sem extensão. Se nenhuma das opções estiver disponível, utilizar `Aula N`, respeitando a ordem de apresentação.
- **Descrição:** conteúdo restante da legenda, excluindo a linha utilizada como título. Preservar links e formatá-los adequadamente em Markdown.
- **Mídia:** preservar todos os arquivos e respectivos metadados associados à mensagem.
- **Identificador:** armazenar a referência original, como `A001`, `F001` ou `D001`, para permitir rastreabilidade e evitar duplicações.

**10. Ordenação e integridade:** a ordem dos módulos e subtópicos deve seguir a sequência apresentada no sumário, não a data de publicação das mensagens. Dentro de cada módulo ou subtópico, a ordem das aulas deve respeitar a sequência dos identificadores no sumário.

O programa deve evitar duplicações, preservar referências não resolvidas e permitir que materiais encontrados no histórico, mas ausentes do sumário, sejam identificados separadamente, sem inseri-los arbitrariamente na estrutura principal do curso.

**11. Fallback:** somente quando não for possível identificar um sumário válido ou reconstruir uma hierarquia minimamente confiável, utilizar a organização alternativa. Nesse cenário, criar um único módulo denominado "Aulas" e organizar os materiais disponíveis em ordem cronológica, mantendo os metadados e as referências originais sempre que possível.

**Prioridade geral:** Sumário (`=` e `==`) → identificação e resolução dos materiais (`#`) → extração de metadados → agrupamento de mídias → fallback cronológico.

A estrutura resultante deve ser hierárquica e flexível, permitindo módulos com aulas diretamente associadas, módulos com subtópicos e subtópicos com múltiplas aulas. Não se deve impor uma profundidade fixa de organização que impeça a representação fiel do sumário original.

---

## 7. API (resumo)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/auth/status` | Estado da conexão com o Telegram |
| POST | `/api/auth/phone` · `/code` · `/password` | Login em etapas |
| POST | `/api/auth/logout` | Sai da conta e apaga a sessão |
| POST | `/api/courses` `{link}` | Resolve o link, cria o curso e inicia a indexação |
| GET | `/api/courses` | Lista cursos com % de progresso |
| GET | `/api/courses/{id}` | Curso completo (módulos, aulas, progresso) |
| GET | `/api/courses/{id}/index-status` | Andamento da indexação (SSE) |
| POST | `/api/courses/{id}/sync` | Busca aulas novas |
| PATCH | `/api/courses/{id}/structure` | Salva edições (ordem, títulos, ocultas) |
| DELETE | `/api/courses/{id}` | Remove o curso (não sai do canal) |
| GET | `/api/continue` | Aula para "Continuar assistindo" |
| GET | `/api/lessons/{id}` | Dados da aula + progresso + anotações |
| GET | `/api/lessons/{id}/thumb` | Miniatura |
| GET | `/api/stream/{lesson_id}` | Vídeo com suporte a Range |
| PUT | `/api/lessons/{id}/progress` | Salva posição |
| POST/DELETE | `/api/lessons/{id}/complete` | Marca/desmarca concluída |
| CRUD | `/api/lessons/{id}/notes` | Anotações |

---

## 8. Frontend em detalhe

- **Roteamento:** `/login`, `/`, `/curso/:id`, `/aula/:id`, `/curso/:id/editar`, `/config`.
- **Guarda de rota:** se `auth/status` retornar desconectado, redireciona para `/login`.
- **Player (`components/Player.tsx`):**
  - `<video src="/api/stream/{id}" preload="metadata">`;
  - ao carregar os metadados, faz `currentTime = progress.position_seconds` (se faltar menos de 10 s para o fim, começa do zero);
  - hook `useProgressSync` envia a posição a cada 10 s e nos eventos `pause`/`ended`/`visibilitychange`;
  - atalhos: espaço, ←/→ (±10 s), `J/K/L`, `F` (tela cheia), `N` (próxima), velocidades de 0,5× a 2×;
  - ao terminar: tela "Próxima aula em 5 s" com botão de cancelar.
- **Lista de aulas:** ícones de status (○ não iniciada, ◐ em andamento com %, ● concluída), duração e destaque da aula atual.
- **Responsivo:** a lista vira gaveta lateral no celular.
- **Tema claro/escuro.**

---

## 9. Segurança e privacidade

- **O arquivo de sessão do Telegram equivale à senha da conta.** Ele fica em `data/`, está no `.gitignore` e o README alerta para nunca compartilhá-lo.
- **Bind em `127.0.0.1` por padrão:** só o próprio computador acessa.
- **Acesso pela rede local:** opcional, exige `TELEAULA_LAN_PIN`; o backend emite um cookie de sessão HTTP-only após o PIN; mesmo assim, nunca expor à internet.
- **CORS** restrito à origem do próprio app.
- **Somente leitura no Telegram:** o app nunca envia mensagens, reage ou apaga nada. A única ação de escrita possível é entrar num canal por link de convite, e apenas com confirmação explícita.
- **Respeito aos limites:** indexação sequencial, tratamento de `FloodWaitError` e nada de varreduras paralelas agressivas.
- **Direitos autorais:** uso pessoal; o app não re-hospeda nem compartilha vídeos. O cache é local e limitado.

---

## 10. Tratamento de erros

| Situação | Comportamento |
|---|---|
| Sessão revogada (usuário encerrou o dispositivo no Telegram) | API responde `401`; frontend volta para o login |
| Canal privado e usuário não é membro | Mensagem clara + opção de entrar via link de convite |
| Mensagem apagada pelo professor | Aula marcada como "indisponível"; progresso mantido |
| `FloodWaitError` longo | Indexação pausa e mostra "Aguardando o Telegram (X s)" |
| `FileReferenceExpiredError` | Recarrega a mensagem e retoma o stream de forma transparente |
| Formato não reproduzível | Aviso na aula + opção de converter (fase 4) |
| Queda de conexão durante o vídeo | O `<video>` refaz a requisição Range; o backend retoma do offset |

---

## 11. Roadmap

### Fase 0 — Fundação
- [ ] Repositório, `pyproject.toml`, Vite, `.env.example`, Docker Compose
- [ ] FastAPI servindo o build do frontend
- [ ] Banco + migrações iniciais

### Fase 1 — MVP (prova de conceito)
- [ ] Login no Telegram pelo navegador
- [ ] Adicionar curso por link de canal público
- [ ] Indexação com estrutura fallback (um módulo, ordem cronológica)
- [ ] Streaming com Range (sem cache)
- [ ] Player com retomada da posição
- [ ] Marcar como concluída + % do curso

**Critério de pronto:** colar um link, ver a lista e assistir duas aulas seguidas, fechar o navegador e voltar no mesmo minuto.

### Fase 2 — Experiência de curso
- [ ] Heurísticas de módulos (seção 6)
- [ ] Editor de estrutura (arrastar e soltar, renomear, ocultar)
- [ ] Tela inicial com "Continuar assistindo"
- [ ] Miniaturas e capas
- [ ] Próxima aula / autoplay / atalhos
- [ ] Canais privados e links de convite

### Fase 3 — Robustez e desempenho
- [ ] Cache de blocos em disco com LRU
- [ ] Prefetch dos próximos blocos
- [ ] Sincronização incremental ("Atualizar curso")
- [ ] Tratamento completo de erros (seção 10)
- [ ] Testes automatizados do streamer e das heurísticas

### Fase 4 — Extras
- [ ] Anotações com marca de tempo
- [ ] Acesso pela rede local com PIN (usar no celular/TV)
- [ ] Remux de MKV com ffmpeg
- [ ] Busca nas legendas/títulos das aulas
- [ ] Exportar/importar progresso (backup em JSON)
- [ ] Empacotar como app desktop (ex.: PyInstaller ou Tauri)

---

## 12. Testes

- **Unitários:** parse de `Range`, alinhamento de blocos, regex das heurísticas, cálculo de progresso.
- **Integração:** streamer com um cliente Telegram falso (gera bytes determinísticos) validando que qualquer intervalo `START-END` retorna exatamente os bytes certos.
- **Manual/E2E:** canal de teste próprio com vídeos curtos em diferentes formatos e organizações (hashtags, mensagens-título, álbuns).

---

## 13. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Mudanças na API do Telegram ou no Telethon | Isolar o acesso em `telegram/`; fixar versões; atualizar com testes |
| Latência ao pular no vídeo | Janela de resposta limitada, cache e prefetch |
| Estruturas de canal muito diferentes entre professores | Heurísticas + editor manual como rede de segurança |
| Vazamento do arquivo de sessão | Bind local, `.gitignore`, alerta no README, logout fácil |
| Restrições de uso da conta por excesso de requisições | Indexação sequencial, respeito ao FloodWait, sem varreduras em massa |

---

## 14. Como rodar (previsto)

```bash
git clone https://github.com/<voce>/teleaula.git
cd teleaula
cp .env.example .env          # preencha TG_API_ID e TG_API_HASH
uv sync                       # ou: pip install -e .
cd frontend && npm install && npm run build && cd ..
uv run teleaula               # abre em http://localhost:8000
```

Ou, com Docker:

```bash
docker compose up -d
```
