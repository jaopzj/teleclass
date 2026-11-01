import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import { Link, paths } from "../router";
import { focusApi, HistoryItem, HistoryPage } from "./api";
import { duration, ENDED_LABEL } from "./derive";
import { previewTimeline } from "./MethodEditor";
import { useFocus } from "./store";
import { Select } from "./TargetPicker";

const REASONS: Record<string, string> = {
  user: "encerrada por você",
  plan_done: "plano completo",
  not_resumed: "o próximo ciclo não foi iniciado a tempo",
  paused_too_long: "ficou pausada tempo demais",
  break_unlocked: "pausa final interrompida",
  limit: "limite do cronômetro",
};
const OUTCOME: Record<string, string> = {
  completed: "concluída",
  stopped: "interrompida",
  expired: "expirou",
  unlocked: "interrompida antes da hora",
  invalidated: "não validada",
};
const PERIODS: [string, string][] = [
  ["", "Todo o período"],
  ["7", "Últimos 7 dias"],
  ["30", "Últimos 30 dias"],
  ["90", "Últimos 90 dias"],
];
// Ao filtrar por período, busca páginas até cobrir o intervalo (com um teto).
const MAX_AUTO_PAGES = 12;

function dayLabel(ts: number) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  const s = d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const time = (ts: number) => new Date(ts * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const titleOf = (i: HistoryItem) => i.lesson?.title ?? i.course?.title ?? i.intention ?? (i.custom_method ? i.method_name : i.technique_name);

/** Registro cronológico das sessões encerradas, com filtros e detalhes. */
export default function HistoryTab() {
  const { revision } = useFocus();
  const [technique, setTechnique] = useState("");
  const [course, setCourse] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const courses = useRef<HistoryPage["courses"]>([]);
  const cutoff = period ? Date.now() / 1000 - Number(period) * 86400 : null;

  async function fetchFrom(base: HistoryPage | null, auto: boolean) {
    let current = base;
    for (let i = 0; i < (auto ? MAX_AUTO_PAGES : 1); i++) {
      const next = await focusApi.history({ before: current?.next_before ?? null, technique: technique || null, course_id: course || null });
      if (next.courses.length) courses.current = next.courses;
      current = current ? { ...next, items: [...current.items, ...next.items] } : next;
      const oldest = current.items[current.items.length - 1]?.started_at;
      if (!auto || !current.next_before || cutoff == null || (oldest != null && oldest < cutoff)) break;
    }
    return current as HistoryPage;
  }

  useEffect(() => {
    let active = true;
    setError(null);
    setLoading(true);
    fetchFrom(null, cutoff != null)
      .then((p) => active && setPage(p))
      .catch((e: Error) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [technique, course, period, revision]);

  async function more() {
    if (!page?.next_before) return;
    setLoading(true);
    try {
      setPage(await fetchFrom(page, false));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const items = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pt-BR");
    return (page?.items ?? []).filter(
      (i) =>
        (cutoff == null || i.started_at >= cutoff) &&
        (!status || i.status === status) &&
        (!q || [i.intention, i.course?.title, i.lesson?.title, i.method_name].some((t) => t?.toLocaleLowerCase("pt-BR").includes(q))),
    );
  }, [page, cutoff, status, query]);

  const groups: [string, HistoryItem[]][] = [];
  for (const item of items) {
    const label = dayLabel(item.started_at);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(item);
    else groups.push([label, [item]]);
  }
  const filtered = !!(technique || course || period || status || query.trim());
  const reachedCutoff = cutoff != null && page && (page.items[page.items.length - 1]?.started_at ?? Infinity) < cutoff;
  const canLoadMore = !!page?.next_before && !reachedCutoff;

  return (
    <div className="fx-history">
      <div className="surface fx-filters" role="search" aria-label="Filtrar histórico">
        <div className="fx-search">
          <Icon name="search" size={18} />
          <label className="sr-only" htmlFor="fx-history-q">
            Buscar por objetivo ou conteúdo
          </label>
          <input id="fx-history-q" className="input fx-input" type="search" placeholder="Buscar por objetivo, curso ou aula" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select id="fx-f-period" label="Período" value={period} onChange={setPeriod} small>
          {PERIODS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select id="fx-f-tech" label="Técnica" value={technique} onChange={setTechnique} small>
          <option value="">Todas as técnicas</option>
          <option value="pomodoro">Pomodoro</option>
          <option value="52_17">52/17</option>
          <option value="deep_work">Deep Work</option>
          <option value="custom">Personalizado e métodos</option>
          <option value="stopwatch">Cronômetro livre</option>
        </Select>
        <Select id="fx-f-course" label="Curso" value={course} onChange={setCourse} small disabled={!courses.current.length}>
          <option value="">Todos os cursos</option>
          {courses.current.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title ?? c.id}
            </option>
          ))}
        </Select>
        <Select id="fx-f-status" label="Estado" value={status} onChange={setStatus} small>
          <option value="">Todos os estados</option>
          <option value="completed">Concluídas</option>
          <option value="stopped">Interrompidas</option>
          <option value="expired">Expiradas</option>
        </Select>
      </div>

      {error && (
        <div className="alert alert-error">
          Não foi possível carregar o histórico: {error}
        </div>
      )}
      {!page && !error && (
        <div className="fx-history-list" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="surface skeleton" style={{ height: 72 }} />
          ))}
        </div>
      )}
      {page && items.length === 0 && !canLoadMore && (
        <div className="empty">
          <span className="empty-icon">
            <Icon name="history" size={24} />
          </span>
          <h2>{filtered ? "Nada com esses filtros" : "Nenhuma sessão ainda"}</h2>
          <p>{filtered ? "Ajuste ou limpe os filtros para ver outras sessões." : "Cada sessão encerrada aparece aqui, com tempo, ciclos e como terminou."}</p>
          {!filtered && (
            <Link className="button button-primary" to={paths.focus()}>
              Começar uma sessão
            </Link>
          )}
        </div>
      )}

      <div className={`fx-history-days ${loading ? "is-stale" : ""}`}>
        {groups.map(([label, list]) => (
          <section key={label} className="fx-day" aria-label={label}>
            <h3>{label}</h3>
            <ul className="surface fx-history-list">
              {list.map((item) => (
                <HistoryRow key={item.id} item={item} open={open === item.id} onToggle={() => setOpen(open === item.id ? null : item.id)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {page && items.length === 0 && canLoadMore && <p className="fx-empty-inline">Nenhuma sessão com esses filtros entre as carregadas.</p>}
      {canLoadMore && (
        <button type="button" className="button fx-more" onClick={more} disabled={loading}>
          {loading ? "Carregando..." : "Carregar sessões mais antigas"}
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
  const planned = timed ? previewTimeline({
    focus_minutes: (item.plan.focus_seconds ?? 0) / 60,
    short_break_minutes: item.plan.short_break_seconds / 60,
    long_break_minutes: item.plan.long_break_seconds / 60,
    long_break_every: item.plan.long_break_every,
    cycles: item.cycles_total,
  }).reduce((a, s) => a + (s.seconds ?? 0), 0) : null;
  const method = item.custom_method ? item.method_name : item.technique_name;
  const title = titleOf(item);

  return (
    <li className={`fx-row is-${item.status} ${open ? "is-open" : ""}`}>
      <button type="button" className="fx-row-main" onClick={onToggle} aria-expanded={open}>
        <span className="fx-row-time tabular">{time(item.started_at)}</span>
        <span className="fx-row-what">
          <strong>{title}</strong>
          <span>
            {method}
            {timed && ` · ${item.cycles_completed} de ${item.cycles_total} ${item.cycles_total === 1 ? "ciclo" : "ciclos"}`}
          </span>
        </span>
        <span className="fx-row-focus tabular">{duration(item.focus_seconds)}</span>
        <span className="fx-row-status">
          {item.status === "completed" ? <Icon name="checkCircle" size={16} weight="fill" /> : <span className="fx-row-dot" aria-hidden="true" />}
          {ENDED_LABEL[item.status]}
        </span>
        <Icon name="down" size={14} className="fx-row-caret" />
      </button>
      <div className="fx-row-detail">
        <div>
          {open && (
            <div className="fx-row-inner">
              <dl className="fx-details is-grid">
                <div>
                  <dt>Início</dt>
                  <dd className="tabular">{time(item.started_at)}</dd>
                </div>
                <div>
                  <dt>Término</dt>
                  <dd className="tabular">{item.ended_at ? time(item.ended_at) : "—"}</dd>
                </div>
                <div>
                  <dt>Duração planejada</dt>
                  <dd>{planned != null ? duration(planned) : "Livre"}</dd>
                </div>
                <div>
                  <dt>Concentração efetiva</dt>
                  <dd>{duration(item.focus_seconds)}</dd>
                </div>
                <div>
                  <dt>Descanso</dt>
                  <dd>{duration(item.break_seconds)}</dd>
                </div>
                <div>
                  <dt>Tempo pausado</dt>
                  <dd>{duration(item.pause_seconds)}</dd>
                </div>
                <div>
                  <dt>Técnica</dt>
                  <dd>{item.technique_name}</dd>
                </div>
                {item.custom_method && (
                  <div>
                    <dt>Método</dt>
                    <dd>{item.method_name}</dd>
                  </div>
                )}
                {timed && (
                  <div>
                    <dt>Ciclos concluídos</dt>
                    <dd>
                      {item.cycles_completed} de {item.cycles_total}
                      {item.cycles_invalidated > 0 && ` · ${item.cycles_invalidated} não validado${item.cycles_invalidated > 1 ? "s" : ""}`}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Estado final</dt>
                  <dd>
                    {ENDED_LABEL[item.status]}
                    {item.end_reason && REASONS[item.end_reason] ? <span className="muted"> · {REASONS[item.end_reason]}</span> : null}
                  </dd>
                </div>
              </dl>
              {item.intention && (
                <div className="fx-detail-block">
                  <span className="fx-label">Objetivo</span>
                  <p>{item.intention}</p>
                </div>
              )}
              {item.course && (
                <div className="fx-detail-block">
                  <span className="fx-label">{item.lesson ? "Curso e aula" : "Curso"}</span>
                  <Link className="fx-link-row" to={item.lesson ? paths.lesson(item.course.id, item.lesson.key) : paths.course(item.course.id)}>
                    <Icon name={item.lesson ? "play" : "courses"} size={16} />
                    <span>
                      <strong>{item.lesson?.title ?? item.course.title}</strong>
                      {item.lesson && <span className="muted">{item.course.title}</span>}
                    </span>
                    <Icon name="chevron" size={14} />
                  </Link>
                </div>
              )}
              {detail?.phases && detail.phases.length > 0 && (
                <div className="fx-detail-block">
                  <span className="fx-label">Etapas</span>
                  <ol className="fx-phases">
                    {detail.phases.map((p) => (
                      <li key={p.idx} className={`fx-phase is-${p.stage === "focus" ? "focus" : "break"} outcome-${p.outcome}`}>
                        <span className="fx-phase-name">{p.stage === "focus" ? `Concentração ${p.cycle}` : p.stage === "long_break" ? "Pausa longa" : "Pausa"}</span>
                        <span className="tabular muted">
                          {time(p.started_at)} · {duration(p.stage === "focus" ? p.focus_seconds : p.ended_at - p.started_at)}
                          {p.pause_seconds > 0 && ` · ${duration(p.pause_seconds)} pausado`}
                        </span>
                        <span className="fx-phase-outcome">{OUTCOME[p.outcome] ?? p.outcome}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
