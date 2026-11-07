// Lista de cursos da pessoa, compartilhada entre a tela inicial, a busca do topo
// e "Meus cursos": um pedido só, mesmo com várias partes da tela usando a lista.
// Recarrega ao voltar para a tela se estiver desatualizada (aula concluída) ou
// com mais de MAX_AGE_MS.
import { useEffect, useSyncExternalStore } from "react";
import { CourseCard, learningApi } from "./api";

const MAX_AGE_MS = 30_000;

interface State {
  data: CourseCard[] | null;
  error: Error | null;
  loading: boolean;
}

let state: State = { data: null, error: null, loading: false };
let fetchedAt = 0;
let stale = true;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function load(): Promise<void> {
  inflight ??= (async () => {
    stale = false;
    set({ loading: true });
    try {
      const data = await learningApi.courses();
      fetchedAt = Date.now();
      set({ data, error: null, loading: false });
    } catch (e) {
      stale = true;
      set({ error: e as Error, loading: false });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** O progresso de algum curso mudou: a próxima tela que mostrar a lista recarrega. */
export function invalidateCourses() {
  stale = true;
}

/** Tira da lista um curso já excluído no servidor, sem recarregar. */
export function forgetCourse(id: string) {
  if (state.data) set({ data: state.data.filter((c) => c.id !== id) });
}

export function resetCourses() {
  state = { data: null, error: null, loading: false };
  stale = true;
  fetchedAt = 0;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCourses() {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (stale || Date.now() - fetchedAt > MAX_AGE_MS) void load();
  }, []);
  return { ...snapshot, reload: () => void load() };
}
