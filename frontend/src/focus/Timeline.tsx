import { TimelineStep } from "./api";
import { duration } from "./derive";

/**
 * Caminho da sessão em proporção: cada etapa ocupa a largura da sua duração.
 * `current`: índice da etapa em andamento (sessão ativa).
 */
export default function Timeline({
  steps,
  current,
  progress = 0,
  compact = false,
}: {
  steps: TimelineStep[];
  current?: number;
  progress?: number;
  compact?: boolean;
}) {
  if (!steps.length || steps[0].seconds == null) {
    return (
      <div className={`timeline is-open ${compact ? "is-compact" : ""}`} aria-label="Sem duração definida">
        <span className="timeline-seg is-focus" style={{ flex: 1 }} />
      </div>
    );
  }
  const total = steps.reduce((a, s) => a + (s.seconds ?? 0), 0);
  return (
    <div className={`timeline ${compact ? "is-compact" : ""}`} role="list" aria-label="Etapas da sessão">
      {steps.map((s, i) => {
        const state = current == null ? "" : i < current ? "is-past" : i === current ? "is-now" : "";
        const kind = s.stage === "focus" ? "is-focus" : s.stage === "long_break" ? "is-long" : "is-break";
        const label = `${s.stage === "focus" ? `Foco ${s.cycle}` : s.stage === "long_break" ? "Pausa longa" : "Pausa"}: ${duration(s.seconds ?? 0)}`;
        return (
          <span
            key={i}
            role="listitem"
            aria-label={label}
            title={label}
            className={`timeline-seg ${kind} ${state}`}
            style={{ flex: `${(s.seconds ?? 0) / total} 1 0`, ["--p" as string]: i === current ? progress : i < (current ?? -1) ? 1 : 0 }}
          />
        );
      })}
    </div>
  );
}

/** Índice da etapa atual dentro da linha do tempo do plano. */
export function timelineIndex(steps: TimelineStep[], stage: string, cycle: number): number | undefined {
  if (stage === "ready") return steps.findIndex((s) => s.stage === "focus" && s.cycle === cycle) - 0.5;
  const i = steps.findIndex((s) => s.cycle === cycle && (stage === "focus" ? s.stage === "focus" : s.stage !== "focus"));
  return i >= 0 ? i : undefined;
}

export function planSummary(plan: { focus_seconds: number | null; short_break_seconds: number; long_break_seconds: number; long_break_every: number | null; cycles: number }) {
  if (plan.focus_seconds == null) return "Sem duração definida";
  const parts = [`${plan.focus_seconds / 60} min de foco`];
  if (plan.short_break_seconds) parts.push(`${plan.short_break_seconds / 60} de pausa`);
  if (plan.long_break_seconds && plan.long_break_every) parts.push(`${plan.long_break_seconds / 60} de pausa longa`);
  parts.push(`${plan.cycles} ${plan.cycles === 1 ? "ciclo" : "ciclos"}`);
  return parts.join(" · ");
}
