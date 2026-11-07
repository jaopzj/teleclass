// Tipos e chamadas da área de membros. Espelham app/api/courses.py.
import { request } from "../api";
import { invalidateStudyMetrics } from "../study/metricsStore";
import { invalidateCourses } from "./coursesStore";

export type LessonKind = "video" | "file" | "text" | "unavailable";

export interface LessonProgress {
  position_seconds: number;
  duration_seconds: number | null;
  completed: boolean;
  completed_at: string | null;
  last_watched_at: string | null;
}

export interface VideoInfo {
  message_id: number;
  mime_type: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface LessonSummary {
  key: string;
  number: number;
  title: string;
  ref: string | null;
  kind: LessonKind;
  duration: number | null;
  video: VideoInfo | null;
  progress: LessonProgress | null;
}

export interface LessonRef {
  key: string;
  number: number;
  title: string;
  path: string[];
}

export interface CourseProgress {
  completed: number;
  total: number;
  percent: number;
  started: boolean;
  last_watched: (LessonRef & { watched_at: string }) | null;
  resume: (LessonRef & { position_seconds: number; duration: number | null }) | null;
}

export interface CourseStats {
  lessons: number;
  video_lessons: number;
  modules: number;
  duration: number;
}

export interface CourseCard {
  id: string;
  title: string;
  stats: CourseStats;
  progress: CourseProgress;
}

export interface CourseSection {
  id: string;
  title: string;
  level: number;
  implicit: boolean;
  total: number;
  completed: number;
  lessons: LessonSummary[];
  children: CourseSection[];
}

export interface CourseDetail extends CourseCard {
  strategy: "summary" | "fallback";
  sections: CourseSection[];
}

export interface MaterialInfo {
  message_id: number;
  kind: string;
  file_name: string | null;
  mime_type: string | null;
  size: number | null;
}

export interface LessonDetail {
  course: { id: string; title: string; total: number };
  lesson: LessonSummary & { path: string[]; description: string; materials: MaterialInfo[] };
  previous: LessonRef | null;
  next: LessonRef | null;
}

const base = (courseId: string) => `/api/courses/${encodeURIComponent(courseId)}`;
const lessonBase = (courseId: string, key: string) => `${base(courseId)}/lessons/${encodeURIComponent(key)}`;

export const mediaUrl = (courseId: string, messageId: number) => `${base(courseId)}/media/${messageId}`;
export const thumbUrl = (courseId: string, messageId: number) => `${mediaUrl(courseId, messageId)}/thumb`;

export const learningApi = {
  courses: () => request<CourseCard[]>("/api/courses"),
  course: (id: string) => request<CourseDetail>(base(id)),
  lesson: (id: string, key: string) => request<LessonDetail>(lessonBase(id, key)),
  /** Tira o curso da conta: some da biblioteca e o progresso é apagado. */
  removeCourse: (id: string) => request<void>(base(id), { method: "DELETE" }).then(() => invalidateStudyMetrics()),

  /** `keepalive` deixa a requisição terminar mesmo se a página for fechada. */
  savePosition: (id: string, key: string, position: number, duration: number | null, keepalive = false) => {
    invalidateCourses(); // "continuar de onde parou" muda
    return request<LessonProgress>(`${lessonBase(id, key)}/progress`, {
      method: "PUT",
      keepalive,
      body: JSON.stringify({ position_seconds: position, duration_seconds: duration }),
    });
  },

  setCompleted: (id: string, key: string, completed: boolean) =>
    request<{ progress: LessonProgress; course: { completed: number; total: number; percent: number } }>(
      `${lessonBase(id, key)}/completion`,
      { method: "PUT", body: JSON.stringify({ completed }) },
    ).then((result) => {
      invalidateStudyMetrics(); // aulas concluídas e progresso geral mudaram
      invalidateCourses();
      return result;
    }),
};
