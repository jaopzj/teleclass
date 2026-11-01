// Central de avisos da plataforma: aviso na tela (toast), notificação do sistema
// operacional (API Notification, com permissão) e um som curto. Qualquer módulo
// pode usar; o temporizador é o primeiro. Não há outro sistema de avisos no app.
import { useSyncExternalStore } from "react";

export type Tone = "neutral" | "focus" | "rest" | "success" | "reward";

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone: Tone;
  /** Aviso essencial: aparece mesmo no Focus Mode. */
  essential?: boolean;
  action?: { label: string; run: () => void };
  createdAt: number;
}

export interface NotifyOptions {
  title: string;
  body?: string;
  tone?: Tone;
  essential?: boolean;
  /** Mesma `tag` em várias abas: o sistema mostra uma notificação só. */
  tag?: string;
  inApp?: boolean;
  system?: boolean;
  sound?: boolean;
  action?: Toast["action"];
  durationMs?: number;
}

const MAX_TOASTS = 4;
let toasts: Toast[] = [];
let quiet = false; // Focus Mode: só avisos essenciais
const listeners = new Set<() => void>();
const timers = new Map<string, number>();

function emit() {
  listeners.forEach((l) => l());
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  emit();
}

export function setQuietMode(value: boolean) {
  quiet = value;
}

export function notify(options: NotifyOptions) {
  const { inApp = true, system = false, sound = false } = options;
  if (quiet && !options.essential) return;
  if (inApp) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const toast: Toast = {
      id,
      title: options.title,
      body: options.body,
      tone: options.tone ?? "neutral",
      essential: options.essential,
      action: options.action,
      createdAt: Date.now(),
    };
    toasts = [...toasts, toast].slice(-MAX_TOASTS);
    timers.set(id, window.setTimeout(() => dismissToast(id), options.durationMs ?? 6500));
    emit();
  }
  if (system) showSystemNotification(options);
  if (sound) chime(options.tone ?? "neutral");
}

export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
}

// --- notificação do sistema --------------------------------------------------------

export function systemPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export async function requestSystemPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function showSystemNotification(options: NotifyOptions) {
  if (systemPermission() !== "granted") return;
  // Com a aba à vista o aviso na tela já basta.
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const n = new Notification(options.title, { body: options.body, tag: options.tag, silent: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* alguns navegadores só permitem notificações via service worker */
  }
}

// --- som curto ------------------------------------------------------------------------

let audio: AudioContext | null = null;

function context(): AudioContext | null {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

const TONES: Record<Tone, number[]> = {
  neutral: [660],
  focus: [523.25, 659.25],
  rest: [659.25, 523.25],
  success: [523.25, 659.25, 783.99],
  reward: [659.25, 783.99, 1046.5],
};

/** Duas ou três notas suaves (seno com envelope curto). Nada estridente. */
export function chime(tone: Tone = "neutral", volume = 0.12) {
  const ctx = context();
  if (!ctx) return;
  const start = ctx.currentTime + 0.02;
  TONES[tone].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = start + i * 0.16;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1);
  });
}
