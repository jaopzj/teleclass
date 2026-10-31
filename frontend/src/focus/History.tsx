import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { Link, paths } from "../router";
import { focusApi, HistoryItem, HistoryPage } from "./api";
import { duration } from "./derive";
import { useFocus } from "./store";

const STATUS: Record<HistoryItem["status"], string> = { completed: "Concluída", stopped: "Encerrada", expired: "Expirou" };
const REASONS: Record<string, string> = {
  user: "encerrada por você",
  plan_done: "plano completo",
  not_resumed: "o próximo ciclo não foi iniciado",
  paused_too_long: "ficou pausada tempo demais",
  break_unlocked: "pausa final desbloqueada",
  limit: "limite do cronômetro",
};
const OUTCOME: Record<string, string> = {
  completed: "concluída",
  stopped: "interrompida",
  expired: "expirou",
  unlocked: "desbloqueada antes da hora",
  invalidated: "invalidada (pausa desbloqueada)",
};

function dayLabel(ts: number) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
}

const time = (ts: number) => new Date(ts * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Histórico completo de sessões, com filtros e detalhes das etapas. */
export default function HistoryTab() {
  const { revision } = useFocus();
  const [technique, setTechnique] = useState("");
  const [course, setCourse] = useState("");
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    focusApi
      .history({ technique: technique || null, course_id: course || null })
      .then((p) => active && setPage(p))
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [technique, course, revision]);

  async function more() {
    if (!page?.next_before) return;
    setLoadingMore(true);
    try {
      const next = await focusApi.history({ before: page.next_before, technique: technique || null, course_id: course || null });
      setPage({ ...next, items: [...page.items, ...next.items], courses: page.courses });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const groups: [string, HistoryItem[]][] = [];
  for (const item of page?.items ?? []) {
    const label = dayLabel(item.started_at);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(item);
    else groups.push([label, [item]]);
  }

  return (
    <div className="history">
      <div className="section-head">
        <div>
          <h2>Histórico</h2>
          <p className="muted small">Todas as sessões encerradas, da mais recente para a mais antiga.</p>
        </div>
        <div className="history-filters">
          <select className="select select-sm" value={technique} onChange={(e) => setTechnique(e.target.value)} aria-label="Filtrar por técnica">
            <option value="">Todas as técnicas</option>
            <option value="pomodoro">Pomodoro</option>
            <option value="52_17">52/17</option>
            <option value="deep_work">Deep Work</option>
            <option value="custom">Personalizado e métodos</option>
            <option value="stopwatch">Cronômetro livre</option>
          </select>
          {page && page.courses.length > 0 && (
            <select className="select select-sm" value={course} onChange={(e) => setCourse(e.target.value)} aria-label="Filtrar por curso">
              <option value="">Todos os cursos</option>
              {page.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title ?? c.id}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">Não foi possível carregar o histórico: {error}</div>}
      {!page && !error && (
        <div className="history-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 64, borderRadius: 12, marginBottom: 8 }} />
          ))}
        </div>
      )}
      {page && page.items.length === 0 && (
        <div className="empty">
          <Icon name="history" size={28} />
          <h2>{technique || course ? "Nada com esses filtros" : "Nenhuma sessão ainda"}</h2>
          <p>{technique || course ? "Tente outra técnica ou outro curso." : "Suas sessões aparecem aqui assim que terminarem."}</p>
        </div>
      )}
      {groups.map(([label, items]) => (
        <section key={label} className="history-day">
          <h3>{label}</h3>
          <ul className="history-list">
            {items.map((item) => (
              <HistoryRow key={item.id} item={item} open={open === item.id} onToggle={() => setOpen(open === item.id ? null : item.id)} />
            ))}
          </ul>
        </section>
      ))}
      {page?.next_before && (
        <button type="button" className="button history-more" onClick={more} disabled={loadingMore}>
          {loadingMore ? "Carregando..." : "Carregar mais"}
        </button>
      )}
    </div>
  );
}

function HistoryRow({ item, open, onToggle }: { item: HistoryItem; open: boolean; onToggle: () => void }) {
  const [detail, setDetail] = useState<HistoryItem | null>(null);
  useEffect(() => {
    if (open && !detail) focusApi.historyItem(item.id).then(setDetail).catch(() => undefined);
  }, [open, detail, item.id]);
  const timed = item.plan.focus_seconds != null;
  return (
    <li className={`hrow status-${item.status} ${open ? "is-open" : ""}`}>
      <button type="button" className="hrow-main" onClick={onToggle} aria-expanded={open}>
        <span className="hrow-time">
          {time(item.started_at)}
          {item.ended_at && <span className="muted"> – {time(item.ended_at)}</span>}
        </span>
        <span className="hrow-what">
          <strong>{item.custom_method ? item.method_name : item.technique_name}</strong>
          <span className="muted">
            {item.lesson?.title ?? item.course?.title ?? item.intention ?? "Sem curso vinculado"}
          </span>
        </span>
        {timed && (
          <span className="hrow-cycles" aria-label={`${item.cycles_completed} de ${item.cycles_total} ciclos`}>
            {Array.from({ length: item.cycles_total }, (_, i) => (
              <i key={i} className={i < item.cycles_completed ? "is-done" : i < item.cycles_completed + item.cycles_invalidated ? "is-void" : ""} />
            ))}
          </span>
        )}
        <span className="hrow-focus">{duration(item.focus_seconds)}</span>
        <span className={`hrow-status`}>{STATUS[item.status]}</span>
        <span className="hrow-xp">{item.xp > 0 ? `+${item.xp} XP` : "—"}</span>
      </button>
      {open && (
        <div className="hrow-detail">
          <dl className="hrow-facts">
            <div>
              <dt>Foco</dt>
              <dd>{duration(item.focus_seconds)}</dd>
            </div>
            <div>
              <dt>Pausas</dt>
              <dd>{duration(item.break_seconds)}</dd>
            </div>
            <div>
              <dt>Tempo pausado</dt>
              <dd>{duration(item.pause_seconds)}</dd>
            </div>
            <div>
              <dt>Sessão inteira</dt>
              <dd>{duration(item.total_seconds)}</dd>
            </div>
            {timed && (
              <div>
                <dt>Ciclos</dt>
                <dd>
                  {item.cycles_completed} de {item.cycles_total}
                  {item.cycles_invalidated > 0 && ` · ${item.cycles_invalidated} invalidado(s)`}
                </dd>
              </div>
            )}
            <div>
              <dt>Resultado</dt>
              <dd>
                {STATUS[item.status]}
                {item.end_reason && REASONS[item.end_reason] ? ` (${REASONS[item.end_reason]})` : ""}
              </dd>
            </div>
          </dl>
          {item.intention && <p className="hrow-intention">Objetivo: {item.intention}</p>}
          {item.course && (
            <p className="hrow-link">
              {item.lesson ? (
                <Link to={paths.lesson(item.course.id, item.lesson.key)}>
                  {item.lesson.title} · {item.course.title}
                </Link>
              ) : (
                <Link to={paths.course(item.course.id)}>{item.course.title}</Link>
              )}
            </p>
          )}
          {detail?.phases && detail.phases.length > 0 && (
            <ol className="phases">
              {detail.phases.map((p) => (
                <li key={p.idx} className={`phase phase-${p.stage} outcome-${p.outcome}`}>
                  <span className="phase-name">{p.stage === "focus" ? `Foco ${p.cycle}` : p.stage === "long_break" ? "Pausa longa" : "Pausa"}</span>
                  <span className="muted">
                    {time(p.started_at)} · {duration(p.stage === "focus" ? p.focus_seconds : p.ended_at - p.started_at)}
                    {p.pause_seconds > 0 && ` · ${duration(p.pause_seconds)} pausado`}
                  </span>
                  <span className="phase-outcome">{OUTCOME[p.outcome] ?? p.outcome}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}
