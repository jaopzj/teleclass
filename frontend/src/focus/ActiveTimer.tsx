import Icon from "../components/Icon";
import { Link, paths } from "../router";
import AmbientMini from "./AmbientMini";
import { EndedSummary, FocusSession } from "./api";
import Controls from "./Controls";
import { displayTime, duration, ENDED_LABEL, isStopwatch, nextLabel, readout, shortStage, toneOf } from "./derive";
import { dismissEnded } from "./store";
import Timeline, { timelineIndex } from "./Timeline";
import TimerRing from "./TimerRing";
import { useServerNow } from "./useNow";

/**
 * A visualização completa da sessão em andamento. Tudo vem do mesmo estado que
 * o temporizador flutuante usa: não há contagem própria aqui.
 */
export default function ActiveTimer({ session }: { session: FocusSession }) {
  const now = useServerNow(true);
  const r = readout(session, now);
  const tone = toneOf(session);
  const stopwatch = isStopwatch(session);
  const index = timelineIndex(session.timeline, session.stage, session.cycle);
  const time = displayTime(session, r);
  const stage = shortStage(session);
  const next = nextLabel(session);
  const sub =
    session.stage === "ready"
      ? "próximo bloco de concentração"
      : stopwatch
        ? "de concentração"
        : session.paused
          ? "restantes, contagem parada"
          : "restantes";

  return (
    <div className="fx-timer-grid">
      <section className={`surface fx-card fx-live tone-${tone}`} aria-labelledby="fx-live-title">
        <header className="fx-live-head">
          <h2 id="fx-live-title" className="fx-card-title">
            {session.method_name}
          </h2>
          <p className="fx-status">
            <span className="fx-dot" aria-hidden="true" />
            <span key={stage} className="fx-swap">
              {stage}
            </span>
            {!stopwatch && session.stage !== "ready" && (
              <span className="muted">
                · ciclo {session.cycle} de {session.cycles_total}
              </span>
            )}
          </p>
        </header>

        <TimerRing
          className="fx-live-ring"
          fraction={session.stage === "ready" ? 0 : stopwatch ? null : r.fraction}
          tone={tone}
          stroke={3}
          label={`${stage}: ${time}`}
        >
          <span className="fx-live-time tabular" aria-hidden="true">
            {time}
          </span>
          <span className="fx-live-sub">{sub}</span>
        </TimerRing>

        <Controls session={session} />

        {!stopwatch && (
          <Timeline steps={session.timeline} current={index != null && Number.isInteger(index) ? index : index != null ? Math.ceil(index) : undefined} progress={r.fraction ?? 0} />
        )}
      </section>

      <aside className="surface fx-card fx-live-side" aria-label="Detalhes da sessão">
        <h2 className="fx-card-title">Esta sessão</h2>
        <dl className="fx-details">
          <div>
            <dt>Concentração acumulada</dt>
            <dd className="tabular">{duration(r.focus)}</dd>
          </div>
          {!stopwatch && (
            <div>
              <dt>Ciclos concluídos</dt>
              <dd className="tabular">
                {session.cycles_completed} de {session.cycles_total}
              </dd>
            </div>
          )}
          {next && (
            <div>
              <dt>Próxima etapa</dt>
              <dd>{next}</dd>
            </div>
          )}
          <div>
            <dt>Início</dt>
            <dd className="tabular">{new Date(session.started_at * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</dd>
          </div>
        </dl>

        {(session.intention || session.course) && <hr className="fx-sep" />}
        {session.intention && (
          <div className="fx-detail-block">
            <span className="fx-label">Objetivo</span>
            <p>{session.intention}</p>
          </div>
        )}
        {session.course && (
          <div className="fx-detail-block">
            <span className="fx-label">Vinculada a</span>
            <Link className="fx-link-row" to={session.lesson ? paths.lesson(session.course.id, session.lesson.key) : paths.course(session.course.id)}>
              <Icon name={session.lesson ? "play" : "courses"} size={16} />
              <span>
                <strong>{session.lesson?.title ?? session.course.title}</strong>
                {session.lesson && <span className="muted">{session.course.title}</span>}
              </span>
              <Icon name="chevron" size={14} />
            </Link>
          </div>
        )}

        {session.deadline_at && (session.stage === "ready" || session.paused) && (
          <p className="fx-note" role="status">
            <Icon name="info" size={16} />
            Sem atividade, a sessão encerra sozinha em {duration(Math.max(0, session.deadline_at - now))}. O que já foi feito fica registrado.
          </p>
        )}

        <hr className="fx-sep" />
        <AmbientMini />
        <p className="fx-hint">Ao sair desta página, o temporizador continua no canto da tela.</p>
      </aside>
    </div>
  );
}

/** Resumo da última sessão encerrada, acima da preparação da próxima. */
export function EndedSummaryCard({ ended }: { ended: EndedSummary }) {
  const done = ended.status === "completed";
  return (
    <section className={`surface fx-ended ${done ? "is-done" : ""}`} role="status" aria-live="polite">
      <span className="fx-ended-icon" aria-hidden="true">
        <Icon name={done ? "checkCircle" : ended.status === "expired" ? "clock" : "stop"} size={22} weight={done ? "fill" : undefined} />
      </span>
      <div className="fx-ended-text">
        <strong>
          Sessão {ENDED_LABEL[ended.status].toLowerCase()}
          {ended.status === "expired" && " por inatividade"}
        </strong>
        <span>
          {ended.method_name} · {duration(ended.focus_seconds)} de concentração · {ended.cycles_completed}{" "}
          {ended.cycles_completed === 1 ? "ciclo concluído" : "ciclos concluídos"}
          {ended.cycles_invalidated > 0 && ` · ${ended.cycles_invalidated} sem validar`}
        </span>
      </div>
      <Link className="button button-ghost button-sm" to={paths.focus("historico")}>
        Ver no histórico
      </Link>
      <button type="button" className="icon-button icon-button-sm" onClick={dismissEnded} aria-label="Fechar resumo">
        <Icon name="close" size={16} />
      </button>
    </section>
  );
}
