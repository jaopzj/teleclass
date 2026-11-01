import { FormEvent, useEffect, useState } from "react";
import { ApiError } from "../api";
import Icon from "../components/Icon";
import { useResource } from "../hooks/useResource";
import { notify } from "../notifications/center";
import { Goal, Goals, focusApi } from "./api";
import { duration } from "./derive";
import { useFocus } from "./store";

const PERIOD: Record<Goal["period"], { title: string; empty: string; presets: number[] }> = {
  daily: { title: "Meta do dia", empty: "Quanto tempo de foco você quer por dia?", presets: [60, 120, 180] },
  weekly: { title: "Meta da semana", empty: "Quanto tempo de foco você quer por semana?", presets: [300, 600, 900] },
};

/** Metas diária e semanal de concentração, com progresso em tempo real. */
export default function GoalsPanel() {
  const { revision } = useFocus();
  const { data, error, setData, reload } = useResource(`focus-goals:${revision}`, focusApi.goals);
  const [editing, setEditing] = useState(false);

  if (error && !data) {
    return (
      <section className="rail-block">
        <h3 className="rail-title">Metas</h3>
        <p className="muted small">Não foi possível carregar as metas. <button type="button" className="link-button" onClick={reload}>Tentar de novo</button></p>
      </section>
    );
  }
  return (
    <section className="rail-block" aria-labelledby="goals-title">
      <div className="rail-head">
        <h3 id="goals-title" className="rail-title">Metas</h3>
        {data && !editing && (
          <button type="button" className="link-button" onClick={() => setEditing(true)}>
            <Icon name="edit" size={13} /> {data.daily.target_seconds || data.weekly.target_seconds ? "Ajustar" : "Definir"}
          </button>
        )}
      </div>
      {!data && <div className="goal skeleton" style={{ height: 92 }} />}
      {data && editing && <GoalsForm goals={data} onDone={(g) => { if (g) setData(g); setEditing(false); }} />}
      {data && !editing && (
        <div className="goals">
          <GoalRow goal={data.daily} onSet={() => setEditing(true)} />
          <GoalRow goal={data.weekly} onSet={() => setEditing(true)} />
        </div>
      )}
    </section>
  );
}

function GoalRow({ goal, onSet }: { goal: Goal; onSet: () => void }) {
  const meta = PERIOD[goal.period];
  if (!goal.target_seconds) {
    return (
      <button type="button" className="goal goal-empty" onClick={onSet}>
        <span className="goal-title">{meta.title}</span>
        <span className="muted small">{meta.empty}</span>
      </button>
    );
  }
  const pct = goal.percent ?? 0;
  return (
    <div className={`goal ${goal.achieved ? "is-achieved" : ""}`}>
      <div className="goal-top">
        <span className="goal-title">{meta.title}</span>
        <span className="goal-pct">{goal.achieved ? <><Icon name="check" size={13} /> Cumprida</> : `${pct}%`}</span>
      </div>
      <div className="goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={meta.title}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="goal-numbers">
        <strong>{duration(goal.done_seconds)}</strong> de {duration(goal.target_seconds)}
        {!goal.achieved && goal.remaining_seconds ? <span className="muted"> · faltam {duration(goal.remaining_seconds)}</span> : null}
        {goal.achieved && <span className="muted"> · +{goal.xp} XP</span>}
      </p>
    </div>
  );
}

function toParts(seconds: number | null) {
  const m = Math.round((seconds ?? 0) / 60);
  return { h: Math.floor(m / 60), m: m % 60 };
}

function GoalsForm({ goals, onDone }: { goals: Goals; onDone: (g?: Goals) => void }) {
  const [daily, setDaily] = useState({ on: !!goals.daily.target_seconds, ...toParts(goals.daily.target_seconds ?? 7200) });
  const [weekly, setWeekly] = useState({ on: !!goals.weekly.target_seconds, ...toParts(goals.weekly.target_seconds ?? 54000) });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setError(null), [daily, weekly]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await focusApi.setGoals({
        daily_minutes: daily.on ? daily.h * 60 + daily.m : null,
        weekly_minutes: weekly.on ? weekly.h * 60 + weekly.m : null,
      });
      notify({ title: "Metas salvas", tone: "success" });
      onDone(saved);
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  const row = (period: "daily" | "weekly", value: typeof daily, set: (v: typeof daily) => void) => {
    const meta = PERIOD[period];
    const limits = goals[period].limits;
    return (
      <fieldset className="goal-field">
        <legend>
          <label className="check">
            <input type="checkbox" checked={value.on} onChange={(e) => set({ ...value, on: e.target.checked })} />
            <span>{meta.title}</span>
          </label>
        </legend>
        {value.on && (
          <>
            <div className="goal-inputs">
              <div className="unit-input">
                <input type="number" min={0} max={period === "daily" ? 12 : 80} value={value.h} onChange={(e) => set({ ...value, h: Math.max(0, Math.round(Number(e.target.value) || 0)) })} aria-label="Horas" />
                <span>h</span>
              </div>
              <div className="unit-input">
                <input type="number" min={0} max={59} step={5} value={value.m} onChange={(e) => set({ ...value, m: Math.min(59, Math.max(0, Math.round(Number(e.target.value) || 0))) })} aria-label="Minutos" />
                <span>min</span>
              </div>
            </div>
            <div className="chips">
              {meta.presets.map((min) => (
                <button key={min} type="button" className={`chip ${value.h * 60 + value.m === min ? "is-on" : ""}`} onClick={() => set({ ...value, h: Math.floor(min / 60), m: min % 60 })}>
                  {duration(min * 60)}
                </button>
              ))}
            </div>
            <small className="muted">
              De {duration(limits.min_minutes * 60)} a {duration(limits.max_minutes * 60)}.
            </small>
          </>
        )}
      </fieldset>
    );
  };

  return (
    <form className="goals-form" onSubmit={submit}>
      {row("daily", daily, setDaily)}
      {row("weekly", weekly, setWeekly)}
      <p className="muted small">Conta o tempo de concentração do temporizador. Meta não cumprida não tira nada de você.</p>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="dialog-actions">
        <button type="button" className="button button-sm" onClick={() => onDone()} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="button button-sm button-primary" disabled={busy}>
          {busy ? "Salvando..." : "Salvar metas"}
        </button>
      </div>
    </form>
  );
}
