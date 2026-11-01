import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { Link, paths } from "../router";
import { FocusSession } from "./api";
import Controls from "./Controls";
import CycleDots from "./CycleDots";
import { clock, duration, isBreak, readout, stageLabel } from "./derive";
import { setFocusMode } from "./focusMode";
import TimerRing from "./TimerRing";
import { useServerNow } from "./useNow";

type Mode = "compact" | "expanded" | "minimized";
const KEY = "teleaula:focus:widget";

function readMode(): Mode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "expanded" || v === "minimized" ? v : "compact";
  } catch {
    return "compact";
  }
}

export function toneOf(s: FocusSession): "focus" | "rest" | "ready" | "paused" {
  if (isBreak(s.stage)) return "rest";
  if (s.stage === "ready") return "ready";
  return s.paused ? "paused" : "focus";
}

/** Timer compacto que acompanha a navegação. Expande para os controles e minimiza para um ponto. */
export default function FloatingTimer({ session }: { session: FocusSession }) {
  const [mode, setMode] = useState<Mode>(readMode);
  const now = useServerNow(true);
  const r = readout(session, now);
  const tone = toneOf(session);
  const stopwatch = session.plan.focus_seconds == null;

  useEffect(() => {
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* modo privado */
    }
  }, [mode]);

  // Etapa nova (ex.: pausa acabou e o próximo ciclo está pronto): mostra de novo se estava minimizado.
  useEffect(() => {
    if (session.stage === "ready") setMode((m) => (m === "minimized" ? "compact" : m));
  }, [session.stage]);

  const time =
    session.stage === "ready" ? "Pronto" : stopwatch && session.stage === "focus" ? clock(r.elapsed) : clock(r.remaining ?? 0, { ceil: true });
  const label = stageLabel(session.stage, session.paused);

  if (mode === "minimized") {
    return (
      <button
        type="button"
        className={`ftimer-dot tone-${tone}`}
        onClick={() => setMode("compact")}
        aria-label={`Mostrar temporizador: ${label}, ${time}`}
        title={`${label} · ${time}`}
      >
        <TimerRing fraction={r.fraction} size={44} stroke={3} tone={tone}>
          <Icon name={session.paused ? "pause" : isBreak(session.stage) ? "leaf" : "timer"} size={16} />
        </TimerRing>
      </button>
    );
  }

  return (
    <aside className={`ftimer tone-${tone} ${mode === "expanded" ? "is-expanded" : ""}`} aria-label="Temporizador de estudos">
      <div className="ftimer-bar">
        <button
          type="button"
          className="ftimer-main"
          onClick={() => setMode(mode === "expanded" ? "compact" : "expanded")}
          aria-expanded={mode === "expanded"}
        >
          <TimerRing fraction={r.fraction} size={38} stroke={3} tone={tone} />
          <span className="ftimer-readout">
            <span className="ftimer-time" aria-live="off">
              {time}
            </span>
            <span className="ftimer-label">
              {label}
              {!stopwatch && session.stage !== "ready" && ` · ${session.cycle}/${session.cycles_total}`}
            </span>
          </span>
        </button>
        {mode !== "expanded" && session.stage === "ready" && <Controls session={session} compact />}
        <button type="button" className="ftimer-icon" onClick={() => setMode("minimized")} aria-label="Minimizar temporizador">
          <Icon name="minimize" size={15} />
        </button>
      </div>

      {mode === "expanded" && (
        <div className="ftimer-body">
          <div className="ftimer-meta">
            <span className="ftimer-method">{session.method_name}</span>
            <CycleDots session={session} />
          </div>
          {session.intention && <p className="ftimer-intention">“{session.intention}”</p>}
          {session.lesson && session.course && (
            <Link className="ftimer-link" to={paths.lesson(session.course.id, session.lesson.key)}>
              <Icon name="play" size={11} /> {session.lesson.title}
            </Link>
          )}
          {!session.lesson && session.course && (
            <Link className="ftimer-link" to={paths.course(session.course.id)}>
              <Icon name="library" size={13} /> {session.course.title}
            </Link>
          )}
          <dl className="ftimer-facts">
            <div>
              <dt>Foco na sessão</dt>
              <dd>{duration(r.focus)}</dd>
            </div>
            {session.next && session.next.stage !== "end" && (
              <div>
                <dt>Depois</dt>
                <dd>
                  {session.next.stage === "focus" ? `Ciclo ${session.next.cycle}` : session.next.stage === "long_break" ? "Pausa longa" : "Pausa"}
                  {session.next.seconds ? ` · ${duration(session.next.seconds)}` : ""}
                </dd>
              </div>
            )}
            {session.next?.stage === "end" && (
              <div>
                <dt>Depois</dt>
                <dd>Fim da sessão</dd>
              </div>
            )}
          </dl>
          {session.deadline_at && (session.stage === "ready" || session.paused) && (
            <p className="ftimer-note">Sem atividade, a sessão encerra em {duration(Math.max(0, session.deadline_at - now))}.</p>
          )}
          <Controls session={session} />
          <div className="ftimer-links">
            {session.stage !== "ready" && (
              <button type="button" className="link-button" onClick={() => setFocusMode(true)}>
                <Icon name="moon" size={14} /> Focus Mode
              </button>
            )}
            <Link to={paths.focus()} className="link-button">
              Abrir temporizador <Icon name="arrow" size={14} />
            </Link>
          </div>
        </div>
      )}
    </aside>
  );
}
