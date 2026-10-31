import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { useResource } from "../hooks/useResource";
import { Link, paths } from "../router";
import ActiveTimer, { EndedCard } from "./ActiveTimer";
import { focusApi, Method } from "./api";
import Composer from "./Composer";
import { isBreak } from "./derive";
import { useFocusModePreference } from "./focusMode";
import GoalsPanel from "./Goals";
import HistoryTab from "./History";
import { AchievementsTab, LevelRail } from "./Progression";
import SettingsTab from "./Settings";
import StatsTab from "./Stats";
import { useFocus } from "./store";
import TodayRail from "./TodayRail";

export const FOCUS_TABS = [
  ["", "Temporizador", "timer"],
  ["conquistas", "Conquistas", "trophy"],
  ["historico", "Histórico", "history"],
  ["estatisticas", "Estatísticas", "chart"],
  ["ajustes", "Ajustes", "settings"],
] as const;

/** Seção de produtividade: temporizador em destaque e, ao lado, metas e progressão. */
export default function FocusPage({ tab = "" }: { tab?: string }) {
  const { session, status, lastEnded, error } = useFocus();
  const focusMode = useFocusModePreference();
  const immersive = focusMode && !!session && !isBreak(session.stage);
  const known = FOCUS_TABS.some(([key]) => key === tab);

  return (
    <div className={`page page-narrow focus-page ${immersive ? "is-immersive" : ""}`}>
      <header className="page-head focus-head">
        <div>
          <p className="eyebrow">Produtividade</p>
          <h1>Foco</h1>
        </div>
        <nav className="focus-tabs" aria-label="Seções do foco">
          {FOCUS_TABS.map(([key, label, icon]) => (
            <Link key={key} to={paths.focus(key || undefined)} className={tab === key ? "is-active" : ""} aria-current={tab === key ? "page" : undefined}>
              <Icon name={icon} size={15} /> {label}
            </Link>
          ))}
        </nav>
      </header>

      {!known && <div className="alert alert-error">Seção não encontrada.</div>}
      {tab === "" && (
        <div className="focus-layout">
          <div className={`stage ${session ? `tone-${session.paused ? "paused" : session.stage === "ready" ? "ready" : "focus"}` : "is-idle"}`}>
            {status === "error" && !session && (
              <div className="stage-message">
                <Icon name="alert" size={22} />
                <p>Não foi possível falar com o servidor ({error}). Tentando de novo...</p>
              </div>
            )}
            {(status === "idle" || status === "loading") && <div className="stage-loading" aria-busy="true" />}
            {status === "ready" && session && <ActiveTimer session={session} />}
            {status === "ready" && !session && (
              <>
                {lastEnded && <EndedCard ended={lastEnded} />}
                <ComposerLoader />
              </>
            )}
          </div>
          <aside className="focus-rail">
            <TodayRail />
            <GoalsPanel />
            <LevelRail />
          </aside>
        </div>
      )}
      {tab === "conquistas" && <AchievementsTab />}
      {tab === "historico" && <HistoryTab />}
      {tab === "estatisticas" && <StatsTab />}
      {tab === "ajustes" && <SettingsTab />}
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
      <div className="stage-message">
        <Icon name="alert" size={22} />
        <p>Não foi possível carregar as técnicas: {error.message}</p>
        <button type="button" className="button button-sm" onClick={reload}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!data || !methods) return <div className="stage-loading" aria-busy="true" />;
  return <Composer catalog={data} methods={methods} onMethodsChange={setMethods} initialTarget={initialTarget} />;
}
