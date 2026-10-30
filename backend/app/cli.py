"""Ferramentas de linha de comando (opcionais: tudo isso também existe na interface).

    python -m app.cli collect https://t.me/canal --user joao  # usa o Telegram vinculado a "joao"
    python -m app.cli index canal --user joao                # mostra estrutura + relatório
    python -m app.cli index caminho.json --json saida.json

Cadastro, login e vínculo do Telegram acontecem só pela interface web.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from .config import get_settings
from .indexing.pipeline import index_snapshot
from .indexing.render import render_text
from .indexing.storage import load_snapshot
from .libraries import Libraries


def _user_id(username: str) -> str:
    from .accounts.validation import normalize_username
    from .learning import Database

    settings = get_settings()
    with Database(settings.database_path).connect() as conn:
        row = conn.execute("SELECT id FROM users WHERE username = ?", (normalize_username(username),)).fetchone()
    if row is None:
        sys.exit(f"Usuário '{username}' não encontrado. Crie a conta pela interface web.")
    return row["id"]


async def _collect(link: str, name: str | None, username: str) -> None:
    from .telegram.client import create_client
    from .telegram.collector import collect_channel

    settings = get_settings()
    user_id = _user_id(username)
    if not settings.session_path(user_id).with_suffix(".session").is_file():
        sys.exit("Este usuário ainda não vinculou o Telegram. Vincule pela interface web.")
    client = create_client(settings, settings.session_path(user_id))
    await client.connect()
    try:
        if not await client.is_user_authorized():
            sys.exit("A sessão do Telegram deste usuário expirou. Vincule de novo pela interface web.")
        snapshot = await collect_channel(
            client, link, on_progress=lambda n: print(f"  {n} mensagens...", file=sys.stderr)
        )
    finally:
        await client.disconnect()
    saved = Libraries(settings.snapshots_dir).store(user_id).save(snapshot, name)
    print(f"{len(snapshot.messages)} mensagens salvas no snapshot '{saved}'")


def _index(target: str, json_out: str | None, username: str | None) -> None:
    path = Path(target)
    if path.suffix == ".json":
        snapshot = load_snapshot(path)
    else:
        if not username:
            sys.exit("Informe de quem é a biblioteca: --user seu_usuario")
        snapshot = Libraries(get_settings().snapshots_dir).store(_user_id(username)).load(target)
    result = index_snapshot(snapshot)
    print(render_text(result))
    if json_out:
        Path(json_out).write_text(
            json.dumps(result.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\nResultado completo em {json_out}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="teleaula-index")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("login", help="(removido) o vínculo do Telegram agora é feito pela interface")
    collect = sub.add_parser("collect", help="lê o canal e salva um snapshot")
    collect.add_argument("link")
    collect.add_argument("--user", required=True, help="usuário do Teleaula cuja conta do Telegram será usada")
    collect.add_argument("--name", help="nome do snapshot (padrão: username do canal)")
    index = sub.add_parser("index", help="indexa um snapshot e mostra o relatório")
    index.add_argument("snapshot", help="nome do snapshot ou caminho de um .json")
    index.add_argument("--json", dest="json_out", help="grava o resultado completo em JSON")
    index.add_argument("--user", help="dono da biblioteca (obrigatório ao usar o nome do snapshot)")
    args = parser.parse_args(argv)

    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")  # terminal do Windows

    if args.command == "login":
        sys.exit(
            "O login pelo terminal foi substituído pela interface: abra o Teleaula no navegador, "
            "crie sua conta e vincule o Telegram por lá."
        )
    elif args.command == "collect":
        asyncio.run(_collect(args.link, args.name, args.user))
    else:
        _index(args.snapshot, args.json_out, args.user)


if __name__ == "__main__":
    main()
