// Tipos e chamadas do rastreamento de estudo. Espelham app/api/study.py.
import { request } from "../api";

export interface SegmentPayload {
  seq: number;
  start_ms: number;
  end_ms: number;
  media_from: number | null;
  media_to: number | null;
  rate: number | null;
}

export interface SegmentResult {
  seq: number;
  status: "accepted" | "adjusted" | "rejected";
  credited_seconds: number;
  reason: string | null;
  duplicate: boolean;
}

export interface StudySession {
  id: string;
  source: "video" | "timer";
  course_id: string | null;
  lesson_key: string | null;
  opened_at: number;
  credited_seconds: number;
}

export interface WeekDay {
  date: string;
  seconds: number | null; // null = dia ainda não chegou
  active: boolean;
}

export interface StudyMetrics {
  timezone: string;
  timezone_configured: boolean;
  generated_at: string;
  rules: { active_day_seconds: number; average_window_days: number; week_starts_on: "monday" };
  today: { date: string; seconds: number; active: boolean };
  week: { start: string; end: string; seconds: number; previous_to_date_seconds: number; days: WeekDay[] };
  streak: { current: number; includes_today: boolean; best: number };
  daily_average: {
    window_start: string;
    window_end: string;
    days: number;
    seconds_per_day: number;
    active_days: number;
    seconds_per_active_day: number | null;
  } | null;
  total: { seconds: number; by_source: Record<string, number>; first_day: string | null };
  lessons: { completed: number; completed_this_week: number };
  courses: {
    started: number;
    finished: number;
    completed_lessons: number;
    total_lessons: number;
    percent: number;
    without_lessons: number;
  };
}

export const studyApi = {
  openSession: (body: { id: string; source: "video"; course_id: string; lesson_key: string; timezone: string }) =>
    request<StudySession>("/api/study/sessions", { method: "POST", body: JSON.stringify(body) }),

  /** `keepalive` deixa o envio terminar mesmo se a página for fechada. */
  sendSegments: (sessionId: string, segments: SegmentPayload[], keepalive = false) =>
    request<{ session: StudySession; results: SegmentResult[] }>(
      `/api/study/sessions/${encodeURIComponent(sessionId)}/segments`,
      { method: "POST", keepalive, body: JSON.stringify({ segments }) },
    ),

  metrics: () => request<StudyMetrics>("/api/study/metrics"),
  setTimezone: (timezone: string) =>
    request<{ timezone: string }>("/api/study/preferences", { method: "PUT", body: JSON.stringify({ timezone }) }),
};

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
