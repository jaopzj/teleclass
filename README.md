# Teleaula

Plataforma pessoal para assistir cursos publicados em canais do Telegram com
experiência de área de membros. O plano completo está em [PLANO.md](PLANO.md).

**Estado atual:** indexação + área de membros. O app lê um canal, monta
módulos, subtópicos e aulas, e permite assistir às aulas com streaming direto do
Telegram, retomada de onde parou, progresso por curso, um Caderno Digital (notas rápidas na aula com marca de
tempo, documentos com pastas, busca, referências a aulas e histórico) e
métricas de estudo (tempo real de reprodução, sequência, média diária) e um
temporizador de estudos (Pomodoro, 52/17, Deep Work, métodos próprios, metas,
XP e conquistas).
Arquitetura: [docs/indexacao.md](docs/indexacao.md),
[docs/area-de-membros.md](docs/area-de-membros.md),
[docs/metricas-de-estudo.md](docs/metricas-de-estudo.md),
[docs/temporizador.md](docs/temporizador.md) e
[docs/caderno.md](docs/caderno.md).

## Requisitos

- Python 3.12+
- Node 18+ (só para o frontend)
- `TG_API_ID` e `TG_API_HASH` de https://my.telegram.org

## Rodar com Docker (mais fácil)

Só precisa do [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
copy .env.example .env            # Windows (Linux/macOS: cp); preencha TG_API_ID e TG_API_HASH
docker compose up -d --build      # compila frontend e backend numa imagem só
```

Abra http://127.0.0.1:8000. Os dados ficam na pasta `data/` do projeto (a
mesma de quem já rodava sem Docker), então nada se perde ao recriar o
contêiner. A porta só abre no próprio PC; para usar outra, defina
`TELEAULA_PORT=8080` no `.env`.

| Tarefa | Comando |
| --- | --- |
| Ver os logs | `docker compose logs -f` |
| Parar | `docker compose down` |
| Atualizar depois de um `git pull` | `docker compose up -d --build` |
| Usar a CLI | `docker compose exec teleclass python -m app.cli collect https://t.me/canal --user seu_usuario` |

## Como rodar sem Docker

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows  (Linux/macOS: source .venv/bin/activate)
pip install -e ".[dev]"
copy .env.example .env            # preencha TG_API_ID e TG_API_HASH

uvicorn app.main:app --app-dir backend        # http://127.0.0.1:8000
```

Abra o app, clique em **Criar conta** e siga as etapas: usuário e senha,
telefone do Telegram, código (e senha de duas etapas, se houver). Nada disso
usa o terminal. Detalhes e contrato da API em
[docs/autenticacao.md](docs/autenticacao.md).

Opcional, pelo terminal:

```bash
# Coletar um canal para a biblioteca de um usuário (gera data/snapshots/<id do usuário>/<canal>.json)
python -m app.cli collect https://t.me/nomedocanal --user seu_usuario

# Ver a estrutura e o relatório
python -m app.cli index nomedocanal --user seu_usuario --json data/resultado.json
```

Rode os comandos na raiz do projeto (a pasta `data/` é criada ali).
`teleaula-index` é um atalho para `python -m app.cli`.

### Interface web

```bash
# backend (na raiz do projeto)
uvicorn app.main:app --app-dir backend        # http://127.0.0.1:8000

# frontend em modo desenvolvimento (outro terminal)
cd frontend && npm install && npm run dev     # http://127.0.0.1:5173
```

Com `npm run build`, o backend passa a servir o frontend em
http://127.0.0.1:8000.

- **Meus cursos** (`/`): painel "Seu estudo" (tempo hoje e na semana,
  sequência, média diária, aulas concluídas, progresso geral) e um card por
  snapshot coletado, com progresso.
- **Curso** (`/cursos/<snapshot>`): módulos, subtópicos e aulas, percentual,
  última aula assistida e "Continuar de onde parei".
- **Aula**: player, notas rápidas com marca de tempo clicável, marcar como
  concluída, aula anterior e próxima.
- **Caderno** (`/caderno`): documentos com editor completo (tabelas, imagens,
  anexos, código, fórmulas), pastas, favoritas, fixadas, etiquetas, lixeira,
  busca, referências `@` a cursos e aulas, histórico de versões e resolução de
  conflitos entre aparelhos.
- **Foco** (`/foco`): temporizador de estudos com técnicas prontas e métodos
  próprios, Focus Mode com sons ambientes, pausas guiadas, metas, níveis,
  conquistas, histórico e estatísticas. Um widget flutuante acompanha a sessão
  em todas as páginas, e a aula tem um atalho para estudar com o temporizador.
- **Indexação** (`/indexacao`): coleta canais e mostra a árvore e o relatório.

Cada usuário tem a própria biblioteca, progresso e anotações; ninguém vê os
cursos de outra pessoa. Os vídeos tocam pela conta do Telegram de cada usuário. Depois de atualizar o projeto, rode `pip install -e .` de novo:
o pacote `cryptg` é o que deixa o streaming rápido. Trechos já assistidos ficam
em `data/cache/` (até 4 GB, configurável no `.env`). Progresso, anotações e
tempo de estudo ficam em `data/teleaula.db`, e imagens e anexos do Caderno em
`data/notebook/` (o pacote `tzdata` traz os fusos
horários no Windows).

Sem credenciais, dá para testar com o canal de exemplo:
`python -m app.cli index backend/tests/fixtures/curso_exemplo.json`.

## Testes

```bash
pytest                          # backend
cd frontend && npm test         # player, fila de envio e marcas de tempo (vitest)
```

## Segurança

Os arquivos em `data/sessions/` dão acesso total às contas do Telegram
vinculadas, e `data/secret.key` protege os telefones gravados. Tudo fica em
`data/`, que está no `.gitignore`. Nunca compartilhe essa pasta. O antigo
`data/teleaula.session` (login pelo terminal) não é mais usado e pode ser
apagado.
A API escuta só em `127.0.0.1` e é somente leitura no Telegram.
