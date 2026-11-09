// Tipos e chamadas do temporizador. Espelham app/api/focus.py (docs/temporizador.md).
import { request } from "../api";

export type Technique = "pomodoro" | "52_17" | "deep_work" | "custom" | "stopwatch";
export type Stage = "focus" | "short_break" | "long_break" | "ready" | "ended";
export type Action = "pause" | "resume" | "start_next" | "unlock_break" | "stop";

export interface Plan {
  technique: Technique;
  focus_seconds: number | null;
  short_break_seconds: number;
  long_break_seconds: number;
  long_break_every: number | null;
  cycles: number;
}

export interface TimelineStep {
  stage: "focus" | "short_break" | "long_break";
  cycle: number;
  seconds: number | null;
}

export interface Preset {
  technique: Technique;
  name: string;
  description: string;
  plan: Plan;
  timeline: TimelineStep[];
  focus_options: number[];
  configurable: boolean;
}

export interface Method {
  id: string;
  name: string;
  focus_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  long_break_every: number | null;
  cycles: number;
  plan: Plan;
  timeline: TimelineStep[];
  created_at: string;
  updated_at: string;
}

export interface MethodInput {
  name: string;
  focus_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  long_break_every: number | null;
  cycles: number;
}

export interface LadderStep {
  level: number;
  title: string;
  description?: string;
  xp: number;
}

export interface Catalog {
  presets: Preset[];
  methods: Method[];
  limits: { focus_minutes: [number, number]; break_minutes: [number, number]; cycles: [number, number]; stopwatch_limit_seconds: number };
  rules: {
    focus_xp_per_minute: number;
    daily_focus_xp_cap: number;
    cycle_xp: number;
    cycle_min_focus_seconds: number;
    daily_cycle_bonus_cap: number;
    session_xp: number;
    session_min_focus_seconds: number;
    goal_xp: { daily: number; weekly: number };
    rarity_xp: Record<string, number>;
  };
  ladder: LadderStep[];
}

export interface FocusSession {
  id: string;
  version: number;
  technique: Technique;
  method_id: string | null;
  method_name: string;
  plan: Plan;
  timeline: TimelineStep[];
  intention: string | null;
  /** Atividade da Minha Rotina que recebe este tempo de foco. */
  activity_id?: string | null;
  course: { id: string; title: string | null } | null;
  lesson: { key: string; title: string | null } | null;
  status: "active";
  stage: Stage;
  paused: boolean;
  running: boolean;
  cycle: number;
  cycles_total: number;
  cycles_completed: number;
  cycles_invalidated: number;
  phase_index: number;
  phase_started_at: number | null;
  phase_ends_at: number | null;
  run_started_at: number | null;
  paused_at: number | null;
  phase_focus_seconds: number;
  focus_seconds: number;
  break_seconds: number;
  started_at: number;
  xp: number;
  next: { stage: "focus" | "short_break" | "long_break" | "end"; seconds?: number | null; cycle?: number } | null;
  deadline_at: number | null;
}

export interface EndedSummary {
  session_id: string;
  status: "completed" | "stopped" | "expired";
  end_reason: string | null;
  technique: Technique;
  method_name: string;
  focus_seconds: number;
  cycles_completed: number;
  cycles_invalidated: number;
  xp: number;
}

export interface Progression {
  xp: number;
  level: number;
  title: string;
  title_description: string;
  level_xp: number;
  next_level_xp: number;
  into_level: number;
  level_span: number;
  percent: number;
  next_title: { level: number; title: string; xp: number } | null;
}

export type Notice =
  | ({ id: number; at: number; kind: "focus_completed" } & { session_id: string; cycle: number; break: string | null; break_seconds?: number })
  | { id: number; at: number; kind: "break_ending" }
  | ({ id: number; at: number; kind: "break_completed" } & { session_id: string; next_cycle: number })
  | ({ id: number; at: number; kind: "session_ended" } & EndedSummary)
  | ({ id: number; at: number; kind: "goal_reached" } & { period: "daily" | "weekly"; target_seconds: number; xp: number })
  | ({ id: number; at: number; kind: "achievement_unlocked" } & { code: string; name: string; rarity: string; xp: number })
  | ({ id: number; at: number; kind: "level_up" } & { level: number; title: string; new_title: boolean });

export interface FocusState {
  server_now: number;
  session: FocusSession | null;
  locked: boolean;
  replayed: boolean;
  ended: EndedSummary | null;
  notices?: Notice[];
  notice_cursor?: number;
  progress?: Progression;
}

export interface StartInput {
  technique: Technique;
  method_id?: string | null;
  focus_minutes?: number | null;
  cycles?: number | null;
  custom?: Omit<MethodInput, "name"> | null;
  intention?: string | null;
  course_id?: string | null;
  lesson_key?: string | null;
  activity_id?: string | null;
}

export interface Achievement {
  code: string;
  name: string;
  description: string;
  category: string;
  rarity: "comum" | "incomum" | "rara" | "épica" | "lendária";
  xp: number;
  target: number;
  unit: "count" | "hours" | "days";
  current: number;
  unlocked_at: number | null;
}

export interface ProgressData {
  progress: Progression;
  ladder: LadderStep[];
  achievements: Achievement[];
  recent_xp: { kind: string; xp: number; at: number; ref: string }[];
  xp_by_kind: Record<string, number>;
}

export interface Goal {
  period: "daily" | "weekly";
  target_seconds: number | null;
  done_seconds: number;
  remaining_seconds: number | null;
  percent: number | null;
  achieved: boolean;
  start: string;
  times_achieved: number;
  xp: number;
  limits: { min_minutes: number; max_minutes: number };
}

export type Goals = Record<"daily" | "weekly", Goal>;

export interface HistoryItem {
  id: string;
  technique: Technique;
  technique_name: string;
  method_name: string;
  custom_method: boolean;
  intention: string | null;
  course: { id: string; title: string | null } | null;
  lesson: { key: string; title: string | null } | null;
  status: "completed" | "stopped" | "expired";
  end_reason: string | null;
  started_at: number;
  ended_at: number | null;
  focus_seconds: number;
  break_seconds: number;
  pause_seconds: number;
  total_seconds: number;
  cycles_completed: number;
  cycles_invalidated: number;
  cycles_total: number;
  breaks_completed: number;
  breaks_unlocked: number;
  xp: number;
  plan: Plan;
  phases?: {
    idx: number;
    stage: "focus" | "short_break" | "long_break";
    cycle: number;
    planned_seconds: number | null;
    started_at: number;
    ended_at: number;
    focus_seconds: number;
    pause_seconds: number;
    outcome: "completed" | "stopped" | "expired" | "unlocked" | "invalidated";
  }[];
}

export interface HistoryPage {
  items: HistoryItem[];
  next_before: number | null;
  courses: { id: string; title: string | null }[];
}

export type StatsRange = "7d" | "30d" | "90d" | "365d" | "all";

export interface StatsSummary {
  focus_seconds: number;
  cycles: number;
  sessions: number;
  completed_sessions: number;
  average_session_seconds: number | null;
  active_days: number;
  best_session: { id: string; focus_seconds: number; started_at: number; method_name: string; course_title: string | null } | null;
}

export interface FocusStats {
  range: StatsRange;
  start: string;
  end: string;
  days: number;
  timezone: string;
  active_day_seconds: number;
  summary: StatsSummary;
  previous: StatsSummary | null;
  all_time: { focus_seconds: number; first_day: string | null };
  by_course: { course_id: string | null; title: string | null; seconds: number; sessions: number }[];
  by_lesson: { course_id: string; lesson_key: string; title: string | null; course_title: string | null; seconds: number; sessions: number }[];
  by_technique: { technique: Technique; name: string; seconds: number; sessions: number }[];
  by_hour: number[];
  by_weekday: number[];
  daily: { date: string; seconds: number; cycles: number }[];
  weekly: { start: string; seconds: number }[];
  monthly: { month: string; seconds: number }[];
  heatmap: { date: string; seconds: number }[];
  heatmap_scale: number[];
}

export type NoticeKind =
  | "focus_completed"
  | "break_ending"
  | "break_completed"
  | "session_ended"
  | "goal_reached"
  | "achievement_unlocked"
  | "level_up";

export interface NotificationPreferences {
  in_app: boolean;
  system: boolean;
  sound: boolean;
  kinds: Record<NoticeKind, boolean>;
  break_ending_seconds: 0 | 30 | 60 | 120;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const focusApi = {
  catalog: () => request<Catalog>("/api/focus/catalog"),
  state: (after: number | null) =>
    request<FocusState>(`/api/focus/state${after != null ? `?after=${after}` : ""}`),
  start: (body: StartInput & { request_id: string; timezone: string }) =>
    request<FocusState>("/api/focus/sessions", { method: "POST", ...json(body) }),
  act: (sessionId: string, body: { action: Action; request_id: string; version: number; confirm?: boolean }) =>
    request<FocusState>(`/api/focus/sessions/${encodeURIComponent(sessionId)}/actions`, { method: "POST", ...json(body) }),

  methods: () => request<Method[]>("/api/focus/methods"),
  createMethod: (body: MethodInput) => request<Method>("/api/focus/methods", { method: "POST", ...json(body) }),
  updateMethod: (id: string, body: MethodInput) =>
    request<Method>(`/api/focus/methods/${encodeURIComponent(id)}`, { method: "PUT", ...json(body) }),
  deleteMethod: (id: string) => request<void>(`/api/focus/methods/${encodeURIComponent(id)}`, { method: "DELETE" }),

  progress: () => request<ProgressData>("/api/focus/progress"),
  goals: () => request<Goals>("/api/focus/goals"),
  setGoals: (body: { daily_minutes: number | null; weekly_minutes: number | null }) =>
    request<Goals>("/api/focus/goals", { method: "PUT", ...json(body) }),
  history: (params: { before?: number | null; technique?: string | null; course_id?: string | null }) => {
    const q = new URLSearchParams();
    if (params.before != null) q.set("before", String(params.before));
    if (params.technique) q.set("technique", params.technique);
    if (params.course_id) q.set("course_id", params.course_id);
    const s = q.toString();
    return request<HistoryPage>(`/api/focus/history${s ? `?${s}` : ""}`);
  },
  historyItem: (id: string) => request<HistoryItem>(`/api/focus/history/${encodeURIComponent(id)}`),
  stats: (range: StatsRange) => request<FocusStats>(`/api/focus/stats?range=${range}`),
  preferences: () => request<NotificationPreferences>("/api/focus/preferences"),
  setPreferences: (body: Partial<NotificationPreferences>) =>
    request<NotificationPreferences>("/api/focus/preferences", { method: "PUT", ...json(body) }),
};

export function newRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Navegadores antigos: UUID v4 a partir de getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
