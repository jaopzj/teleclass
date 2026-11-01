import { KeyboardEvent, useMemo, useState } from "react";

// A grade rola na horizontal em telas estreitas: começa mostrando as semanas recentes.
const scrollToEnd = (el: HTMLDivElement | null) => {
  if (el) el.scrollLeft = el.scrollWidth;
};
import Icon from "../components/Icon";
import { useResource } from "../hooks/useResource";
import { Link, paths } from "../router";
import { FocusStats, focusApi, StatsRange } from "./api";
import { duration } from "./derive";
import { useFocus } from "./store";

const RANGES: [StatsRange, string][] = [
  ["7d", "7 dias"],
  ["30d", "30 dias"],
  ["90d", "90 dias"],
  ["365d", "12 meses"],
];
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const fmtDate = (iso: string, weekday = false) => {
  const [y, m, d] = iso.split("-").map(Number);
  const base = `${d} de ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` de ${y}` : ""}`;
  if (!weekday) return base;
  const wd = new Date(y, m - 1, d).toLocaleDateString("pt-BR", { weekday: "long" });
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${base}`;
};
const hours = (s: number) => (s >= 3600 ? `${(s / 3600).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : duration(s));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Estatísticas de concentração. Todos os números vêm de /api/focus/stats (dados gravados). */
export default function StatsTab() {
  const { revision } = useFocus();
  const [range, setRange] = useState<StatsRange>("30d");
  const { data, error, loading, reload } = useResource(`focus-stats:${range}:${revision}`, () => focusApi.stats(range));

  if (error && !data) {
    return (
      <div className="empty">
        <span className="empty-icon">
          <Icon name="alert" size={24} />
        </span>
        <h2>Não foi possível carregar as estatísticas</h2>
        <p>{error.message}</p>
        <button type="button" className="button" onClick={reload}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="fx-stats" aria-busy="true" aria-label="Carregando">
        <div className="surface skeleton" style={{ height: 112 }} />
        <div className="surface skeleton" style={{ height: 360 }} />
      </div>
    );
  }
  if (data.all_time.focus_seconds === 0) {
    return (
      <div className="empty">
        <span className="empty-icon">
          <Icon name="chart" size={24} />
        </span>
        <h2>Suas estatísticas começam na primeira sessão</h2>
        <p>Conclua um bloco de concentração e aqui aparecem seu tempo por dia, sua sequência e onde você mais estuda.</p>
        <Link className="button button-primary" to={paths.focus()}>
          Começar uma sessão
        </Link>
      </div>
    );
  }

  return (
    <div className={`fx-stats ${loading ? "is-stale" : ""}`}>
      <Overview data={data} />

      <section className="surface fx-card" aria-labelledby="fx-period-title">
        <div className="fx-section-head">
          <h2 id="fx-period-title" className="fx-card-title">
            Atividade
          </h2>
          <div className="fx-seg" role="radiogroup" aria-label="Período">
            {RANGES.map(([key, label]) => (
              <button key={key} type="button" role="radio" aria-checked={range === key} onClick={() => setRange(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <PeriodSummary data={data} />
        <ActivityChart data={data} />
      </section>

      <div className="fx-stats-grid">
        <section className="surface fx-card" aria-labelledby="fx-heat-title">
          <div className="fx-section-head">
            <h2 id="fx-heat-title" className="fx-card-title">
              Consistência
            </h2>
            <span className="fx-hint">Último ano · {hours(data.all_time.focus_seconds)} no total</span>
          </div>
          <Heatmap data={data} />
        </section>
        <Distribution data={data} />
      </div>
    </div>
  );
}

/** Indicadores fixos (não dependem do período escolhido). */
function Overview({ data }: { data: FocusStats }) {
  const today = data.heatmap[data.heatmap.length - 1];
  const week = data.weekly[data.weekly.length - 1];
  const month = data.monthly[data.monthly.length - 1];
  const streak = useMemo(() => {
    const days = data.heatmap;
    let i = days.length - 1;
    if (i >= 0 && days[i].seconds < data.active_day_seconds) i--; // hoje ainda pode entrar na sequência
    let n = 0;
    while (i >= 0 && days[i].seconds >= data.active_day_seconds) {
      n++;
      i--;
    }
    return n;
  }, [data.heatmap, data.active_day_seconds]);
  return (
    <dl className="surface fx-kpis">
      <Kpi label="Hoje" value={duration(today?.seconds ?? 0)} note={plural(data.daily[data.daily.length - 1]?.cycles ?? 0, "ciclo concluído", "ciclos concluídos")} />
      <Kpi label="Esta semana" value={hours(week?.seconds ?? 0)} note="de segunda até hoje" />
      <Kpi label="Este mês" value={hours(month?.seconds ?? 0)} note={MONTHS[new Date().getMonth()].replace(/^./, (c) => c.toUpperCase())} />
      <Kpi label="Sequência atual" value={plural(streak, "dia", "dias")} note={`dias com ${duration(data.active_day_seconds)} ou mais`} />
    </dl>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="fx-kpi">
      <dt>{label}</dt>
      <dd className="fx-kpi-value tabular">{value}</dd>
      {note && <dd className="fx-kpi-note">{note}</dd>}
    </div>
  );
}

function PeriodSummary({ data }: { data: FocusStats }) {
  const s = data.summary;
  const prev = data.previous;
  const delta = prev && (prev.focus_seconds > 0 || s.focus_seconds > 0) ? s.focus_seconds - prev.focus_seconds : null;
  return (
    <dl className="fx-period">
      <div>
        <dt>Concentração</dt>
        <dd className="tabular">{hours(s.focus_seconds)}</dd>
        {delta != null && delta !== 0 && (
          <dd className={`fx-delta ${delta > 0 ? "is-up" : ""}`}>
            {delta > 0 ? "+" : "−"}
            {hours(Math.abs(delta))} vs. período anterior
          </dd>
        )}
      </div>
      <div>
        <dt>Média diária</dt>
        <dd className="tabular">{duration(s.focus_seconds / Math.max(1, data.days))}</dd>
      </div>
      <div>
        <dt>Ciclos concluídos</dt>
        <dd className="tabular">{s.cycles}</dd>
      </div>
      <div>
        <dt>Sessões</dt>
        <dd className="tabular">{s.sessions}</dd>
        <dd className="fx-delta">{plural(s.completed_sessions, "concluída", "concluídas")}</dd>
      </div>
      <div>
        <dt>Dias ativos</dt>
        <dd className="tabular">
          {s.active_days}
          <span className="muted"> de {data.days}</span>
        </dd>
      </div>
    </dl>
  );
}

// --- gráfico de atividade ------------------------------------------------------------------

function niceMax(v: number) {
  if (v <= 0) return 3600;
  const h = v / 3600;
  if (h <= 1) return Math.ceil(v / 900) * 900;
  if (h <= 4) return Math.ceil(h) * 3600;
  return Math.ceil(h / 2) * 7200;
}

function ActivityChart({ data }: { data: FocusStats }) {
  const monthly = data.range === "365d";
  const series = monthly
    ? data.monthly.map((m) => {
        const name = MONTHS[Number(m.month.slice(5)) - 1];
        return { key: m.month, label: name, tip: `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${m.month.slice(0, 4)}`, value: m.seconds, extra: null as string | null };
      })
    : data.daily.map((d) => ({ key: d.date, label: String(Number(d.date.slice(8))), tip: fmtDate(d.date, true), value: d.seconds, extra: d.cycles ? plural(d.cycles, "ciclo", "ciclos") : null }));
  return (
    <Bars
      series={series}
      height={180}
      every={Math.ceil(series.length / (monthly ? 12 : 10))}
      goal={monthly ? undefined : data.active_day_seconds}
      caption={monthly ? "Concentração por mês" : `Concentração por dia · linha tracejada: ${duration(data.active_day_seconds)}, o mínimo de um dia ativo`}
    />
  );
}

function Bars({
  series,
  height,
  every = 1,
  goal,
  caption,
  axis = true,
}: {
  series: { key: string; label: string; tip: string; value: number; extra: string | null }[];
  height: number;
  every?: number;
  goal?: number;
  caption?: string;
  axis?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(...series.map((s) => s.value), goal ? goal * 1.4 : 0));
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowLeft" ? -1 : 1;
    setActive((i) => Math.min(series.length - 1, Math.max(0, (i ?? series.length) + step)));
  };
  const a = active != null ? series[active] : null;
  return (
    <figure className="fx-bars">
      <div className="fx-bars-body">
        {axis && (
          <div className="fx-bars-axis" style={{ height }} aria-hidden="true">
            <span>{hours(max)}</span>
            <span>{hours(max / 2)}</span>
            <span>0</span>
          </div>
        )}
        <div
          className="fx-bars-plot"
          style={{ height }}
          tabIndex={0}
          role="group"
          aria-label={`${caption ?? "Gráfico"}. Use as setas para percorrer.`}
          onKeyDown={onKey}
          onMouseLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
        >
          {axis && <span className="fx-bars-grid" aria-hidden="true" />}
          {goal != null && <span className="fx-bars-goal" style={{ bottom: `${(goal / max) * 100}%` }} aria-hidden="true" />}
          {series.map((s, i) => (
            <span key={s.key} className={`fx-bar ${active === i ? "is-active" : ""}`} onMouseEnter={() => setActive(i)} role="img" aria-label={`${s.tip}: ${duration(s.value)}`}>
              {s.value > 0 && <span className="fx-bar-fill" style={{ height: `${Math.max(2, (s.value / max) * 100)}%` }} />}
            </span>
          ))}
          {a && (
            <span className="fx-tip" style={{ left: `${((active as number) + 0.5) * (100 / series.length)}%` }} role="status">
              <strong>{a.tip}</strong>
              {duration(a.value)}
              {a.extra && ` · ${a.extra}`}
            </span>
          )}
        </div>
      </div>
      <div className="fx-bars-labels" aria-hidden="true" style={{ paddingLeft: axis ? 48 : 0 }}>
        {series.map((s, i) => (
          <span key={s.key}>{i % every === 0 || i === series.length - 1 ? s.label : ""}</span>
        ))}
      </div>
      {caption && <figcaption className="fx-hint">{caption}</figcaption>}
    </figure>
  );
}

// --- mapa de consistência -------------------------------------------------------------------

function level(seconds: number, scale: number[]) {
  if (seconds <= 0) return 0;
  if (seconds < scale[1]) return 1;
  if (seconds < scale[2]) return 2;
  if (seconds < scale[3]) return 3;
  return 4;
}

function Heatmap({ data }: { data: FocusStats }) {
  const [tip, setTip] = useState<{ x: number; y: number; date: string; seconds: number } | null>(null);
  const cycles = useMemo(() => new Map(data.daily.map((d) => [d.date, d.cycles])), [data.daily]);
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
  if (monthLabels[0] && monthLabels.slice(1, 3).some(Boolean)) monthLabels[0] = "";

  function show(target: HTMLElement, d: { date: string; seconds: number }) {
    const host = target.closest(".fx-heat") as HTMLElement;
    const r = target.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    setTip({ x: r.left - h.left + r.width / 2, y: r.top - h.top, ...d });
  }
  const c = tip ? cycles.get(tip.date) : undefined;

  return (
    <div className="fx-heat" onMouseLeave={() => setTip(null)}>
      <div className="fx-heat-scroll" ref={scrollToEnd}>
        <div className="fx-heat-months" aria-hidden="true">
          {monthLabels.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
        <div className="fx-heat-body">
          <div className="fx-heat-days" aria-hidden="true">
            <span>Seg</span>
            <span />
            <span>Qua</span>
            <span />
            <span>Sex</span>
            <span />
            <span />
          </div>
          <div className="fx-heat-grid" role="list" aria-label="Concentração por dia no último ano">
            {weeks.map((w, wi) => (
              <div key={wi} className="fx-heat-week">
                {w.map((d) => (
                  <span
                    key={d.date}
                    role="listitem"
                    tabIndex={-1}
                    aria-label={`${fmtDate(d.date)}: ${d.seconds > 0 ? duration(d.seconds) : "sem registro"}`}
                    className={`fx-heat-cell l${level(d.seconds, data.heatmap_scale)}`}
                    onMouseEnter={(e) => show(e.currentTarget, d)}
                    onFocus={(e) => show(e.currentTarget, d)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="fx-heat-legend" aria-hidden="true">
        <span>Sem registro</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`fx-heat-cell l${l}`} />
        ))}
        <span>Mais tempo</span>
      </div>
      {tip && (
        <span className="fx-tip is-heat" style={{ left: tip.x, top: tip.y }} role="status">
          <strong>{fmtDate(tip.date, true)}</strong>
          {tip.seconds > 0 ? duration(tip.seconds) : "Sem concentração registrada"}
          {c ? ` · ${plural(c, "ciclo", "ciclos")}` : ""}
        </span>
      )}
    </div>
  );
}

// --- distribuição ---------------------------------------------------------------------------

function Distribution({ data }: { data: FocusStats }) {
  const [view, setView] = useState<"courses" | "techniques" | "hours">("courses");
  const views = [
    ["courses", "Cursos"],
    ["techniques", "Técnicas"],
    ["hours", "Horários"],
  ] as const;
  const peak = data.by_hour.indexOf(Math.max(...data.by_hour));
  return (
    <section className="surface fx-card" aria-labelledby="fx-dist-title">
      <div className="fx-section-head">
        <h2 id="fx-dist-title" className="fx-card-title">
          Distribuição
        </h2>
        <div className="fx-seg is-small" role="radiogroup" aria-label="Ver por">
          {views.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="fx-swap is-block" key={view}>
        {view === "courses" && (
          <HBars
            rows={data.by_course.map((c) => ({ key: c.course_id ?? "none", label: c.title ?? "Sem curso vinculado", value: c.seconds, note: plural(c.sessions, "sessão", "sessões"), muted: !c.course_id }))}
            empty="Nenhuma sessão no período."
          />
        )}
        {view === "techniques" && (
          <HBars rows={data.by_technique.map((t) => ({ key: t.technique, label: t.name, value: t.seconds, note: plural(t.sessions, "sessão", "sessões") }))} empty="Nenhuma sessão no período." />
        )}
        {view === "hours" && (
          <div className="fx-hours">
            <Bars
              series={data.by_hour.map((v, h) => ({ key: String(h), label: h % 6 === 0 ? `${h}h` : "", tip: `${h}h às ${h + 1}h`, value: v, extra: null }))}
              height={96}
              axis={false}
              caption={data.by_hour[peak] > 0 ? `Seu horário mais produtivo começa às ${peak}h` : "Hora do dia"}
            />
            <Bars
              series={data.by_weekday.map((v, i) => ({ key: WEEKDAYS[i], label: WEEKDAYS[i], tip: WEEKDAYS[i], value: v, extra: null }))}
              height={96}
              axis={false}
              caption="Dia da semana"
            />
          </div>
        )}
      </div>
      <p className="fx-hint">No período escolhido em Atividade. Só conta tempo de concentração: pausas e tempo pausado ficam de fora.</p>
    </section>
  );
}

function HBars({ rows, empty }: { rows: { key: string; label: string; value: number; note?: string; muted?: boolean }[]; empty: string }) {
  if (!rows.length) return <p className="fx-empty-inline">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  return (
    <ul className="fx-hbars">
      {rows.map((r) => (
        <li key={r.key} className={r.muted ? "is-muted" : ""}>
          <div className="fx-hbar-top">
            <span className="fx-hbar-label">{r.label}</span>
            <span className="fx-hbar-value tabular">
              {duration(r.value)} <span className="muted">· {Math.round((r.value / total) * 100)}%</span>
            </span>
          </div>
          <span className="fx-hbar-track">
            <span style={{ transform: `scaleX(${r.value / max})` }} />
          </span>
          {r.note && <span className="fx-hint">{r.note}</span>}
        </li>
      ))}
    </ul>
  );
}
