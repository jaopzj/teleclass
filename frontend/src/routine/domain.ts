// Regras de exibição da Minha Rotina: grupos da timeline, rótulos de status,
// durações e próxima atividade. Os números do resumo vêm prontos do servidor.
import type { Occurrence, Period, Status } from "./api";
import { toMinutes, toTime } from "./dates";

export const STATUS_LABEL: Record<Status, string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  completed: "Concluída",
  skipped: "Pulada",
  cancelled: "Cancelada",
};

export const PERIODS: { key: Period; label: string; range: string }[] = [
  { key: "morning", label: "Manhã", range: "até 12h" },
  { key: "afternoon", label: "Tarde", range: "12h às 18h" },
  { key: "evening", label: "Noite", range: "depois das 18h" },
];

export const MODE_LABEL = { scheduled: "Por horário", sequence: "Por sequência", flexible: "Flexível" } as const;
export const MODE_HINT = {
  scheduled: "Cada atividade tem um horário definido.",
  sequence: "Uma atividade depois da outra, sem horário fixo.",
  flexible: "Atividades agrupadas em manhã, tarde e noite.",
} as const;

export const PRIORITY_LABEL = { low: "Baixa", normal: "Normal", high: "Alta" } as const;

export const isDone = (o: Occurrence) => o.status === "completed";
export const isClosed = (o: Occurrence) => o.status === "completed" || o.status === "skipped" || o.status === "cancelled";

/** "45 min", "1 h 30". */
export function minutesLabel(minutes: number | null | undefined) {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Tempo investido: "0 min", "12 min", "1 h 05". */
export function secondsLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes ? minutesLabel(minutes) : seconds > 0 ? "<1 min" : "0 min";
}

/** "08:00 – 08:45" ou "08:00". */
export function timeRange(o: { start_time: string | null; duration_minutes: number | null }) {
  const start = toMinutes(o.start_time);
  if (start == null) return "";
  return o.duration_minutes ? `${o.start_time} – ${toTime(start + o.duration_minutes)}` : o.start_time!;
}

export interface TimelineGroups {
  periods: { key: Period; label: string; range: string; items: Occurrence[] }[];
  unscheduled: Occurrence[];
}

/**
 * Timeline do dia: atividades com horário (ou período) em manhã, tarde e noite;
 * dentro de cada período, as com horário seguem o relógio e as só com período
 * vêm depois, na ordem escolhida. Sem horário nem período: "Sem horário".
 */
export function groupTimeline(items: Occurrence[]): TimelineGroups {
  const byPeriod = new Map<Period, Occurrence[]>(PERIODS.map((p) => [p.key, []]));
  const unscheduled: Occurrence[] = [];
  for (const item of items) {
    if (item.display_period) byPeriod.get(item.display_period)!.push(item);
    else unscheduled.push(item);
  }
  const order = (a: Occurrence, b: Occurrence) => {
    const ta = toMinutes(a.start_time);
    const tb = toMinutes(b.start_time);
    if (ta != null && tb != null) return ta - tb || a.position - b.position;
    if (ta != null) return -1;
    if (tb != null) return 1;
    return a.position - b.position;
  };
  unscheduled.sort((a, b) => a.position - b.position);
  return {
    periods: PERIODS.map((p) => ({ ...p, items: byPeriod.get(p.key)!.sort(order) })).filter((p) => p.items.length),
    unscheduled,
  };
}

/**
 * Atividade em andamento, ou a próxima: a primeira pendente com horário a partir
 * de agora; senão a primeira pendente na ordem do dia.
 */
export function nextActivity(items: Occurrence[], nowMin: number | null): { item: Occurrence; current: boolean } | null {
  const running = items.find((o) => o.status === "in_progress");
  if (running) return { item: running, current: true };
  const pending = items.filter((o) => o.status === "pending");
  if (!pending.length) return null;
  const timed = pending
    .filter((o) => o.start_time)
    .sort((a, b) => toMinutes(a.start_time)! - toMinutes(b.start_time)!);
  if (nowMin != null) {
    const now = timed.find((o) => {
      const start = toMinutes(o.start_time)!;
      return start <= nowMin && nowMin < start + (o.duration_minutes || 1);
    });
    if (now) return { item: now, current: true };
    const upcoming = timed.find((o) => toMinutes(o.start_time)! > nowMin);
    if (upcoming) return { item: upcoming, current: false };
  }
  const { periods, unscheduled } = groupTimeline(pending);
  const first = periods[0]?.items[0] ?? unscheduled[0];
  return first ? { item: first, current: false } : null;
}

/** Ids com algum conflito de horário, para a sinalização discreta. */
export function conflictIds(pairs: [string, string][]) {
  const map = new Map<string, string[]>();
  for (const [a, b] of pairs) {
    map.set(a, [...(map.get(a) ?? []), b]);
    map.set(b, [...(map.get(b) ?? []), a]);
  }
  return map;
}

/** Densidade da agenda semanal: 0 (livre) a 3 (cheio), pelo tempo planejado. */
export function busyLevel(minutes: number, count: number) {
  if (!count) return 0;
  if (minutes >= 6 * 60 || count >= 8) return 3;
  if (minutes >= 3 * 60 || count >= 5) return 2;
  return 1;
}

/** Saudação pelo horário local. */
export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Boa noite";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

/** Relógio do cronômetro: "04:09", "1:02:33". */
export function clock(seconds: number) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
