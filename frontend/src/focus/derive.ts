// Contagem derivada dos instantes do servidor. Funções puras: recebem a sessão
// e o "agora" já no relógio do servidor (Date.now() + diferença medida).
import { FocusSession, Stage } from "./api";

export interface Readout {
  /** Segundos que faltam para o fim da etapa (null no cronômetro livre e em "pronto"). */
  remaining: number | null;
  /** Segundos passados na etapa (foco: só o tempo sem pausa). */
  elapsed: number;
  /** Fração concluída da etapa, de 0 a 1 (null quando não há duração). */
  fraction: number | null;
  /** Foco total da sessão até agora. */
  focus: number;
  /** Duração planejada da etapa. */
  duration: number | null;
}

export function readout(s: FocusSession, now: number): Readout {
  const running = s.stage === "focus" && s.run_started_at != null && !s.paused;
  const runFocus = running ? Math.max(0, now - (s.run_started_at as number)) : 0;
  const focus = s.focus_seconds + runFocus;
  if (s.stage === "focus") {
    const elapsed = s.phase_focus_seconds + runFocus;
    const duration = s.plan.focus_seconds;
    if (duration == null) return { remaining: null, elapsed, fraction: null, focus, duration: null };
    let remaining: number;
    if (s.paused) remaining = Math.max(0, duration - s.phase_focus_seconds);
    else remaining = Math.max(0, (s.phase_ends_at ?? now) - now);
    return { remaining, elapsed, fraction: clamp(1 - remaining / duration), focus, duration };
  }
  if (s.stage === "short_break" || s.stage === "long_break") {
    const start = s.phase_started_at ?? now;
    const end = s.phase_ends_at ?? now;
    const duration = Math.max(1, end - start);
    const remaining = Math.max(0, end - now);
    return { remaining, elapsed: Math.max(0, now - start), fraction: clamp(1 - remaining / duration), focus, duration };
  }
  return { remaining: null, elapsed: Math.max(0, now - (s.phase_started_at ?? now)), fraction: null, focus, duration: null };
}

/** Instante (servidor) da próxima mudança que o servidor fará sozinho, para sincronizar na hora. */
export function nextBoundary(s: FocusSession | null): number | null {
  if (!s) return null;
  const points = [s.deadline_at];
  if (s.stage !== "ready" && !s.paused) points.push(s.phase_ends_at);
  const valid = points.filter((p): p is number => p != null);
  return valid.length ? Math.min(...valid) : null;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

export function stageLabel(stage: Stage, paused = false) {
  if (paused) return "Pausado";
  switch (stage) {
    case "focus":
      return "Concentração";
    case "short_break":
      return "Pausa curta";
    case "long_break":
      return "Pausa longa";
    case "ready":
      return "Pronto para o próximo ciclo";
    default:
      return "Encerrada";
  }
}

export const isBreak = (stage: Stage | undefined) => stage === "short_break" || stage === "long_break";

/** "25:00", "1:05:09". Arredonda para cima na contagem regressiva: 0:00 só quando acabou. */
export function clock(seconds: number, { ceil = false } = {}) {
  const total = Math.max(0, ceil ? Math.ceil(seconds - 1e-6) : Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** "25 min", "1 h 30 min", "45 s". Arredonda para baixo (nunca mostra mais do que foi feito). */
export function duration(seconds: number) {
  if (seconds <= 0) return "0 min";
  if (seconds < 60) return `${Math.floor(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export type Tone = "focus" | "rest" | "ready" | "paused";

/** Tom visual da etapa: concentração (azul), descanso, pronto ou pausado (neutro). */
export function toneOf(s: FocusSession): Tone {
  if (isBreak(s.stage)) return "rest";
  if (s.stage === "ready") return "ready";
  return s.paused ? "paused" : "focus";
}

/** Rótulo curto da etapa, para espaços pequenos (widget, cabeçalhos). */
export function shortStage(s: FocusSession) {
  if (s.paused) return "Pausado";
  if (s.stage === "ready") return `Pronto · ciclo ${s.cycle}`;
  if (s.stage === "focus") return "Concentração";
  if (s.stage === "long_break") return "Pausa longa";
  if (s.stage === "short_break") return "Pausa";
  return "Encerrada";
}

export const isStopwatch = (s: FocusSession) => s.plan.focus_seconds == null;

/** O número em destaque: restante na contagem regressiva, decorrido no cronômetro. */
export function displayTime(s: FocusSession, r: Readout) {
  if (s.stage === "ready") return clock(s.plan.focus_seconds ?? 0);
  if (isStopwatch(s) && s.stage === "focus") return clock(r.elapsed);
  return clock(r.remaining ?? 0, { ceil: true });
}

/** "Pausa de 5 min", "Ciclo 3 · 25 min", "Fim da sessão". */
export function nextLabel(s: FocusSession): string | null {
  const n = s.next;
  if (!n) return null;
  if (n.stage === "end") return "Fim da sessão";
  const len = n.seconds ? ` de ${duration(n.seconds)}` : "";
  if (n.stage === "focus") return `Ciclo ${n.cycle ?? s.cycle + 1}${n.seconds ? ` · ${duration(n.seconds)}` : ""}`;
  return `${n.stage === "long_break" ? "Pausa longa" : "Pausa"}${len}`;
}

/**
 * Fração da sessão inteira (todas as etapas planejadas) já percorrida.
 * null no cronômetro livre, que não tem fim definido.
 */
export function sessionFraction(s: FocusSession, r: Readout): number | null {
  if (isStopwatch(s)) return null;
  const total = s.timeline.reduce((a, t) => a + (t.seconds ?? 0), 0);
  if (!total) return null;
  const at = s.timeline.findIndex((t) =>
    s.stage === "ready" ? t.stage === "focus" && t.cycle === s.cycle : t.cycle === s.cycle && (s.stage === "focus" ? t.stage === "focus" : t.stage !== "focus"),
  );
  if (at < 0) return null;
  const before = s.timeline.slice(0, at).reduce((a, t) => a + (t.seconds ?? 0), 0);
  const inside = s.stage === "ready" ? 0 : (r.fraction ?? 0) * (s.timeline[at].seconds ?? 0);
  return clamp((before + inside) / total);
}

/** Como uma sessão terminou, nos termos da interface. */
export const ENDED_LABEL: Record<"completed" | "stopped" | "expired", string> = {
  completed: "Concluída",
  stopped: "Interrompida",
  expired: "Expirada",
};
