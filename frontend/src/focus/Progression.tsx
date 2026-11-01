import { CSSProperties, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import { useResource } from "../hooks/useResource";
import { Link, paths } from "../router";
import { Achievement, focusApi, Progression } from "./api";
import { useFocus } from "./store";

/** Nível, título e XP. A barra anima quando o XP muda. */
export function LevelCard({ progress, compact = false }: { progress: Progression; compact?: boolean }) {
  const previous = useRef(progress.level);
  const [leveled, setLeveled] = useState(false);
  useEffect(() => {
    if (progress.level > previous.current) {
      setLeveled(true);
      const t = window.setTimeout(() => setLeveled(false), 1600);
      previous.current = progress.level;
      return () => window.clearTimeout(t);
    }
    previous.current = progress.level;
  }, [progress.level]);
  return (
    <div className={`level ${compact ? "is-compact" : ""} ${leveled ? "is-leveled" : ""}`}>
      <div className="level-badge" aria-hidden="true">
        <span>{progress.level}</span>
      </div>
      <div className="level-text">
        <p className="level-title">
          {progress.title} <span className="muted">· nível {progress.level}</span>
        </p>
        <div className="level-bar" role="progressbar" aria-label="Progresso até o próximo nível" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
          <span style={{ width: `${progress.percent}%` }} />
        </div>
        <p className="level-numbers">
          <span>{progress.xp.toLocaleString("pt-BR")} XP</span>
          <span className="muted">
            faltam {(progress.next_level_xp - progress.xp).toLocaleString("pt-BR")} para o nível {progress.level + 1}
          </span>
        </p>
      </div>
    </div>
  );
}

export function LevelRail() {
  const { progress } = useFocus();
  return (
    <section className="rail-block" aria-label="Seu nível">
      <div className="rail-head">
        <h3 className="rail-title">Progressão</h3>
        <Link to={paths.focus("conquistas")} className="link-button">
          Conquistas <Icon name="arrow" size={13} />
        </Link>
      </div>
      {progress ? <LevelCard progress={progress} compact /> : <div className="skeleton" style={{ height: 64, borderRadius: 12 }} />}
    </section>
  );
}

const RARITY_ORDER = ["comum", "incomum", "rara", "épica", "lendária"];

function formatProgress(a: Achievement) {
  if (a.unit === "hours") return `${Math.floor(a.current)} de ${a.target} h`;
  if (a.unit === "days") return `${a.current} de ${a.target} dias`;
  return `${a.current} de ${a.target}`;
}

/** Aba de conquistas: nível, escada de títulos, regras de XP e as conquistas. */
export function AchievementsTab() {
  const { revision } = useFocus();
  const { data, error, reload } = useResource(`focus-progress:${revision}`, focusApi.progress);
  const { data: catalog } = useResource("focus-catalog", focusApi.catalog);
  const [filter, setFilter] = useState<"all" | "unlocked" | "progress">("all");

  if (error && !data) {
    return (
      <div className="alert alert-error">
        Não foi possível carregar sua progressão: {error.message}{" "}
        <button type="button" className="link-button" onClick={reload}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!data) return <div className="skeleton" style={{ height: 320, borderRadius: 16 }} />;

  const unlocked = data.achievements.filter((a) => a.unlocked_at);
  const items = data.achievements
    .filter((a) => (filter === "unlocked" ? a.unlocked_at : filter === "progress" ? !a.unlocked_at : true))
    .sort((a, b) => Number(!!b.unlocked_at) - Number(!!a.unlocked_at) || RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));

  return (
    <div className="progress-tab">
      <section className="progress-hero">
        <LevelCard progress={data.progress} />
        <ol className="ladder" aria-label="Títulos">
          {data.ladder.map((step, i) => {
            const reached = data.progress.level >= step.level;
            const current = reached && (i === data.ladder.length - 1 || data.progress.level < data.ladder[i + 1].level);
            return (
              <li key={step.level} className={`${reached ? "is-reached" : ""} ${current ? "is-current" : ""}`} title={step.description}>
                <span className="ladder-dot" />
                <span className="ladder-name">{step.title}</span>
                <span className="ladder-level">nv. {step.level}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="ach-title">
        <div className="section-head">
          <div>
            <h2 id="ach-title">Conquistas</h2>
            <p className="muted small">
              {unlocked.length} de {data.achievements.length} desbloqueadas
            </p>
          </div>
          <div className="fseg" role="tablist" aria-label="Filtrar conquistas">
            {(
              [
                ["all", "Todas"],
                ["unlocked", "Desbloqueadas"],
                ["progress", "Em andamento"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "is-on" : ""} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {items.length === 0 ? (
          <p className="empty-inline">{filter === "unlocked" ? "Nenhuma conquista ainda. A primeira vem ao concluir uma sessão." : "Você desbloqueou todas."}</p>
        ) : (
          <ul className="achievements">
            {items.map((a) => (
              <li key={a.code} className={`achievement rarity-${rarityClass(a.rarity)} ${a.unlocked_at ? "is-unlocked" : ""}`}>
                <span className="achievement-medal" aria-hidden="true">
                  <Icon name={a.unlocked_at ? "medal" : "lock"} size={20} />
                </span>
                <div className="achievement-text">
                  <p className="achievement-name">{a.name}</p>
                  <p className="achievement-desc">{a.description}</p>
                  {a.unlocked_at ? (
                    <p className="achievement-meta">
                      Desbloqueada em {new Date(a.unlocked_at * 1000).toLocaleDateString("pt-BR")} · +{a.xp} XP
                    </p>
                  ) : (
                    <div className="achievement-progress">
                      <span className="achievement-track" style={{ "--p": `${Math.min(100, (a.current / a.target) * 100)}%` } as CSSProperties} />
                      <span>{formatProgress(a)}</span>
                    </div>
                  )}
                </div>
                <span className="achievement-rarity">{a.rarity}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {catalog && (
        <section className="rules" aria-labelledby="rules-title">
          <h2 id="rules-title">Como o XP funciona</h2>
          <ul>
            <li>
              <strong>{catalog.rules.focus_xp_per_minute} XP</strong> por minuto de concentração, até {catalog.rules.daily_focus_xp_cap} XP por dia. Pausas e tempo pausado não contam.
            </li>
            <li>
              <strong>+{catalog.rules.cycle_xp} XP</strong> por ciclo concluído (com {Math.round(catalog.rules.cycle_min_focus_seconds / 60)} min ou mais de foco), até {catalog.rules.daily_cycle_bonus_cap} ciclos por dia. O ciclo só conta depois que a pausa seguinte é cumprida.
            </li>
            <li>
              <strong>+{catalog.rules.session_xp} XP</strong> por sessão concluída com pelo menos {Math.round(catalog.rules.session_min_focus_seconds / 60)} min de foco.
            </li>
            <li>
              <strong>+{catalog.rules.goal_xp.daily} XP</strong> pela meta do dia e <strong>+{catalog.rules.goal_xp.weekly} XP</strong> pela meta da semana, uma vez por período.
            </li>
            <li>Conquistas rendem de {catalog.rules.rarity_xp["comum"]} a {catalog.rules.rarity_xp["lendária"]} XP, conforme a raridade.</li>
            <li>Sair de uma pausa antes da hora invalida só aquele ciclo. Nada que você já conquistou é retirado.</li>
          </ul>
        </section>
      )}
    </div>
  );
}

function rarityClass(r: string) {
  return { comum: "common", incomum: "uncommon", rara: "rare", "épica": "epic", "lendária": "legendary" }[r] ?? "common";
}
