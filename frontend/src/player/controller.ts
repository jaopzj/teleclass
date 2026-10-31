// Ponte entre o player da aula aberta e o resto da página (anotações).
// Só existe um player por vez; as anotações leem o tempo atual e pedem saltos
// sem conhecer o <video>.
import { useSyncExternalStore } from "react";

export interface PlayerHandle {
  /** Aula a que o player pertence. */
  courseId: string;
  lessonKey: string;
  currentTime(): number;
  duration(): number | null;
  /** Posiciona no instante e continua tocando se já estava tocando. */
  seek(seconds: number, opts?: { play?: boolean }): void;
}

let active: PlayerHandle | null = null;
const listeners = new Set<() => void>();

export function registerPlayer(handle: PlayerHandle) {
  active = handle;
  listeners.forEach((l) => l());
  return () => {
    if (active === handle) {
      active = null;
      listeners.forEach((l) => l());
    }
  };
}

export function getPlayer(courseId?: string, lessonKey?: string): PlayerHandle | null {
  if (!active) return null;
  if (courseId && (active.courseId !== courseId || active.lessonKey !== lessonKey)) return null;
  return active;
}

export function usePlayer(courseId?: string, lessonKey?: string) {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => getPlayer(courseId, lessonKey),
  );
}
