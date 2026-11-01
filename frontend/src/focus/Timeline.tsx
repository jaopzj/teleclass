import { TimelineStep } from "./api";
import { duration } from "./derive";

/**
 * Sequência da sessão em proporção: cada etapa ocupa a largura da sua duração.
 * `current`: índice da etapa em andamento; `progress`: fração dela já feita.
 */
export default function Timeline({
  steps,
  current,
  progress = 0,
  legend = false,
}: {
  steps: TimelineStep[];
  current?: number;
  progress?: number;
  legend?: boolean;
}) {
  if (!steps.length || steps[0].seconds == null) return null;
  const total = steps.reduce((a, s) => a + (s.seconds ?? 0), 0);
  const hasLong = steps.some((s) => s.stage === "long_break");
  const hasBreak = steps.some((s) => s.stage === "short_break");
  return (
    <div className="fx-seq">
      <ol className="fx-timeline" aria-label="Sequência da sessão">
        {steps.map((s, i) => {
          const state = current == null ? "" : i < current ? "is-past" : i === Math.floor(current) && Number.isInteger(current) ? "is-now" : "";
          const kind = s.stage === "focus" ? "is-focus" : s.stage === "long_break" ? "is-long" : "is-break";
          const label = `${s.stage === "focus" ? `Concentração ${s.cycle}` : s.stage === "long_break" ? "Pausa longa" : "Pausa"}: ${duration(s.seconds ?? 0)}`;
          const fill = current == null ? 0 : i < current ? 1 : i === current ? progress : 0;
          return (
            <li
              key={i}
              aria-label={label}
              title={label}
              className={`fx-seg-step ${kind} ${state}`}
              style={{ flexGrow: (s.seconds ?? 0) / total, ["--p" as string]: fill }}
            />
          );
        })}
      </ol>
      {legend && (
        <ul className="fx-legend" aria-hidden="true">
          <li className="is-focus">Concentração</li>
          {hasBreak && <li className="is-break">Pausa</li>}
          {hasLong && <li className="is-long">Pausa longa</li>}
        </ul>
      )}
    </div>
  );
}

/** Índice da etapa atual dentro da sequência do plano (meio índice em "pronto"). */
export function timelineIndex(steps: TimelineStep[], stage: string, cycle: number): number | undefined {
  if (stage === "ready") return steps.findIndex((s) => s.stage === "focus" && s.cycle === cycle) - 0.5;
  const i = steps.findIndex((s) => s.cycle === cycle && (stage === "focus" ? s.stage === "focus" : s.stage !== "focus"));
  return i >= 0 ? i : undefined;
}

export function planSummary(plan: { focus_seconds: number | null; short_break_seconds: number; long_break_seconds: number; long_break_every: number | null; cycles: number }) {
  if (plan.focus_seconds == null) return "Contagem livre, sem duração";
  const parts = [`${plan.focus_seconds / 60} min de foco`];
  if (plan.short_break_seconds) parts.push(`${plan.short_break_seconds / 60} de pausa`);
  parts.push(`${plan.cycles} ${plan.cycles === 1 ? "ciclo" : "ciclos"}`);
  return parts.join(" · ");
}
