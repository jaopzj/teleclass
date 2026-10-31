// Focus Mode: preferência deste dispositivo (não muda nada no servidor).
// Só fica ativo com uma sessão em andamento; durante as pausas, a tela de
// descanso tem prioridade sobre ele.
import { useEffect, useSyncExternalStore } from "react";
import { setQuietMode } from "../notifications/center";

const KEY = "teleaula:focus:mode";
const listeners = new Set<() => void>();
let enabled = read();

function read() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setFocusMode(value: boolean) {
  enabled = value;
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    /* modo privado */
  }
  listeners.forEach((l) => l());
}

export function useFocusModePreference() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => enabled,
  );
}

/** Aplica o modo à página (classe no body e avisos só essenciais). */
export function useFocusModeEffect(active: boolean) {
  useEffect(() => {
    document.body.classList.toggle("is-focus-mode", active);
    setQuietMode(active);
    return () => {
      document.body.classList.remove("is-focus-mode");
      setQuietMode(false);
    };
  }, [active]);
}
