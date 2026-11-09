// Revisão da Minha Rotina: um contador que faz agenda, resumo e listas
// recarregarem depois de uma mudança. O tempo das atividades vem do cronômetro
// do Foco (focus/store.ts); quando a sessão do Foco começa, pausa ou termina,
// as telas da rotina recarregam também.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useFocus } from "../focus/store";

let revision = 0;
const listeners = new Set<() => void>();

/** Algo mudou na rotina: agenda, resumo e listas recarregam. */
export function bumpRoutine() {
  revision += 1;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoutineRevision() {
  return useSyncExternalStore(subscribe, () => revision);
}

/** Recarrega a rotina quando a sessão do Foco muda de forma relevante. */
export function useFocusChanges() {
  const { session } = useFocus();
  const key = session ? `${session.id}:${session.activity_id ?? ""}:${session.paused}:${session.stage}` : "none";
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    bumpRoutine();
  }, [key]);
}
