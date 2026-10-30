# Teleaula

Plataforma pessoal para assistir cursos publicados em canais do Telegram com
experiência de área de membros. O plano completo está em [PLANO.md](PLANO.md).

**Estado atual:** indexação + área de membros. O app lê um canal, monta
módulos, subtópicos e aulas, e permite assistir às aulas com streaming direto do
Telegram, retomada de onde parou, progresso por curso e anotações por aula.
Arquitetura: [docs/indexacao.md](docs/indexacao.md) e
[docs/area-de-membros.md](docs/area-de-membros.md).

## Requisitos

- Python 3.12+
- Node 18+ (só para o frontend)
- `TG_API_ID` e `TG_API_HASH` de https://my.telegram.org

## Como rodar

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

- **Meus cursos** (`/`): um card por snapshot coletado, com progresso.
- **Curso** (`/cursos/<snapshot>`): módulos, subtópicos e aulas, percentual,
  última aula assistida e "Continuar de onde parei".
- **Aula**: player, anotações com salvamento automático, marcar como concluída,
  aula anterior e próxima.
- **Indexação** (`/indexacao`): coleta canais e mostra a árvore e o relatório.

Cada usuário tem a própria biblioteca, progresso e anotações; ninguém vê os
cursos de outra pessoa. Os vídeos tocam pela conta do Telegram de cada usuário. Depois de atualizar o projeto, rode `pip install -e .` de novo:
o pacote `cryptg` é o que deixa o streaming rápido. Trechos já assistidos ficam
em `data/cache/` (até 4 GB, configurável no `.env`). Progresso e anotações ficam em `data/teleaula.db`.

Sem credenciais, dá para testar com o canal de exemplo:
`python -m app.cli index backend/tests/fixtures/curso_exemplo.json`.

## Testes

```bash
pytest
```

## Segurança

Os arquivos em `data/sessions/` dão acesso total às contas do Telegram
vinculadas, e `data/secret.key` protege os telefones gravados. Tudo fica em
`data/`, que está no `.gitignore`. Nunca compartilhe essa pasta. O antigo
`data/teleaula.session` (login pelo terminal) não é mais usado e pode ser
apagado.
A API escuta só em `127.0.0.1` e é somente leitura no Telegram.
