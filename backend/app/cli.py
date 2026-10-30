"""Linha de comando para o piloto.

    python -m app.cli login                      # entra na conta do Telegram (uma vez)
    python -m app.cli collect https://t.me/canal # salva data/snapshots/canal.json
    python -m app.cli index canal                # mostra estrutura + relatório
    python -m app.cli index caminho.json --json saida.json
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
from .snapshots import SnapshotStore


async def _login() -> None:
    from .telegram.client import create_client

    client = create_client(get_settings())
    await client.start()  # pede telefone, código e senha 2FA no terminal
    me = await client.get_me()
    print(f"Conectado como {me.first_name} (@{me.username})")
    await client.disconnect()


async def _collect(link: str, name: str | None) -> None:
    from .telegram.client import create_client
    from .telegram.collector import collect_channel

    settings = get_settings()
    client = create_client(settings)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            sys.exit("Conta não conectada. Rode primeiro: python -m app.cli login")
        snapshot = await collect_channel(
            client, link, on_progress=lambda n: print(f"  {n} mensagens...", file=sys.stderr)
        )
    finally:
        await client.disconnect()
    saved = SnapshotStore(settings.snapshots_dir).save(snapshot, name)
    print(f"{len(snapshot.messages)} mensagens salvas no snapshot '{saved}'")


def _index(target: str, json_out: str | None) -> None:
    path = Path(target)
    snapshot = (
        load_snapshot(path)
        if path.suffix == ".json"
        else SnapshotStore(get_settings().snapshots_dir).load(target)
    )
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
    sub.add_parser("login", help="conecta a conta do Telegram")
    collect = sub.add_parser("collect", help="lê o canal e salva um snapshot")
    collect.add_argument("link")
    collect.add_argument("--name", help="nome do snapshot (padrão: username do canal)")
    index = sub.add_parser("index", help="indexa um snapshot e mostra o relatório")
    index.add_argument("snapshot", help="nome do snapshot ou caminho de um .json")
    index.add_argument("--json", dest="json_out", help="grava o resultado completo em JSON")
    args = parser.parse_args(argv)

    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")  # terminal do Windows

    if args.command == "login":
        asyncio.run(_login())
    elif args.command == "collect":
        asyncio.run(_collect(args.link, args.name))
    else:
        _index(args.snapshot, args.json_out)


if __name__ == "__main__":
    main()
