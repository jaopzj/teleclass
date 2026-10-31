import { useMemo, useState } from "react";
import Icon from "../components/Icon";
import { useResource } from "../hooks/useResource";
import { FocusStats, focusApi, StatsRange, StatsSummary } from "./api";
import { duration } from "./derive";
import { useFocus } from "./store";

const RANGES: [StatsRange, string][] = [
  ["7d", "7 dias"],
  ["30d", "30 dias"],
  ["90d", "90 dias"],
  ["365d", "12 meses"],
  ["all", "Tudo"],
];
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` de ${y}` : ""}`;
};
const hours = (s: number) => (s >= 3600 ? `${(s / 3600).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : duration(s));

/** Estatísticas de produtividade. Todos os números vêm de /api/focus/stats. */
export default function StatsTab() {
  const { revision } = useFocus();
  const [range, setRange] = useState<StatsRange>("30d");
  const { data, error, loading, reload } = useResource(`focus-stats:${range}:${revision}`, () => focusApi.stats(range));

  return (
    <div className="stats">
      <div className="section-head">
        <div>
          <h2>Estatísticas</h2>
          <p className="muted small">Só tempo de concentração do temporizador. Pausas e tempo pausado ficam de fora.</p>
        </div>
        <div className="fseg" role="tablist" aria-label="Período">
          {RANGES.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={range === key} className={range === key ? "is-on" : ""} onClick={() => setRange(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && !data && (
        <div className="alert alert-error">
          Não foi possível carregar as estatísticas: {error.message}{" "}
          <button type="button" className="link-button" onClick={reload}>
            Tentar de novo
          </button>
        </div>
      )}
      {!data && !error && <div className="skeleton" style={{ height: 360, borderRadius: 16 }} />}
      {data && <StatsBody data={data} stale={loading} />}
    </div>
  );
}

function StatsBody({ data, stale }: { data: FocusStats; stale: boolean }) {
  const s = data.summary;
  const empty = data.all_time.focus_seconds === 0;
  if (empty) {
    return (
      <div className="empty">
        <Icon name="chart" size={28} />
        <h2>Sem dados ainda</h2>
        <p>Conclua sua primeira sessão de foco e suas estatísticas começam a aparecer aqui.</p>
      </div>
    );
  }
  return (
    <div className={`stats-body ${stale ? "is-stale" : ""}`}>
      <dl className="kpis">
        <Kpi label="Tempo de foco" value={hours(s.focus_seconds)} prev={data.previous?.focus_seconds} current={s.focus_seconds} format={hours} />
        <Kpi label="Sessões" value={String(s.sessions)} note={`${s.completed_sessions} concluídas`} prev={data.previous?.sessions} current={s.sessions} />
        <Kpi label="Ciclos concluídos" value={String(s.cycles)} prev={data.previous?.cycles} current={s.cycles} />
        <Kpi label="Média por sessão" value={s.average_session_seconds ? duration(s.average_session_seconds) : "—"} />
        <Kpi label="Dias ativos" value={`${s.active_days}`} note={`de ${data.days} ${data.days === 1 ? "dia" : "dias"}`} />
        <Kpi label="Melhor sessão" value={s.best_session ? duration(s.best_session.focus_seconds) : "—"} note={s.best_session ? bestNote(s) : undefined} />
      </dl>

      <section className="chart-block" aria-labelledby="heat-title">
        <div className="chart-head">
          <h3 id="heat-title">Frequência</h3>
          <span className="muted small">Últimas 53 semanas · {hours(data.all_time.focus_seconds)} no total</span>
        </div>
        <Heatmap data={data} />
      </section>

      <Evolution data={data} />

      <div className="chart-grid">
        <section className="chart-block" aria-labelledby="course-title">
          <div className="chart-head">
            <h3 id="course-title">Por curso</h3>
          </div>
          <HBars
            rows={data.by_course.map((c) => ({ key: c.course_id ?? "none", label: c.title ?? "Sem curso vinculado", value: c.seconds, note: `${c.sessions} ${c.sessions === 1 ? "sessão" : "sessões"}`, muted: !c.course_id }))}
            empty="Nenhuma sessão no período."
          />
          {data.by_lesson.length > 0 && (
            <>
              <h4 className="chart-sub">Aulas com mais foco</h4>
              <HBars rows={data.by_lesson.map((l) => ({ key: `${l.course_id}:${l.lesson_key}`, label: l.title ?? l.lesson_key, value: l.seconds, note: l.course_title ?? undefined }))} />
            </>
          )}
        </section>
        <section className="chart-block" aria-labelledby="tech-title">
          <div className="chart-head">
            <h3 id="tech-title">Por técnica</h3>
          </div>
          <HBars rows={data.by_technique.map((t) => ({ key: t.technique, label: t.name, value: t.seconds, note: `${t.sessions} ${t.sessions === 1 ? "sessão" : "sessões"}` }))} empty="Nenhuma sessão no período." />
          <h4 className="chart-sub">Horário do dia</h4>
          <Columns
            values={data.by_hour}
            labels={data.by_hour.map((_, h) => (h % 6 === 0 ? `${h}h` : ""))}
            tips={data.by_hour.map((v, h) => `${h}h–${h + 1}h: ${hours(v)}`)}
            height={72}
          />
          <h4 className="chart-sub">Dia da semana</h4>
          <Columns values={data.by_weekday} labels={WEEKDAYS} tips={data.by_weekday.map((v, i) => `${WEEKDAYS[i]}: ${hours(v)}`)} height={72} />
        </section>
      </div>
    </div>
  );
}

function bestNote(s: StatsSummary) {
  const b = s.best_session!;
  return `${new Date(b.started_at * 1000).toLocaleDateString("pt-BR")} · ${b.method_name}`;
}

function Kpi({ label, value, note, prev, current, format }: { label: string; value: string; note?: string; prev?: number; current?: number; format?: (n: number) => string }) {
  let delta: JSX.Element | null = null;
  if (prev != null && current != null) {
    const diff = current - prev;
    if (prev === 0 && current === 0) delta = null;
    else if (diff === 0) delta = <span className="kpi-delta">igual ao período anterior</span>;
    else
      delta = (
        <span className={`kpi-delta ${diff > 0 ? "is-up" : ""}`}>
          {diff > 0 ? "+" : "−"}
          {format ? format(Math.abs(diff)) : Math.abs(diff)} vs. período anterior
        </span>
      );
  }
  return (
    <div className="kpi">
      <dt>{label}</dt>
      <dd className="kpi-value">{value}</dd>
      {(note || delta) && (
        <dd className="kpi-note">
          {note}
          {note && delta && " · "}
          {delta}
        </dd>
      )}
    </div>
  );
}

// --- calendário de atividade -------------------------------------------------------

function level(seconds: number, scale: number[]) {
  if (seconds <= 0) return 0;
  if (seconds < scale[1]) return 1;
  if (seconds < scale[2]) return 2;
  if (seconds < scale[3]) return 3;
  return 4;
}

function Heatmap({ data }: { data: FocusStats }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const weeks = useMemo(() => {
    const out: { date: string; seconds: number }[][] = [];
    data.heatmap.forEach((d, i) => {
      if (i % 7 === 0) out.push([]);
      out[out.length - 1].push(d);
    });
    return out;
  }, [data.heatmap]);
  const monthLabels = weeks.map((w, i) => {
    const m = Number(w[0].date.slice(5, 7));
    const prev = i > 0 ? Number(weeks[i - 1][0].date.slice(5, 7)) : -1;
    return m !== prev ? MONTHS[m - 1] : "";
  });
  // Um mês que só aparece nas primeiras semanas não tem espaço para o nome.
  if (monthLabels[0] && monthLabels.slice(1, 3).some(Boolean)) monthLabels[0] = "";
  return (
    <div className="heat" onMouseLeave={() => setTip(null)}>
      <div className="heat-scroll">
        <div className="heat-months" aria-hidden="true">
          {monthLabels.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
        <div className="heat-body">
          <div className="heat-days" aria-hidden="true">
            <span>Seg</span>
            <span />
            <span>Qua</span>
            <span />
            <span>Sex</span>
            <span />
            <span />
          </div>
          <div className="heat-grid" role="grid" aria-label="Minutos de foco por dia">
            {weeks.map((w, wi) => (
              <div key={wi} className="heat-week" role="row">
                {w.map((d) => {
                  const text = `${fmtDate(d.date)}: ${d.seconds > 0 ? duration(d.seconds) : "sem foco"}`;
                  return (
                    <span
                      key={d.date}
                      role="gridcell"
                      aria-label={text}
                      tabIndex={-1}
                      className={`heat-cell l${level(d.seconds, data.heatmap_scale)}`}
                      onMouseEnter={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const host = (e.currentTarget.closest(".heat") as HTMLElement).getBoundingClientRect();
                        setTip({ x: r.left - host.left + r.width / 2, y: r.top - host.top, text });
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>Menos</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heat-cell l${l}`} />
        ))}
        <span>Mais</span>
        <span className="muted"> · o 2º tom começa em {duration(data.active_day_seconds)} (dia ativo)</span>
      </div>
      {tip && (
        <span className="chart-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          {tip.text}
        </span>
      )}
    </div>
  );
}

// --- evolução -------------------------------------------------------------------------

function Evolution({ data }: { data: FocusStats }) {
  const [view, setView] = useState<"daily" | "weekly" | "monthly">("daily");
  const series =
    view === "daily"
      ? data.daily.map((d) => ({ label: d.date.slice(8), tip: `${fmtDate(d.date)}: ${duration(d.seconds)}${d.cycles ? ` · ${d.cycles} ciclos` : ""}`, value: d.seconds }))
      : view === "weekly"
        ? data.weekly.map((w) => ({ label: fmtDate(w.start).replace(/ de \d+$/, ""), tip: `Semana de ${fmtDate(w.start)}: ${hours(w.seconds)}`, value: w.seconds }))
        : data.monthly.map((m) => ({ label: MONTHS[Number(m.month.slice(5)) - 1], tip: `${MONTHS[Number(m.month.slice(5)) - 1]} de ${m.month.slice(0, 4)}: ${hours(m.seconds)}`, value: m.seconds }));
  const every = Math.ceil(series.length / 10);
  return (
    <section className="chart-block" aria-labelledby="evo-title">
      <div className="chart-head">
        <h3 id="evo-title">Evolução</h3>
        <div className="fseg fseg-sm" role="tablist" aria-label="Agrupar por">
          {(
            [
              ["daily", "Diária"],
              ["weekly", "Semanal"],
              ["monthly", "Mensal"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? "is-on" : ""} onClick={() => setView(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <Columns
        values={series.map((s) => s.value)}
        labels={series.map((s, i) => (i % every === 0 || i === series.length - 1 ? s.label : ""))}
        tips={series.map((s) => s.tip)}
        height={160}
        axis
        goal={view === "daily" ? data.active_day_seconds : undefined}
      />
      <p className="muted small">
        {view === "daily" ? `Últimos ${data.daily.length} dias` : view === "weekly" ? "Últimas 12 semanas" : "Últimos 12 meses"}
        {view === "daily" && ` · a linha tracejada marca ${duration(data.active_day_seconds)}, o mínimo de um dia ativo`}
      </p>
    </section>
  );
}

// --- marcas simples (uma série, um tom) --------------------------------------------------

function niceMax(v: number) {
  if (v <= 0) return 3600;
  const h = v / 3600;
  if (h <= 1) return Math.ceil(v / 900) * 900;
  return Math.ceil(h) * 3600;
}

function Columns({ values, labels, tips, height, axis = false, goal }: { values: number[]; labels: string[]; tips: string[]; height: number; axis?: boolean; goal?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...values, goal ? goal * 1.5 : 0));
  return (
    <div className={`cols ${axis ? "has-axis" : ""}`}>
      {axis && (
        <div className="cols-axis" style={{ height }} aria-hidden="true">
          <span>{hours(max)}</span>
          <span>{hours(max / 2)}</span>
          <span>0</span>
        </div>
      )}
      <div className="cols-plot" style={{ height }} onMouseLeave={() => setHover(null)}>
        {axis && <span className="cols-grid" aria-hidden="true" />}
        {goal != null && <span className="cols-goal" style={{ bottom: `${(goal / max) * 100}%` }} aria-hidden="true" />}
        {values.map((v, i) => (
          <span
            key={i}
            className={`col ${hover === i ? "is-hover" : ""}`}
            onMouseEnter={() => setHover(i)}
            role="img"
            aria-label={tips[i]}
          >
            {v > 0 && <span className="col-fill" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />}
            {hover === i && <span className="chart-tip is-col">{tips[i]}</span>}
          </span>
        ))}
      </div>
      <div className="cols-labels" aria-hidden="true" style={{ paddingLeft: axis ? 44 : 0 }}>
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

function HBars({ rows, empty }: { rows: { key: string; label: string; value: number; note?: string; muted?: boolean }[]; empty?: string }) {
  if (!rows.length) return <p className="empty-inline">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.key} className={r.muted ? "is-muted" : ""} title={`${r.label}: ${duration(r.value)}`}>
          <div className="hbar-top">
            <span className="hbar-label">{r.label}</span>
            <span className="hbar-value">
              {duration(r.value)} <span className="muted">· {Math.round((r.value / total) * 100)}%</span>
            </span>
          </div>
          <span className="hbar-track">
            <span style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          {r.note && <span className="hbar-note">{r.note}</span>}
        </li>
      ))}
    </ul>
  );
}
