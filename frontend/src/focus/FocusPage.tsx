import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Icon, { IconName } from "../components/Icon";
import { useResource } from "../hooks/useResource";
import { Link, navigate, paths } from "../router";
import ActiveTimer, { EndedSummaryCard } from "./ActiveTimer";
import AmbientView from "./AmbientView";
import { focusApi, Method } from "./api";
import Composer from "./Composer";
import { duration } from "./derive";
import HistoryTab from "./History";
import StatsTab from "./Stats";
import { useFocus } from "./store";
import "./page.css";

/** As quatro áreas da página Foco (e só elas). */
export const FOCUS_TABS: { key: string; label: string; icon: IconName }[] = [
  { key: "", label: "Temporizador", icon: "timer" },
  { key: "estatisticas", label: "Estatísticas", icon: "chart" },
  { key: "historico", label: "Histórico", icon: "history" },
  { key: "som", label: "Som ambiente", icon: "volume" },
];

/** Endereços antigos da página que mudaram de lugar. */
const MOVED: Record<string, string> = { ajustes: "/configuracoes", conquistas: "/conquistas" };

/**
 * Foco: central de concentração. Cabeçalho no padrão das outras páginas,
 * navegação secundária e uma área por vez. A sessão vem do store global, então
 * trocar de aba (ou de página) nunca interrompe nada.
 */
export default function FocusPage({ tab = "" }: { tab?: string }) {
  const moved = MOVED[tab];
  useEffect(() => {
    if (moved) navigate(moved, { replace: true });
  }, [moved]);
  if (moved) return null;
  const known = FOCUS_TABS.some((t) => t.key === tab);

  return (
    <div className="page fx">
      <header className="page-head fx-head">
        <div>
          <h1>Foco</h1>
          <p className="muted">Organize seu tempo. Concentre-se no que importa.</p>
        </div>
        <TodaySummary />
      </header>
      <FocusNav current={tab} />
      <div className="fx-panel" key={tab}>
        {!known && (
          <div className="empty">
            <h2>Seção não encontrada</h2>
            <Link className="button" to={paths.focus()}>
              Voltar ao temporizador
            </Link>
          </div>
        )}
        {tab === "" && <TimerView />}
        {tab === "estatisticas" && <StatsTab />}
        {tab === "historico" && <HistoryTab />}
        {tab === "som" && <AmbientView />}
      </div>
    </div>
  );
}

/** Resumo do dia no cabeçalho: tempo de concentração e ciclos de hoje. */
function TodaySummary() {
  const { revision } = useFocus();
  const { data } = useResource(`focus-stats:7d:${revision}`, () => focusApi.stats("7d"));
  const today = data?.daily[data.daily.length - 1];
  return (
    <dl className="fx-today" aria-label="Hoje">
      <div>
        <dt>Hoje</dt>
        <dd className="tabular">{today ? duration(today.seconds) : "—"}</dd>
      </div>
      <div>
        <dt>Ciclos hoje</dt>
        <dd className="tabular">{today ? today.cycles : "—"}</dd>
      </div>
    </dl>
  );
}

/** Navegação secundária. O realce desliza até a aba ativa. */
function FocusNav({ current }: { current: string }) {
  const list = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = list.current?.querySelector<HTMLElement>("[aria-current='page']");
      if (!el) return setThumb(null);
      setThumb({ x: el.offsetLeft, w: el.offsetWidth });
      el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (list.current) ro.observe(list.current);
    return () => ro.disconnect();
  }, [current]);

  return (
    <nav className="fx-nav" aria-label="Seções do Foco">
      <div className="fx-nav-list" ref={list}>
        {thumb && <span className="fx-nav-thumb" style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }} aria-hidden="true" />}
        {FOCUS_TABS.map((t) => (
          <Link key={t.key} to={paths.focus(t.key || undefined)} className="fx-nav-item" aria-current={current === t.key ? "page" : undefined}>
            <Icon name={t.icon} size={18} />
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** Aba Temporizador: monta a sessão ou mostra a sessão em andamento. */
function TimerView() {
  const { session, status, lastEnded, error } = useFocus();
  if (status === "error" && !session) {
    return (
      <div className="empty">
        <span className="empty-icon">
          <Icon name="alert" size={24} />
        </span>
        <h2>Sem conexão com o servidor</h2>
        <p>{error ?? "Tentando de novo em instantes."} O temporizador volta assim que a conexão voltar.</p>
      </div>
    );
  }
  if (status === "idle" || status === "loading") return <TimerSkeleton />;
  if (session) return <ActiveTimer session={session} />;
  return (
    <>
      {lastEnded && <EndedSummaryCard ended={lastEnded} />}
      <ComposerLoader />
    </>
  );
}

function TimerSkeleton() {
  return (
    <div className="fx-timer-grid" aria-busy="true" aria-label="Carregando">
      <div className="surface fx-card skeleton" style={{ minHeight: 420 }} />
      <div className="surface fx-card skeleton" style={{ minHeight: 420 }} />
    </div>
  );
}

function ComposerLoader() {
  const { data, error, reload } = useResource("focus-catalog", focusApi.catalog);
  const [methods, setMethods] = useState<Method[] | null>(null);
  useEffect(() => {
    if (data) setMethods(data.methods);
  }, [data]);
  const params = new URLSearchParams(location.search);
  const initialTarget = params.get("curso") ? { courseId: params.get("curso"), lessonKey: params.get("aula") } : undefined;
  if (error && !data) {
    return (
      <div className="empty">
        <span className="empty-icon">
          <Icon name="alert" size={24} />
        </span>
        <h2>Não foi possível carregar as técnicas</h2>
        <p>{error.message}</p>
        <button type="button" className="button" onClick={reload}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!data || !methods) return <TimerSkeleton />;
  return <Composer catalog={data} methods={methods} onMethodsChange={setMethods} initialTarget={initialTarget} />;
}
