// Agenda: lista, dia, semana e mês sobre a mesma data selecionada (na URL), para
// trocar de visualização sem perder o contexto.
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import { useResource } from "../hooks/useResource";
import { AgendaDay, Occurrence, routineApi, Status } from "./api";
import { addDays, addMonths, longDay, monthOf, monthTitle, monthWeeks, relativeDay, WEEKDAY_SHORT, weekDays, weekTitle } from "./dates";
import DayView from "./DayView";
import { busyLevel, minutesLabel, STATUS_LABEL } from "./domain";
import { occurrenceColor, STATUS_ICON, tone } from "./parts";
import { useRoutineRevision } from "./session";

export type AgendaMode = "lista" | "dia" | "semana" | "mes";
export const AGENDA_MODES: { key: AgendaMode; label: string }[] = [
  { key: "lista", label: "Lista" },
  { key: "dia", label: "Dia" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
];

export default function Agenda({
  date,
  today,
  mode,
  onChange,
  addSignal,
  applySignal,
}: {
  date: string;
  today: string;
  mode: AgendaMode;
  onChange: (next: { date?: string; mode?: AgendaMode }) => void;
  addSignal: number;
  applySignal: number;
}) {
  const step = (delta: number) => {
    if (mode === "dia") onChange({ date: addDays(date, delta) });
    else if (mode === "semana") onChange({ date: addDays(date, 7 * delta) });
    else if (mode === "mes") onChange({ date: addMonths(date, delta) });
    else onChange({ date: addDays(date, 14 * delta) });
  };
  const title = mode === "dia" ? longDay(date) : mode === "semana" ? weekTitle(date) : mode === "mes" ? monthTitle(date) : `A partir de ${relativeDay(date, today).toLowerCase()}`;
  const unit = { dia: "dia", semana: "semana", mes: "mês", lista: "período" }[mode];

  return (
    <div className="rt-agenda">
      <div className="rt-toolbar">
        <div className="rt-toolbar-nav">
          <button type="button" className="icon-button" onClick={() => step(-1)} aria-label={`${unit === "semana" ? "Semana" : unit === "mês" ? "Mês" : unit === "dia" ? "Dia" : "Período"} anterior`}>
            <Icon name="left" size={18} />
          </button>
          <button type="button" className="icon-button" onClick={() => step(1)} aria-label={`Próximo ${unit}`}>
            <Icon name="right" size={18} />
          </button>
          <h2 className="rt-toolbar-title" aria-live="polite">
            {title}
          </h2>
          {date !== today && (
            <button type="button" className="button button-sm" onClick={() => onChange({ date: today })}>
              Hoje
            </button>
          )}
        </div>
        <div className="rt-seg rt-modes" role="radiogroup" aria-label="Visualização">
          {AGENDA_MODES.map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} onClick={() => onChange({ mode: m.key })}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="rt-agenda-panel" key={mode}>
        {mode === "dia" && <DayView date={date} compact addSignal={addSignal} applySignal={applySignal} />}
        {mode === "semana" && <WeekView date={date} today={today} onOpen={(d) => onChange({ date: d, mode: "dia" })} />}
        {mode === "mes" && <MonthView date={date} today={today} onOpen={(d) => onChange({ date: d, mode: "dia" })} />}
        {mode === "lista" && <ListView date={date} today={today} onOpen={(d) => onChange({ date: d, mode: "dia" })} />}
      </div>
    </div>
  );
}

function useRange(from: string, to: string) {
  const revision = useRoutineRevision();
  return useResource(`rt-agenda:${from}:${to}:${revision}`, () => routineApi.agenda(from, to));
}

function LoadError({ reload }: { reload: () => void }) {
  return (
    <div className="empty empty-compact">
      <h2>Não foi possível carregar a agenda</h2>
      <p>Verifique a conexão e tente de novo.</p>
      <button type="button" className="button button-primary" onClick={reload}>
        Tentar de novo
      </button>
    </div>
  );
}

const StatusGlyph = ({ status }: { status: Status }) =>
  STATUS_ICON[status] ? <Icon name={STATUS_ICON[status]!} size={11} weight="bold" /> : status === "in_progress" ? <Icon name="play" size={10} /> : null;

function Chip({ o }: { o: Occurrence }) {
  return (
    <li className={`rt-mini is-${o.status}`} style={tone(occurrenceColor(o))} title={`${o.title} — ${STATUS_LABEL[o.status]}`}>
      <span className="rt-mini-mark" aria-hidden="true">
        <StatusGlyph status={o.status} />
      </span>
      <span className="rt-mini-time tabular">{o.start_time ?? ""}</span>
      <span className="rt-mini-title">{o.title}</span>
      <span className="sr-only">{STATUS_LABEL[o.status]}</span>
    </li>
  );
}

// --- semana -----------------------------------------------------------------------------

const MAX_WEEK_ITEMS = 6;

function WeekView({ date, today, onOpen }: { date: string; today: string; onOpen: (d: string) => void }) {
  const days = weekDays(date);
  const { data, error, reload } = useRange(days[0], days[6]);
  if (error && !data) return <LoadError reload={reload} />;
  const byDate = new Map((data?.days ?? []).map((d) => [d.date, d]));
  return (
    <div className={`rt-week surface ${!data ? "is-loading" : ""}`}>
      {days.map((d, i) => {
        const day = byDate.get(d);
        const items = day?.occurrences ?? [];
        const level = busyLevel(day?.summary.planned_minutes ?? 0, items.length);
        return (
          <section key={d} className={`rt-week-day ${d === today ? "is-today" : ""} ${d === date ? "is-selected" : ""}`} aria-label={longDay(d)}>
            <button type="button" className="rt-week-head" onClick={() => onOpen(d)} aria-label={`Abrir ${longDay(d)}`}>
              <span className="rt-week-dow">{WEEKDAY_SHORT[i]}</span>
              <span className="rt-week-num tabular">{Number(d.slice(8))}</span>
            </button>
            <div className={`rt-busy is-${level}`} title={level === 0 ? "Livre" : level === 1 ? "Leve" : level === 2 ? "Moderado" : "Cheio"} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            {!data ? (
              <div className="skeleton rt-skel-mini" />
            ) : items.length ? (
              <ul className="rt-mini-list">
                {items.slice(0, MAX_WEEK_ITEMS).map((o) => (
                  <Chip key={o.id} o={o} />
                ))}
                {items.length > MAX_WEEK_ITEMS && (
                  <li>
                    <button type="button" className="rt-more-link" onClick={() => onOpen(d)}>
                      +{items.length - MAX_WEEK_ITEMS} {items.length - MAX_WEEK_ITEMS === 1 ? "atividade" : "atividades"}
                    </button>
                  </li>
                )}
              </ul>
            ) : (
              <p className="rt-week-free">Livre</p>
            )}
            {day && day.summary.planned_minutes > 0 && <p className="rt-week-total tabular">{minutesLabel(day.summary.planned_minutes)}</p>}
          </section>
        );
      })}
    </div>
  );
}

// --- mês ------------------------------------------------------------------------------------

function MonthView({ date, today, onOpen }: { date: string; today: string; onOpen: (d: string) => void }) {
  const weeks = monthWeeks(date);
  const { data, error, reload } = useRange(weeks[0][0], weeks[weeks.length - 1][6]);
  const grid = useRef<HTMLDivElement>(null);
  if (error && !data) return <LoadError reload={reload} />;
  const byDate = new Map((data?.days ?? []).map((d) => [d.date, d]));
  const month = monthOf(date);

  // Setas do teclado andam pelos dias (grade de calendário).
  const onKey = (e: React.KeyboardEvent) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!delta) return;
    const current = (document.activeElement as HTMLElement)?.dataset.date;
    if (!current) return;
    e.preventDefault();
    grid.current?.querySelector<HTMLElement>(`[data-date="${addDays(current, delta)}"]`)?.focus();
  };

  return (
    <div className={`rt-month surface ${!data ? "is-loading" : ""}`} ref={grid} onKeyDown={onKey}>
      <div className="rt-month-dows" aria-hidden="true">
        {WEEKDAY_SHORT.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="rt-month-grid" role="grid" aria-label={monthTitle(date)}>
        {weeks.map((week) => (
          <div key={week[0]} role="row" className="rt-month-row">
            {week.map((d) => {
              const day = byDate.get(d);
              const items = (day?.occurrences ?? []).filter((o) => o.status !== "cancelled");
              const outside = monthOf(d) !== month;
              const progress = day?.summary.progress;
              return (
                <button
                  key={d}
                  role="gridcell"
                  type="button"
                  data-date={d}
                  tabIndex={d === date ? 0 : -1}
                  className={`rt-month-cell ${outside ? "is-outside" : ""} ${d === today ? "is-today" : ""} ${d === date ? "is-selected" : ""}`}
                  onClick={() => onOpen(d)}
                  aria-label={`${longDay(d)}: ${items.length ? `${items.length} ${items.length === 1 ? "atividade" : "atividades"}` : "sem atividades"}`}
                >
                  <span className="rt-month-num tabular">{Number(d.slice(8))}</span>
                  {items.length > 0 && (
                    <span className="rt-month-dots" aria-hidden="true">
                      {items.slice(0, 4).map((o) => (
                        <i key={o.id} className={`is-${o.status}`} style={tone(occurrenceColor(o))} />
                      ))}
                      {items.length > 4 && <small>+{items.length - 4}</small>}
                    </span>
                  )}
                  {progress != null && (
                    <span className="rt-month-bar" aria-hidden="true">
                      <span style={{ width: `${Math.round(progress * 100)}%` }} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- lista ------------------------------------------------------------------------------------

const CHUNK = 14;
const STATUS_FILTERS: { key: "all" | Status | "open"; label: string }[] = [
  { key: "all", label: "Todos os status" },
  { key: "open", label: "Pendentes e em andamento" },
  { key: "completed", label: "Concluídas" },
  { key: "skipped", label: "Puladas" },
  { key: "cancelled", label: "Canceladas" },
];

function ListView({ date, today, onOpen }: { date: string; today: string; onOpen: (d: string) => void }) {
  const [chunks, setChunks] = useState(1);
  const [routine, setRoutine] = useState("all");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["key"]>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => setChunks(1), [date]);
  const end = addDays(date, CHUNK * chunks - 1);
  const { data, error, loading, reload } = useRange(date, end);
  const sentinel = useRef<HTMLDivElement>(null);

  // Carregamento progressivo: chegar ao fim da lista traz as próximas duas semanas.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || loading || chunks >= 4) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && setChunks((c) => c + 1), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loading, chunks, data]);

  const routines = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of data?.days ?? []) for (const o of d.occurrences) if (o.routine) map.set(o.routine.id, o.routine.name);
    return [...map];
  }, [data]);

  const match = (o: Occurrence) =>
    (routine === "all" || (routine === "none" ? !o.routine : o.routine?.id === routine)) &&
    (status === "all" || (status === "open" ? o.status === "pending" || o.status === "in_progress" : o.status === status));
  const days: AgendaDay[] = (data?.days ?? []).map((d) => ({ ...d, occurrences: d.occurrences.filter(match) })).filter((d) => d.occurrences.length);

  if (error && !data) return <LoadError reload={reload} />;

  return (
    <div className="rt-list">
      <div className="rt-filters">
        <label>
          <span className="sr-only">Rotina</span>
          <select className="rt-input rt-input-sm" value={routine} onChange={(e) => setRoutine(e.target.value)}>
            <option value="all">Todas as rotinas</option>
            <option value="none">Atividades avulsas</option>
            {routines.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select className="rt-input rt-input-sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {STATUS_FILTERS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!data && (
        <div className="surface rt-list-group">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton rt-skel-row" />
          ))}
        </div>
      )}
      {data && !days.length && (
        <div className="empty empty-compact">
          <h2>Nada {routine !== "all" || status !== "all" ? "com esses filtros" : "planejado"} até {longDay(end).toLowerCase()}</h2>
          <p>Use “Adicionar atividade” ou aplique uma rotina a um dia.</p>
        </div>
      )}
      {days.map((d) => (
        <section key={d.date} className="surface rt-list-group" aria-labelledby={`rt-list-${d.date}`}>
          <header className="rt-list-head">
            <h3 id={`rt-list-${d.date}`}>
              <button type="button" onClick={() => onOpen(d.date)}>
                {relativeDay(d.date, today)}
                {Math.abs(new Date(`${d.date}T12:00Z`).getTime() - new Date(`${today}T12:00Z`).getTime()) <= 86_400_000 && <small>{longDay(d.date)}</small>}
              </button>
            </h3>
            {d.summary.planned > 0 && (
              <span className="rt-list-count tabular">
                {d.summary.completed}/{d.summary.planned}
              </span>
            )}
          </header>
          <ul className="rt-list-items">
            {d.occurrences.map((o) => (
              <li key={o.id} className={`rt-list-item is-${o.status}`} style={tone(occurrenceColor(o))}>
                <button type="button" className="rt-list-row" aria-expanded={expanded === o.id} onClick={() => setExpanded((v) => (v === o.id ? null : o.id))}>
                  <span className="rt-list-time tabular">{o.start_time ?? "—"}</span>
                  <span className="rt-mini-mark" aria-hidden="true">
                    <StatusGlyph status={o.status} />
                  </span>
                  <span className="rt-list-title">{o.title}</span>
                  <span className="rt-list-meta">
                    {o.duration_minutes ? minutesLabel(o.duration_minutes) : ""}
                    <span className={`rt-status is-${o.status}`}>{STATUS_LABEL[o.status]}</span>
                  </span>
                </button>
                {expanded === o.id && (
                  <div className="rt-list-detail">
                    {o.routine && <p>Rotina: {o.routine.name}</p>}
                    {o.link && <p>Conteúdo: {o.link.available ? [o.link.course_title, o.link.lesson_title ?? o.link.module_title].filter(Boolean).join(" › ") : "indisponível"}</p>}
                    {o.description && <p>{o.description}</p>}
                    {o.invested_seconds > 0 && <p>Tempo registrado: {minutesLabel(Math.max(1, Math.round(o.invested_seconds / 60)))}</p>}
                    <button type="button" className="button button-sm button-soft" onClick={() => onOpen(d.date)}>
                      Abrir o dia
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div ref={sentinel} />
      {data && (
        <button type="button" className="button rt-list-more" onClick={() => setChunks((c) => c + 1)} disabled={loading || CHUNK * (chunks + 1) > 62}>
          {loading ? "Carregando..." : CHUNK * (chunks + 1) > 62 ? "Use as setas para ver mais adiante" : "Carregar mais duas semanas"}
        </button>
      )}
    </div>
  );
}
