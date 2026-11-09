// Tipos e chamadas da Minha Rotina. Espelham app/api/routine.py (docs/minha-rotina.md).
import { request } from "../api";

export type Mode = "scheduled" | "sequence" | "flexible";
export type RoutineStatus = "active" | "paused" | "archived";
export type Status = "pending" | "in_progress" | "completed" | "skipped" | "cancelled";
export type Period = "morning" | "afternoon" | "evening";
export type Priority = "low" | "normal" | "high";
export type LinkType = "course" | "module" | "lesson";
export type EditScope = "occurrence" | "following" | "routine";

export interface LinkInput {
  type: LinkType;
  course_id: string;
  section_id?: string | null;
  lesson_key?: string | null;
}

export interface ContentLink extends LinkInput {
  available: boolean;
  course_title: string | null;
  module_title: string | null;
  lesson_title: string | null;
}

/** Campos editáveis de uma atividade (de rotina ou avulsa). */
export interface ActivityFields {
  title: string;
  description: string;
  icon_key: string | null;
  color: string | null;
  duration_minutes: number | null;
  start_time: string | null;
  period: Period | null;
  priority: Priority;
  is_optional: boolean;
  notes: string;
}

export interface RoutineActivity extends ActivityFields {
  id: string;
  link: ContentLink | null;
}

export interface Routine {
  id: string;
  name: string;
  description: string;
  icon_key: string | null;
  color: string | null;
  mode: Mode;
  preferred_start_time: string | null;
  status: RoutineStatus;
  /** Segunda = 0 ... domingo = 6. */
  weekdays: number[];
  activities: RoutineActivity[];
  estimated_minutes: number;
  window: { start: string; end: string | null } | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface Occurrence extends ActivityFields {
  id: string;
  date: string;
  display_period: Period | null;
  position: number;
  status: Status;
  source: "routine" | "manual";
  customized: boolean;
  rescheduled_from: string | null;
  skip_reason: string | null;
  completed_at: string | null;
  /** Tempo de foco das sessões do Foco ligadas a esta atividade. */
  timer_seconds: number;
  /** O cronômetro do Foco está rodando nesta atividade agora. */
  focusing: boolean;
  manual_seconds: number | null;
  invested_seconds: number;
  link: ContentLink | null;
  routine: { id: string; name: string; color: string | null; icon_key: string | null; mode: Mode; deleted: boolean } | null;
  routine_activity_id: string | null;
  history?: { type: string; data: Record<string, unknown> | null; at: string }[];
  conflicts?: { id: string; title: string; start_time: string | null }[];
}

export interface DaySummary {
  planned: number;
  completed: number;
  skipped: number;
  in_progress: number;
  remaining: number;
  cancelled: number;
  optional_total: number;
  optional_completed: number;
  planned_minutes: number;
  invested_seconds: number;
  /** null = sem planejamento (nunca 0% nem 100%). */
  progress: number | null;
  /** Tempo feito ÷ planejado (cada atividade conta até a própria duração). null = nada com duração. */
  time_progress: number | null;
  time_done_seconds: number;
  consistent: boolean | null;
}

export interface Streak {
  current: number;
  best: number;
  today_counted: boolean;
  rule?: { min_ratio: number; min_completed: number };
}

export interface AgendaDay {
  date: string;
  occurrences: Occurrence[];
  summary: DaySummary;
  /** Pares de ids com horários sobrepostos. */
  conflicts: [string, string][];
}

export interface DayDetail extends AgendaDay {
  routines: { id: string; name: string; color: string | null; icon_key: string | null; origin: "schedule" | "manual"; status: RoutineStatus }[];
  streak: Streak;
  today: string;
  timezone: string;
}

export interface Agenda {
  today: string;
  timezone: string;
  days: AgendaDay[];
}

export interface ApplyPreview {
  routine_id: string;
  date: string;
  already_applied: boolean;
  shifted: boolean;
  items: {
    activity_id: string;
    title: string;
    start_time: string | null;
    duration_minutes: number | null;
    period: Period | null;
    already_in_day: boolean;
    duplicate_of: { id: string; title: string } | null;
    conflicts: { id: string; title: string; start_time: string | null }[];
  }[];
}

export interface Stats {
  from: string;
  to: string;
  today: string;
  days: (DaySummary & { date: string })[];
  totals: {
    completed: number;
    planned: number;
    skipped: number;
    invested_seconds: number;
    planned_minutes: number;
    planned_days: number;
    consistent_days: number;
    time_done_seconds: number;
    time_progress: number | null;
  };
  streak: Streak;
  routines: { id: string; name: string; color: string | null; icon_key: string | null; completed: number; planned: number; planned_minutes: number; time_done_seconds: number; time_progress: number | null }[];
}

export type ActivityInput = Partial<ActivityFields> & { title: string; link?: LinkInput | null };
export type RoutineActivityInput = ActivityInput & { id?: string };

export interface RoutineInput {
  name: string;
  description: string;
  icon_key: string | null;
  color: string | null;
  mode: Mode;
  preferred_start_time: string | null;
  weekdays: number[];
  activities: RoutineActivityInput[];
}

const BASE = "/api/routine";
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const routineApi = {
  routines: () => request<Routine[]>(`${BASE}/routines`),
  routine: (id: string) => request<Routine>(`${BASE}/routines/${id}`),
  createRoutine: (body: RoutineInput) => request<Routine>(`${BASE}/routines`, json("POST", body)),
  saveRoutine: (id: string, body: RoutineInput) => request<Routine>(`${BASE}/routines/${id}`, json("PUT", body)),
  setRoutineStatus: (id: string, status: RoutineStatus) => request<Routine>(`${BASE}/routines/${id}/status`, json("POST", { status })),
  deleteRoutine: (id: string) => request<void>(`${BASE}/routines/${id}`, json("DELETE")),

  agenda: (from: string, to: string) => request<Agenda>(`${BASE}/agenda?from=${from}&to=${to}`),
  day: (date: string) => request<DayDetail>(`${BASE}/day/${date}`),
  stats: (from?: string, to?: string) =>
    request<Stats>(`${BASE}/stats${from && to ? `?from=${from}&to=${to}` : ""}`),

  previewApply: (routine_id: string, date: string, start_time?: string | null) =>
    request<ApplyPreview>(`${BASE}/apply/preview`, json("POST", { routine_id, date, start_time: start_time || null })),
  apply: (routine_id: string, date: string, opts: { start_time?: string | null; skip_duplicates?: boolean } = {}) =>
    request<{ created: string[] }>(`${BASE}/apply`, json("POST", { routine_id, date, start_time: opts.start_time || null, skip_duplicates: !!opts.skip_duplicates })),
  unapply: (routine_id: string, date: string) => request<{ removed: number }>(`${BASE}/apply/${routine_id}/${date}`, json("DELETE")),

  createOccurrence: (date: string, body: ActivityInput & { repeat_weekdays?: number[] | null }) =>
    request<Occurrence>(`${BASE}/occurrences`, json("POST", { ...body, date })),
  occurrence: (id: string) => request<Occurrence>(`${BASE}/occurrences/${id}`),
  updateOccurrence: (id: string, changes: Partial<ActivityFields> & { link?: LinkInput | null }, scope: EditScope = "occurrence") =>
    request<Occurrence>(`${BASE}/occurrences/${id}`, json("PATCH", { ...changes, scope })),
  setStatus: (id: string, status: Exclude<Status, "in_progress">, extra: { actual_minutes?: number | null; reason?: string | null } = {}) =>
    request<Occurrence>(`${BASE}/occurrences/${id}/status`, json("POST", { status, ...extra })),
  reschedule: (id: string, date: string, start_time: string | null) =>
    request<Occurrence>(`${BASE}/occurrences/${id}/reschedule`, json("POST", { date, start_time })),
  reorder: (date: string, ids: string[]) => request<void>(`${BASE}/occurrences/reorder`, json("POST", { date, ids })),
  removeOccurrence: (id: string) => request<void>(`${BASE}/occurrences/${id}`, json("DELETE")),

};
