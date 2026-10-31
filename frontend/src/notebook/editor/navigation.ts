// Abrir o conteúdo de uma referência ou de um timestamp.
// Se o player daquela aula está aberto, só posiciona o vídeo; senão navega até
// a aula com `?t=`, e a página da aula posiciona o player ao carregar.
import { getPlayer } from "../../player/controller";
import { navigate, paths } from "../../router";

export interface Target {
  courseId: string;
  kind: "course" | "section" | "lesson";
  sectionId?: string | null;
  lessonKey?: string | null;
  seconds?: number | null;
}

export function targetHref(t: Target) {
  if (t.kind === "lesson" && t.lessonKey) return paths.lesson(t.courseId, t.lessonKey, t.seconds ?? null);
  if (t.kind === "section" && t.sectionId) return paths.module(t.courseId, t.sectionId);
  return paths.course(t.courseId);
}

export function openTarget(t: Target, newTab = false) {
  if (t.kind === "lesson" && t.lessonKey && !newTab) {
    const player = getPlayer(t.courseId, t.lessonKey);
    if (player) {
      if (t.seconds != null) player.seek(t.seconds, { play: true });
      return;
    }
  }
  const href = targetHref(t);
  if (newTab) window.open(href, "_blank", "noopener");
  else navigate(href);
}
