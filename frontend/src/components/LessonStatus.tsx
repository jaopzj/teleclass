import type { CSSProperties } from "react";
import { LessonProgress } from "../learning/api";
import Icon from "./Icon";

export type Status = "completed" | "in-progress" | "pending";

export function lessonStatus(progress: LessonProgress | null): Status {
  if (progress?.completed) return "completed";
  if (progress?.last_watched_at && progress.position_seconds > 0) return "in-progress";
  return "pending";
}

export function watchedPercent(progress: LessonProgress | null, duration: number | null) {
  const total = progress?.duration_seconds || duration;
  if (!progress || !total) return 0;
  return Math.min(100, (progress.position_seconds / total) * 100);
}

const LABELS: Record<Status, string> = {
  completed: "Concluída",
  "in-progress": "Em andamento",
  pending: "Não iniciada",
};

/** ● concluída, ◐ em andamento, ○ pendente (PLANO.md, 8). */
export default function LessonStatusIcon({ status, percent = 0 }: { status: Status; percent?: number }) {
  if (status === "completed") {
    return (
      <span className="status status-completed" title={LABELS[status]} aria-label={LABELS[status]}>
        <Icon name="check" size={14} />
      </span>
    );
  }
  const angle = status === "in-progress" ? Math.max(percent, 8) * 3.6 : 0;
  return (
    <span
      className={`status status-${status}`}
      style={{ "--angle": `${angle}deg` } as CSSProperties}
      title={LABELS[status]}
      aria-label={LABELS[status]}
    />
  );
}
