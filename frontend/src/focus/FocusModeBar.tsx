import { useEffect } from "react";
import Icon from "../components/Icon";
import { FocusSession } from "./api";
import AmbientControl from "./AmbientControl";
import { runAction } from "./Controls";
import { clock, readout, stageLabel } from "./derive";
import { setFocusMode } from "./focusMode";
import { toneOf } from "./FloatingTimer";
import { useFocus } from "./store";
import { useServerNow } from "./useNow";

/** Faixa mínima do Focus Mode: substitui menus e barras enquanto o modo estiver ligado. */
export default function FocusModeBar({ session }: { session: FocusSession }) {
  const now = useServerNow(true);
  const { busy } = useFocus();
  const r = readout(session, now);
  const stopwatch = session.plan.focus_seconds == null;
  const time =
    session.stage === "ready" ? "Pronto" : stopwatch ? clock(r.elapsed) : clock(r.remaining ?? 0, { ceil: true });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector(".dialog-backdrop")) setFocusMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`fbar tone-${toneOf(session)}`} role="region" aria-label="Focus Mode">
      <div className="fbar-time">
        <span className="fbar-dot" aria-hidden="true" />
        <strong>{time}</strong>
        <span className="fbar-stage">{stageLabel(session.stage, session.paused)}</span>
      </div>
      {session.intention && <p className="fbar-intention">{session.intention}</p>}
      <div className="fbar-actions">
        <AmbientControl />
        {session.stage === "focus" && (
          <button
            type="button"
            className="fbar-btn"
            onClick={() => runAction(session.paused ? "resume" : "pause")}
            disabled={!!busy}
            aria-label={session.paused ? "Retomar" : "Pausar"}
          >
            <Icon name={session.paused ? "play" : "pause"} size={15} />
          </button>
        )}
        {session.stage === "ready" && (
          <button type="button" className="fbar-btn is-primary" onClick={() => runAction("start_next")} disabled={!!busy}>
            <Icon name="play" size={13} /> <span className="fbar-btn-label">Ciclo {session.cycle}</span>
          </button>
        )}
        <button type="button" className="fbar-btn" onClick={() => setFocusMode(false)} title="Sair do Focus Mode (Esc)">
          <Icon name="close" size={15} /> <span className="fbar-btn-label">Sair</span>
        </button>
      </div>
    </div>
  );
}
