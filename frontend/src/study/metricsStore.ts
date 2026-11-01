// Métricas de estudo em cache, com invalidação.
//
// A tela inicial lê daqui. O cache é marcado como desatualizado quando um
// trecho é creditado, uma aula é concluída ou o fuso muda. Ao voltar para a
// tela (ou para a aba) recarrega só se estiver desatualizado ou com mais de
// MAX_AGE_MS, evitando consultas repetidas.
import { useEffect, useSyncExternalStore } from "react";
import { StudyMetrics, studyApi } from "./api";

const MAX_AGE_MS = 60_000;

interface State {
  data: StudyMetrics | null;
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
      const data = await studyApi.metrics();
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

function refreshIfNeeded() {
  if (stale || Date.now() - fetchedAt > MAX_AGE_MS) void load();
}

/** Algo mudou no servidor: quem estiver exibindo as métricas recarrega. */
export function invalidateStudyMetrics() {
  stale = true;
  if (listeners.size && document.visibilityState === "visible") void load();
}

export function resetStudyMetrics() {
  state = { data: null, error: null, loading: false };
  stale = true;
  fetchedAt = 0;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStudyMetrics() {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    refreshIfNeeded();
    const onVisible = () => document.visibilityState === "visible" && refreshIfNeeded();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return { ...snapshot, reload: () => void load() };
}
