import { FocusSession } from "./api";
import { isBreak } from "./derive";

/** Um ponto por ciclo: passados, o atual (foco ou aguardando a pausa terminar) e os que faltam. */
export default function CycleDots({ session }: { session: FocusSession }) {
  if (session.plan.focus_seconds == null) return null;
  return (
    <ol className="cycle-dots" aria-label={`Ciclo ${session.cycle} de ${session.cycles_total}`}>
      {Array.from({ length: session.cycles_total }, (_, i) => {
        const n = i + 1;
        let cls = n < session.cycle ? "is-done" : "is-future";
        if (n === session.cycle && session.stage === "focus") cls = "is-current";
        if (n === session.cycle && isBreak(session.stage)) cls = "is-pending";
        return <li key={n} className={cls} />;
      })}
    </ol>
  );
}
