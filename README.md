# Teleaula

Plataforma pessoal para assistir cursos publicados em canais do Telegram com
experiência de área de membros. O plano completo está em [PLANO.md](PLANO.md).

**Estado atual:** piloto da indexação (PLANO.md, seção 6). O app lê um canal,
encontra o sumário, monta módulos, subtópicos e aulas e mostra um relatório de
inspeção. Player, progresso e banco de dados ainda não existem.
Arquitetura e decisões: [docs/indexacao.md](docs/indexacao.md).

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

# 1. Entrar na conta do Telegram (uma vez; pede telefone, código e senha 2FA)
python -m app.cli login

# 2. Coletar um canal (gera data/snapshots/<canal>.json)
python -m app.cli collect https://t.me/nomedocanal

# 3. Ver a estrutura e o relatório no terminal
python -m app.cli index nomedocanal --json data/resultado.json
```

Rode os comandos na raiz do projeto (a pasta `data/` é criada ali).
`teleaula-index` é um atalho para `python -m app.cli`.

### Interface web (mínima, para testes)

```bash
# backend (na raiz do projeto)
uvicorn app.main:app --app-dir backend        # http://127.0.0.1:8000

# frontend em modo desenvolvimento (outro terminal)
cd frontend && npm install && npm run dev     # http://127.0.0.1:5173
```

Com `npm run build`, o backend passa a servir o frontend em
http://127.0.0.1:8000. A tela lista os snapshots, coleta novos canais (quando a
conta já está conectada pelo `login`) e mostra a árvore do curso com a origem
de cada material e o relatório de inspeção.

Sem credenciais, dá para testar com o canal de exemplo:
`python -m app.cli index backend/tests/fixtures/curso_exemplo.json`.

## Testes

```bash
pytest
```

## Segurança

O arquivo `data/teleaula.session` dá acesso total à sua conta do Telegram.
Ele fica em `data/`, que está no `.gitignore`. Nunca compartilhe essa pasta.
A API escuta só em `127.0.0.1` e é somente leitura no Telegram.
