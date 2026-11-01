import { useState } from "react";
import Icon from "../components/Icon";
import { notify } from "../notifications/center";
import { Action, FocusSession } from "./api";
import ConfirmDialog from "./ConfirmDialog";
import { isBreak, isStopwatch } from "./derive";
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

/** O que acontece ao encerrar agora, dito antes da confirmação. */
export function stopMessage(session: FocusSession) {
  if (isStopwatch(session)) return "O tempo contado até aqui fica registrado no histórico.";
  return session.stage === "focus"
    ? "O ciclo atual não será concluído. O tempo de concentração já feito e os ciclos anteriores continuam registrados."
    : "Os ciclos que faltam não serão feitos. Tudo o que você já concluiu continua registrado.";
}

/** A ação principal da etapa: começar o ciclo, pausar ou retomar. */
export function primaryAction(session: FocusSession): { action: Action; label: string; icon: "play" | "pause" } | null {
  if (isBreak(session.stage)) return null;
  if (session.stage === "ready") return { action: "start_next", label: `Começar ciclo ${session.cycle}`, icon: "play" };
  if (session.paused) return { action: "resume", label: "Retomar", icon: "play" };
  return { action: "pause", label: "Pausar", icon: "pause" };
}

/** Botões da sessão na página Foco: ação principal em destaque e "Encerrar" ao lado. */
export default function Controls({ session }: { session: FocusSession }) {
  const { busy } = useFocus();
  const [confirmStop, setConfirmStop] = useState(false);
  const primary = primaryAction(session);
  const stopwatch = isStopwatch(session);
  // Cronômetro rodando: encerrar é o fim natural, sem perda; não pede confirmação.
  const needsConfirm = !(stopwatch && session.stage === "focus");

  return (
    <div className="fx-controls">
      {primary && (
        <button
          type="button"
          className={`button button-lg ${primary.action === "pause" ? "button-soft" : "button-primary"} fx-primary`}
          onClick={() => runAction(primary.action)}
          disabled={!!busy}
          aria-busy={busy === primary.action}
        >
          <Icon name={primary.icon} size={18} weight="fill" />
          {primary.label}
        </button>
      )}
      <button
        type="button"
        className="button button-lg fx-stop"
        onClick={() => (needsConfirm ? setConfirmStop(true) : runAction("stop"))}
        disabled={!!busy}
        aria-busy={busy === "stop"}
      >
        <Icon name="stop" size={18} />
        {stopwatch ? "Concluir" : "Encerrar"}
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
          <p>{stopMessage(session)}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
