import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { formatClock, plural } from "../format";
import { navigate, paths } from "../router";
import { clearCollection, Collection, isRunning, startCollection, StepState } from "./collectStore";
import { IndexingHeader } from "./ImportView";

function useElapsed(since: number, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return Math.max(0, (now - since) / 1000);
}

const STEP_LABEL: Record<StepState, string> = {
  pending: "Aguardando",
  running: "Em andamento",
  completed: "Concluída",
  failed: "Falhou",
};

function Step({ state, title, detail }: { state: StepState; title: string; detail: string }) {
  return (
    <li className={`ix-step is-${state}`}>
      <span className="ix-step-mark" aria-hidden="true">
        {state === "running" && <span className="mini-spinner" />}
        {state === "completed" && <Icon name="check" weight="bold" size={14} />}
        {state === "failed" && <Icon name="close" size={14} />}
      </span>
      <div className="ix-step-text">
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <span className="sr-only">{STEP_LABEL[state]}</span>
    </li>
  );
}

export default function ProcessingView({
  collection,
  onSnapshotsChanged,
}: {
  collection: Collection;
  onSnapshotsChanged: () => void;
}) {
  const running = isRunning(collection);
  const elapsed = useElapsed(collection.startedAt, running);
  const failed = collection.collect === "failed" || collection.index === "failed";
  const error = collection.error;

  // A coleta terminou mas a estrutura falhou: o canal já está salvo.
  useEffect(() => {
    if (collection.collect === "completed") onSnapshotsChanged();
  }, [collection.collect, onSnapshotsChanged]);

  return (
    <>
      <IndexingHeader />
      <section
        className={`surface ix-card ix-processing ${failed ? "is-failed" : ""}`}
        aria-live="polite"
        aria-busy={running}
      >
        <div className="ix-processing-head">
          <span className={`ix-tile ${failed ? "is-danger" : ""}`} aria-hidden="true">
            {failed ? <Icon name="warningCircle" size={24} /> : <span className="mini-spinner ix-tile-spinner" />}
          </span>
          <div>
            <h2>{failed ? "A importação não foi concluída" : "Importando o canal"}</h2>
            <p className="ix-processing-link">
              <Icon name="link" size={14} />
              <span>{collection.link}</span>
            </p>
          </div>
          {running && (
            <span className="ix-elapsed tabular" aria-label="Tempo decorrido">
              <Icon name="clock" size={14} />
              {formatClock(elapsed)}
            </span>
          )}
        </div>

        <ol className="ix-steps">
          <Step
            state={collection.collect}
            title="Coletar mensagens e mídias"
            detail={
              collection.collect === "completed" && collection.messages != null
                ? plural(collection.messages, "mensagem coletada", "mensagens coletadas")
                : collection.collect === "failed"
                  ? "A coleta foi interrompida. Veja o motivo abaixo."
                  : "Lendo o histórico do canal no Telegram. Canais grandes levam alguns minutos."
            }
          />
          <Step
            state={collection.index}
            title="Identificar módulos e aulas"
            detail={
              collection.index === "failed"
                ? "O canal foi salvo, mas a estrutura não pôde ser montada agora."
                : "Procurando o sumário e associando vídeos e arquivos a cada aula."
            }
          />
        </ol>

        {error && (
          <div className="alert alert-error ix-processing-error" role="alert">
            {error.message}
          </div>
        )}

        {running ? (
          <p className="ix-processing-note">
            <Icon name="info" size={16} />
            Você pode continuar usando a plataforma: avisamos quando terminar. Recarregar ou fechar esta aba interrompe o
            acompanhamento.
          </p>
        ) : (
          <div className="ix-processing-actions">
            {collection.collect === "failed" ? (
              <>
                <button type="button" className="button button-primary" onClick={() => startCollection(collection.link)}>
                  <Icon name="refresh" size={16} />
                  Tentar de novo
                </button>
                <button type="button" className="button button-ghost" onClick={clearCollection}>
                  Corrigir o link
                </button>
              </>
            ) : (
              <>
                {collection.name && (
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => {
                      clearCollection();
                      navigate(paths.indexing(collection.name));
                    }}
                  >
                    <Icon name="refresh" size={16} />
                    Montar a estrutura de novo
                  </button>
                )}
                <button type="button" className="button button-ghost" onClick={clearCollection}>
                  Voltar
                </button>
              </>
            )}
          </div>
        )}
      </section>
    </>
  );
}
