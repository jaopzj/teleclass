import { useEffect } from "react";
import Icon from "../components/Icon";
import { Link, paths } from "../router";
import { EndedSummary, FocusSession } from "./api";
import AmbientControl from "./AmbientControl";
import Controls from "./Controls";
import CycleDots from "./CycleDots";
import { clock, duration, isBreak, readout, stageLabel } from "./derive";
import { toneOf } from "./FloatingTimer";
import { setFocusMode, useFocusModePreference } from "./focusMode";
import { dismissEnded } from "./store";
import Timeline, { timelineIndex } from "./Timeline";
import TimerRing from "./TimerRing";
import { useServerNow } from "./useNow";

/** O temporizador em destaque na seção de foco (e em tela cheia no Focus Mode). */
export default function ActiveTimer({ session }: { session: FocusSession }) {
  const now = useServerNow(true);
  const r = readout(session, now);
  const tone = toneOf(session);
  const focusMode = useFocusModePreference();
  const stopwatch = session.plan.focus_seconds == null;
  const index = timelineIndex(session.timeline, session.stage, session.cycle);
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector(".dialog-backdrop")) setFocusMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode]);
  const big =
    session.stage === "ready" ? clock(session.plan.focus_seconds ?? 0) : stopwatch ? clock(r.elapsed) : clock(r.remaining ?? 0, { ceil: true });

  return (
    <div className={`active tone-${tone} ${focusMode ? "is-immersive" : ""}`}>
      {focusMode && (
        <div className="immersive-top">
          <span className="immersive-brand">
            <Icon name="moon" size={14} /> Focus Mode
          </span>
          <button type="button" className="fbar-btn" onClick={() => setFocusMode(false)}>
            <Icon name="close" size={15} /> <span className="fbar-btn-label">Sair</span>
          </button>
        </div>
      )}
      <div className="active-head">
        <p className="active-method">
          {session.method_name}
          {!stopwatch && (
            <span>
              {" "}
              · ciclo {session.cycle} de {session.cycles_total}
            </span>
          )}
        </p>
        {session.intention && <p className="active-intention">{session.intention}</p>}
      </div>

      <TimerRing fraction={session.stage === "ready" ? 0 : r.fraction} size={focusMode ? 360 : 300} stroke={focusMode ? 5 : 6} tone={tone} label={`${stageLabel(session.stage, session.paused)}: ${big}`}>
        <span className="active-stage">{stageLabel(session.stage, session.paused)}</span>
        <span className="active-time">{big}</span>
        <span className="active-sub">
          {session.stage === "ready"
            ? "a próxima concentração"
            : stopwatch
              ? "de foco nesta sessão"
              : session.next?.stage === "end"
                ? "para o fim da sessão"
                : isBreak(session.next?.stage as never)
                  ? `depois, ${session.next?.stage === "long_break" ? "pausa longa" : "pausa"} de ${duration(session.next?.seconds ?? 0)}`
                  : "restantes"}
        </span>
      </TimerRing>

      <CycleDots session={session} />
      {!stopwatch && <Timeline steps={session.timeline} current={index != null && Number.isInteger(index) ? index : undefined} progress={r.fraction ?? 0} compact />}

      <Controls session={session} />

      <div className="active-foot">
        {session.lesson && session.course ? (
          <Link className="active-link" to={paths.lesson(session.course.id, session.lesson.key)}>
            <Icon name="play" size={11} /> {session.lesson.title}
            <span className="muted"> · {session.course.title}</span>
          </Link>
        ) : session.course ? (
          <Link className="active-link" to={paths.course(session.course.id)}>
            <Icon name="library" size={14} /> {session.course.title}
          </Link>
        ) : (
          <span className="muted small">Sessão sem curso vinculado</span>
        )}
        <span className="active-total">
          <Icon name="target" size={14} /> {duration(r.focus)} de foco
        </span>
        {!focusMode && session.stage !== "ready" && (
          <button type="button" className="link-button" onClick={() => setFocusMode(true)}>
            <Icon name="moon" size={14} /> Focus Mode
          </button>
        )}
      </div>
      {session.deadline_at && (session.stage === "ready" || session.paused) && (
        <p className="active-note">Sem atividade, a sessão encerra sozinha em {duration(Math.max(0, session.deadline_at - now))}. O que já foi feito fica registrado.</p>
      )}
      {focusMode && (
        <div className="immersive-sound">
          <AmbientControl />
        </div>
      )}
    </div>
  );
}

const STATUS_TEXT: Record<EndedSummary["status"], string> = {
  completed: "Sessão concluída",
  stopped: "Sessão encerrada",
  expired: "Sessão encerrada por inatividade",
};

/** Resumo depois de encerrar. */
export function EndedCard({ ended }: { ended: EndedSummary }) {
  return (
    <div className={`ended ended-${ended.status}`} role="status">
      <span className="ended-icon">
        <Icon name={ended.status === "completed" ? "check" : "stop"} size={18} />
      </span>
      <div className="ended-text">
        <strong>{STATUS_TEXT[ended.status]}</strong>
        <span>
          {duration(ended.focus_seconds)} de foco · {ended.cycles_completed} {ended.cycles_completed === 1 ? "ciclo concluído" : "ciclos concluídos"}
          {ended.cycles_invalidated > 0 && ` · ${ended.cycles_invalidated} invalidado${ended.cycles_invalidated > 1 ? "s" : ""}`}
          {ended.xp > 0 && ` · +${ended.xp} XP`}
        </span>
      </div>
      <button type="button" className="ftimer-icon" onClick={dismissEnded} aria-label="Fechar resumo">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
