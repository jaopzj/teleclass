// "Adicionar curso": coleta um canal do Telegram e mostra a estrutura extraída.
//
// Três estados, decididos aqui e em mais nenhum lugar:
//   importação  → formulário do link e importações anteriores (snapshots)
//   coleta      → uma coleta em andamento ou que acabou de falhar (collectStore)
//   inspeção    → estrutura e relatório de um snapshot (`?curso=<nome>` na URL)
// A inspeção fica na URL para o voltar do navegador e o recarregar funcionarem.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useResource } from "../hooks/useResource";
import { navigate, paths, useSearchParam } from "../router";
import { clearCollection, useCollection } from "./collectStore";
import ImportView from "./ImportView";
import InspectionView from "./InspectionView";
import ProcessingView from "./ProcessingView";
import "./indexing.css";

export type TelegramState = "loading" | "unknown" | "unconfigured" | "unlinked" | "linked";

export default function IndexingPage() {
  const selected = useSearchParam("curso");
  const collection = useCollection();
  const [telegram, setTelegram] = useState<TelegramState>("loading");
  const snapshots = useResource("snapshots", () => api.snapshots());

  useEffect(() => {
    api
      .status()
      .then((s) => setTelegram(!s.configured ? "unconfigured" : s.linked ? "linked" : "unlinked"))
      .catch(() => setTelegram("unknown"));
  }, []);

  // Coleta concluída: abre a inspeção do canal e libera o formulário.
  const done = collection?.index === "completed" ? collection.name : undefined;
  useEffect(() => {
    if (!done) return;
    navigate(paths.indexing(done));
    clearCollection();
    snapshots.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const back = useCallback(() => navigate(paths.indexing()), []);

  let view;
  if (collection) {
    // Também enquanto a navegação para a inspeção não acontece.
    view = <ProcessingView collection={collection} onSnapshotsChanged={snapshots.reload} />;
  } else if (selected) {
    view = <InspectionView name={selected} snapshots={snapshots.data} onBack={back} />;
  } else {
    view = <ImportView telegram={telegram} snapshots={snapshots.data} snapshotsError={snapshots.error} />;
  }

  return <div className="page ix">{view}</div>;
}
