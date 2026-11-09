// Minha Rotina: Meu dia, Agenda, Minhas rotinas e Evolução. A data e o modo da
// agenda ficam na URL (?data=AAAA-MM-DD&modo=semana), então trocar de área ou
// de visualização mantém o contexto, e recarregar a página também.
import { useLayoutEffect, useRef, useState } from "react";
import Icon, { IconName } from "../components/Icon";
import { Link, navigate, paths, useSearch } from "../router";
import { displayName, useAuth } from "../auth/AuthProvider";
import Agenda, { AGENDA_MODES, AgendaMode } from "./Agenda";
import { addDays, isIsoDate, longDay } from "./dates";
import DayView from "./DayView";
import { greeting } from "./domain";
import Evolution from "./Evolution";
import RoutineEditor from "./RoutineEditor";
import Routines from "./Routines";
import "./routine.css";

const TABS: { key: string; label: string; icon: IconName }[] = [
  { key: "", label: "Meu dia", icon: "routine" },
  { key: "agenda", label: "Agenda", icon: "calendar" },
  { key: "rotinas", label: "Minhas rotinas", icon: "layers" },
  { key: "evolucao", label: "Evolução", icon: "chart" },
];

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function RoutinePage({ section = "" }: { section?: string }) {
  const search = new URLSearchParams(useSearch());
  const today = localToday();
  const param = search.get("data");
  const date = isIsoDate(param) ? param : today;
  const modeParam = search.get("modo") as AgendaMode | null;
  const mode: AgendaMode = AGENDA_MODES.some((m) => m.key === modeParam) ? modeParam! : "semana";
  const [addSignal, setAddSignal] = useState(0);
  const [applySignal, setApplySignal] = useState(0);
  const { state } = useAuth();
  const name = state.status === "authenticated" ? displayName(state.user, state.telegram).split(" ")[0] : "";

  const [top, sub] = section.split("/");
  const tab = TABS.some((t) => t.key === top) ? top : null;
  const editing = top === "rotinas" && sub;

  const go = (next: { date?: string; mode?: AgendaMode }, base = top) => {
    const d = next.date ?? date;
    navigate(paths.routine(base || undefined, { data: d === today ? undefined : d, modo: base === "agenda" ? next.mode ?? (mode === "semana" ? undefined : mode) : undefined }), { replace: true });
  };

  const dayActions = tab === "" || (tab === "agenda" && mode === "dia");

  return (
    <div className="page rt">
      <header className="page-head rt-head">
        <div>
          <h1>Minha Rotina</h1>
          <p className="muted">{tab === "" ? `${greeting()}${name ? `, ${name}` : ""}. ${longDay(date)}.` : "Planeje o dia, acompanhe o que fez e ajuste quando precisar."}</p>
        </div>
        <div className="rt-head-actions">
          {tab === "rotinas" && !editing && (
            <Link className="button button-primary" to={paths.routine("rotinas/nova")}>
              <Icon name="plus" size={16} weight="bold" />
              Criar rotina
            </Link>
          )}
          {(tab === "" || tab === "agenda") && (
            <>
              {dayActions && (
                <button type="button" className="button" onClick={() => setApplySignal((n) => n + 1)}>
                  <Icon name="layers" size={16} />
                  Aplicar rotina
                </button>
              )}
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  if (!dayActions) go({ mode: "dia" }, "agenda");
                  setAddSignal((n) => n + 1);
                }}
              >
                <Icon name="plus" size={16} weight="bold" />
                Adicionar atividade
              </button>
            </>
          )}
        </div>
      </header>

      {!editing && <Tabs current={tab ?? ""} date={date} today={today} />}

      <div className="rt-panel" key={editing ? `edit-${sub}` : tab ?? "none"}>
        {tab === null && (
          <div className="empty">
            <h2>Seção não encontrada</h2>
            <Link className="button" to={paths.routine()}>
              Ir para Meu dia
            </Link>
          </div>
        )}
        {tab === "" && (
          <>
            <DayNav date={date} today={today} onChange={(d) => go({ date: d })} />
            <DayView date={date} addSignal={addSignal} applySignal={applySignal} />
          </>
        )}
        {tab === "agenda" && <Agenda date={date} today={today} mode={mode} onChange={(n) => go(n)} addSignal={addSignal} applySignal={applySignal} />}
        {tab === "rotinas" && !editing && <Routines today={today} />}
        {tab === "rotinas" && editing && <RoutineEditor routineId={sub === "nova" ? undefined : sub} />}
        {tab === "evolucao" && <Evolution />}
      </div>
    </div>
  );
}

/** Navegação secundária (mesmo desenho das abas do Foco). O realce desliza até a aba ativa. */
function Tabs({ current, date, today }: { current: string; date: string; today: string }) {
  const list = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = list.current?.querySelector<HTMLElement>("[aria-current='page']");
      setThumb(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (list.current) ro.observe(list.current);
    return () => ro.disconnect();
  }, [current]);
  const keep = date === today ? undefined : date;
  return (
    <nav className="rt-tabs" aria-label="Seções da Minha Rotina">
      <div className="rt-tabs-list" ref={list}>
        {thumb && <span className="rt-tabs-thumb" style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }} aria-hidden="true" />}
        {TABS.map((t) => (
          <Link
            key={t.key}
            to={paths.routine(t.key || undefined, t.key === "" || t.key === "agenda" ? { data: keep } : undefined)}
            className="rt-tab"
            aria-current={current === t.key ? "page" : undefined}
          >
            <Icon name={t.icon} size={18} />
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function DayNav({ date, today, onChange }: { date: string; today: string; onChange: (d: string) => void }) {
  return (
    <div className="rt-daynav">
      <button type="button" className="icon-button" onClick={() => onChange(addDays(date, -1))} aria-label="Dia anterior">
        <Icon name="left" size={18} />
      </button>
      <label className="rt-daynav-date">
        <span className="sr-only">Escolher data</span>
        <input type="date" value={date} onChange={(e) => isIsoDate(e.target.value) && onChange(e.target.value)} />
        <span aria-hidden="true">{date === today ? "Hoje" : longDay(date)}</span>
      </label>
      <button type="button" className="icon-button" onClick={() => onChange(addDays(date, 1))} aria-label="Próximo dia">
        <Icon name="right" size={18} />
      </button>
      {date !== today && (
        <button type="button" className="button button-sm" onClick={() => onChange(today)}>
          Voltar para hoje
        </button>
      )}
    </div>
  );
}
