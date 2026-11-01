import { useState } from "react";
import Icon from "../components/Icon";
import { notify } from "../notifications/center";
import { Action, FocusSession } from "./api";
import ConfirmDialog from "./ConfirmDialog";
import { isBreak } from "./derive";
import { act, FocusActionError, useFocus } from "./store";

export async function runAction(action: Action, confirm = false) {
  try {
    await act(action, { confirm });
    return true;
  } catch (e) {
    const err = e as FocusActionError;
    notify({
      title: err.code === "focus_conflict" ? "A sessão mudou em outro lugar" : "Não foi possível concluir",
      body: err.code === "focus_conflict" ? "Mostramos o estado mais recente. Tente de novo se ainda fizer sentido." : err.message,
      tone: "neutral",
      essential: true,
    });
    return false;
  }
}

/** Botões da etapa atual. `compact`: só ícones (widget flutuante). */
export default function Controls({ session, compact = false }: { session: FocusSession; compact?: boolean }) {
  const { busy } = useFocus();
  const [confirmStop, setConfirmStop] = useState(false);
  if (isBreak(session.stage)) return null;
  const stopwatch = session.plan.focus_seconds == null;

  const primary =
    session.stage === "ready" ? (
      <button type="button" className="focus-btn focus-btn-primary" onClick={() => runAction("start_next")} disabled={!!busy}>
        <Icon name="play" size={compact ? 14 : 16} />
        {!compact && <span>Começar ciclo {session.cycle}</span>}
        {compact && <span className="sr-only">Começar ciclo {session.cycle}</span>}
      </button>
    ) : session.paused ? (
      <button type="button" className="focus-btn focus-btn-primary" onClick={() => runAction("resume")} disabled={!!busy}>
        <Icon name="play" size={compact ? 14 : 16} />
        <span className={compact ? "sr-only" : undefined}>Retomar</span>
      </button>
    ) : (
      <button type="button" className="focus-btn" onClick={() => runAction("pause")} disabled={!!busy}>
        <Icon name="pause" size={compact ? 14 : 16} />
        <span className={compact ? "sr-only" : undefined}>Pausar</span>
      </button>
    );

  return (
    <div className={`focus-controls ${compact ? "is-compact" : ""}`}>
      {primary}
      <button
        type="button"
        className="focus-btn focus-btn-quiet"
        onClick={() => (stopwatch && session.stage === "focus" ? runAction("stop") : setConfirmStop(true))}
        disabled={!!busy}
      >
        <Icon name="stop" size={compact ? 14 : 15} />
        <span className={compact ? "sr-only" : undefined}>{stopwatch ? "Concluir" : "Encerrar"}</span>
      </button>
      {confirmStop && (
        <ConfirmDialog
          title="Encerrar a sessão agora?"
          confirmLabel="Encerrar sessão"
          danger
          busy={busy === "stop"}
          onCancel={() => setConfirmStop(false)}
          onConfirm={async () => {
            if (await runAction("stop")) setConfirmStop(false);
          }}
        >
          <p>
            {session.stage === "focus"
              ? "O ciclo atual não será concluído. O tempo de foco que você já fez continua registrado, assim como os ciclos anteriores e o XP conquistado."
              : "Os ciclos que faltam não serão feitos. Tudo o que você já concluiu continua registrado."}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
