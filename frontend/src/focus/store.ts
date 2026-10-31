// Estado do temporizador no navegador. O servidor é a fonte da verdade: aqui só
// guardamos a última resposta, a diferença entre o relógio do servidor e o do
// dispositivo e o que a interface precisa para mostrar a contagem.
//
// Sincronização:
// - ao abrir o app, a cada 15 s com a aba à vista (60 s em segundo plano), ao
//   voltar para a aba, ao reconectar e no instante exato da próxima transição
//   que o servidor fará (fim do foco, fim da pausa, prazo de inatividade);
// - entre abas do mesmo navegador, pelo BroadcastChannel (a aba que recebeu a
//   resposta repassa o estado para as outras na hora);
// - outros dispositivos aparecem na próxima sincronização; uma ação feita com
//   uma versão antiga recebe 409 e o estado novo, sem aplicar nada.
//
// Ações levam um `request_id`: reenviar depois de uma queda de conexão é seguro.
import { useSyncExternalStore } from "react";
import { ApiError } from "../api";
import { notify } from "../notifications/center";
import { browserTimezone } from "../study/api";
import { invalidateStudyMetrics } from "../study/metricsStore";
import {
  Action,
  EndedSummary,
  FocusSession,
  FocusState,
  focusApi,
  newRequestId,
  Notice,
  NotificationPreferences,
  Progression,
  StartInput,
} from "./api";
import { duration, isBreak, nextBoundary, readout } from "./derive";

const VISIBLE_POLL_MS = 15_000;
const HIDDEN_POLL_MS = 60_000;
const BOUNDARY_SLACK_MS = 350;
const RETRY_DELAYS_MS = [800, 2500];

export interface FocusSnapshot {
  status: "idle" | "loading" | "ready" | "error";
  session: FocusSession | null;
  locked: boolean;
  progress: Progression | null;
  error: string | null;
  busy: Action | "start" | null;
  online: boolean;
  lastEnded: EndedSummary | null;
  prefs: NotificationPreferences | null;
  /** Aumenta quando algo creditado mudou (foco, ciclos, XP): telas de metas e estatísticas recarregam. */
  revision: number;
}

let snap: FocusSnapshot = {
  status: "idle",
  session: null,
  locked: false,
  progress: null,
  error: null,
  busy: null,
  online: true,
  lastEnded: null,
  prefs: null,
  revision: 0,
};
const listeners = new Set<() => void>();
let userId: string | null = null;
let lastServerNow = 0;
let samples: { offset: number; rtt: number }[] = [];
let offset = 0; // segundos: relógio do servidor − relógio do dispositivo
let pollTimer: number | undefined;
let boundaryTimer: number | undefined;
let breakEndingTimer: number | undefined;
let channel: BroadcastChannel | null = null;
let inflight: Promise<void> | null = null;
const breakEndingShown = new Set<string>();

function set(next: Partial<FocusSnapshot>) {
  snap = { ...snap, ...next };
  listeners.forEach((l) => l());
}

export function useFocus(): FocusSnapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snap,
  );
}

/** "Agora" no relógio do servidor, em segundos. */
export function serverNow(): number {
  return Date.now() / 1000 + offset;
}

// --- cursor dos avisos (compartilhado entre abas pelo localStorage) -----------------

const cursorKey = () => `teleaula:focus:notices:${userId}`;

function readCursor(): number | null {
  try {
    const raw = localStorage.getItem(cursorKey());
    return raw == null ? null : Number(raw) || 0;
  } catch {
    return memoryCursor;
  }
}

let memoryCursor: number | null = null;

function writeCursor(value: number) {
  memoryCursor = value;
  try {
    localStorage.setItem(cursorKey(), String(value));
  } catch {
    /* modo privado: fica em memória */
  }
}

// --- aplicar uma resposta do servidor -----------------------------------------------------

function measure(serverTime: number, t0: number, t1: number) {
  const rtt = (t1 - t0) / 1000;
  samples = [...samples.slice(-5), { offset: serverTime - (t0 + t1) / 2000, rtt }];
  offset = samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
}

function apply(state: FocusState, { broadcast = true } = {}) {
  if (state.server_now < lastServerNow - 0.001) return; // resposta atrasada de outra aba
  lastServerNow = state.server_now;
  const previous = snap.session;
  const session = state.session;
  const credited =
    (previous?.focus_seconds ?? -1) !== (session?.focus_seconds ?? -1) ||
    previous?.cycles_completed !== session?.cycles_completed ||
    previous?.id !== session?.id;
  const next: Partial<FocusSnapshot> = {
    status: "ready",
    session,
    locked: state.locked,
    error: null,
    online: true,
  };
  if (state.progress) next.progress = state.progress;
  if (state.ended) next.lastEnded = state.ended;
  if (credited) next.revision = snap.revision + 1;
  set(next);
  if (credited) invalidateStudyMetrics();
  if (state.locked && !(previous && isBreak(previous.stage))) pauseVideos();
  if (state.notices?.length) present(state.notices);
  if (state.notice_cursor != null) {
    const cursor = readCursor();
    if (cursor == null || state.notice_cursor > cursor) writeCursor(state.notice_cursor);
  }
  schedule();
  if (broadcast) channel?.postMessage({ type: "state", state });
}

function pauseVideos() {
  document.querySelectorAll("video").forEach((v) => {
    if (!v.paused) v.pause();
  });
}

// --- sincronização ------------------------------------------------------------------------

export function sync(): Promise<void> {
  if (!userId) return Promise.resolve();
  inflight ??= (async () => {
    if (snap.status === "idle") set({ status: "loading" });
    const t0 = Date.now();
    try {
      const state = await focusApi.state(readCursor());
      measure(state.server_now, t0, Date.now());
      apply(state);
    } catch (e) {
      const err = e as ApiError;
      set({ status: snap.session ? "ready" : "error", error: err.message, online: err.code !== "network_error" });
      schedule(true);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function schedule(failed = false) {
  window.clearTimeout(pollTimer);
  window.clearTimeout(boundaryTimer);
  window.clearTimeout(breakEndingTimer);
  const visible = document.visibilityState === "visible";
  pollTimer = window.setTimeout(sync, failed ? 5000 : visible ? VISIBLE_POLL_MS : HIDDEN_POLL_MS);
  const boundary = nextBoundary(snap.session);
  if (boundary != null) {
    const ms = (boundary - serverNow()) * 1000 + BOUNDARY_SLACK_MS;
    if (ms < 2 ** 31 - 1) boundaryTimer = window.setTimeout(sync, Math.max(BOUNDARY_SLACK_MS, ms));
  }
  scheduleBreakEnding();
}

function scheduleBreakEnding() {
  const s = snap.session;
  const lead = snap.prefs?.break_ending_seconds ?? 60;
  if (!s || !isBreak(s.stage) || !lead || !s.phase_ends_at) return;
  const key = `${s.id}:${s.phase_index}`;
  if (breakEndingShown.has(key)) return;
  const total = (s.phase_ends_at - (s.phase_started_at ?? s.phase_ends_at));
  if (total <= lead + 5) return; // pausa curta demais para um aviso antecipado
  const ms = (s.phase_ends_at - lead - serverNow()) * 1000;
  const fire = () => {
    if (breakEndingShown.has(key)) return;
    breakEndingShown.add(key);
    present([{ id: -1, at: serverNow(), kind: "break_ending" }]);
  };
  if (ms <= 0) {
    if (s.phase_ends_at - serverNow() > 3) fire();
    return;
  }
  breakEndingTimer = window.setTimeout(fire, ms);
}

// --- ações ---------------------------------------------------------------------------------

export class FocusActionError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== "network_error" || attempt >= RETRY_DELAYS_MS.length) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}

function handleError(e: unknown): never {
  const err = e as ApiError;
  const state = (err.body as { state?: FocusState } | undefined)?.state;
  if (state) apply(state);
  if (err.code === "network_error") set({ online: false });
  throw new FocusActionError(err.message, err.code);
}

export async function startSession(input: StartInput): Promise<void> {
  if (snap.busy) return;
  set({ busy: "start", lastEnded: null });
  const requestId = newRequestId();
  const t0 = Date.now();
  try {
    const state = await withRetry(() => focusApi.start({ ...input, request_id: requestId, timezone: browserTimezone() }));
    measure(state.server_now, t0, Date.now());
    apply(state);
  } catch (e) {
    handleError(e);
  } finally {
    set({ busy: null });
  }
}

export async function act(action: Action, { confirm = false } = {}): Promise<void> {
  const session = snap.session;
  if (!session || snap.busy) return;
  set({ busy: action });
  const requestId = newRequestId();
  const t0 = Date.now();
  try {
    const state = await withRetry(() =>
      focusApi.act(session.id, { action, request_id: requestId, version: session.version, confirm }),
    );
    measure(state.server_now, t0, Date.now());
    apply(state);
    if (!state.session && !state.ended) void sync();
  } catch (e) {
    handleError(e);
  } finally {
    set({ busy: null });
  }
}

export function dismissEnded() {
  set({ lastEnded: null });
}

// --- preferências de aviso -------------------------------------------------------------------

export async function loadPreferences() {
  try {
    set({ prefs: await focusApi.preferences() });
    scheduleBreakEnding();
  } catch {
    /* usa o padrão até a próxima tentativa */
  }
}

export async function savePreferences(next: Partial<NotificationPreferences>) {
  const prefs = await focusApi.setPreferences(next);
  set({ prefs });
  return prefs;
}

// --- avisos ----------------------------------------------------------------------------------

function present(notices: Notice[]) {
  const prefs = snap.prefs;
  const stored = readCursor() ?? 0;
  let highest = stored;
  for (const n of notices) {
    if (n.id > 0 && n.id <= stored) continue; // outra aba já mostrou
    if (n.id > highest) highest = n.id;
    const kindEnabled = prefs ? prefs.kinds[n.kind] !== false : true;
    if (!kindEnabled) continue;
    const message = describe(n);
    if (!message) continue;
    notify({
      ...message,
      tag: `teleaula-focus-${n.id > 0 ? n.id : `${n.kind}-${snap.session?.id}-${snap.session?.phase_index}`}`,
      inApp: prefs ? prefs.in_app : true,
      system: prefs ? prefs.system : false,
      sound: prefs ? prefs.sound : true,
    });
  }
  if (highest > stored) writeCursor(highest);
}

const BREAK_NAMES: Record<string, string> = { short_break: "pausa curta", long_break: "pausa longa" };

function describe(n: Notice): Parameters<typeof notify>[0] | null {
  switch (n.kind) {
    case "focus_completed":
      return n.break
        ? {
            title: `Ciclo ${n.cycle} concluído`,
            body: `Hora de descansar: ${BREAK_NAMES[n.break] ?? "pausa"} de ${duration(n.break_seconds ?? 0)}.`,
            tone: "rest",
            essential: true,
          }
        : { title: `Ciclo ${n.cycle} concluído`, body: "Comece o próximo quando estiver pronto.", tone: "focus", essential: true };
    case "break_ending": {
      const s = snap.session;
      const left = s?.phase_ends_at ? Math.max(0, s.phase_ends_at - serverNow()) : 0;
      return { title: "A pausa está terminando", body: `Faltam ${duration(left)} para voltar ao foco.`, tone: "rest", essential: true };
    }
    case "break_completed":
      return { title: "Pausa encerrada", body: `O ciclo ${n.next_cycle} está pronto para começar.`, tone: "focus", essential: true };
    case "session_ended":
      if (n.status === "completed")
        return {
          title: "Sessão concluída",
          body: `${duration(n.focus_seconds)} de foco · ${n.cycles_completed} ${n.cycles_completed === 1 ? "ciclo" : "ciclos"}${n.xp ? ` · +${n.xp} XP` : ""}`,
          tone: "success",
          essential: true,
        };
      if (n.status === "expired")
        return {
          title: "Sessão encerrada por inatividade",
          body: n.focus_seconds > 0 ? `${duration(n.focus_seconds)} de foco ficaram registrados.` : "Nenhum tempo de foco foi registrado.",
          tone: "neutral",
        };
      return null; // encerrada pela própria pessoa: o resumo aparece na tela
    case "goal_reached":
      return {
        title: n.period === "daily" ? "Meta do dia cumprida" : "Meta da semana cumprida",
        body: `${duration(n.target_seconds)} de foco · +${n.xp} XP`,
        tone: "success",
      };
    case "achievement_unlocked":
      return { title: `Conquista: ${n.name}`, body: `${capitalize(n.rarity)} · +${n.xp} XP`, tone: "reward" };
    case "level_up":
      return { title: `Nível ${n.level}`, body: n.new_title ? `Novo título: ${n.title}` : n.title, tone: "reward" };
    default:
      return null;
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// --- ciclo de vida --------------------------------------------------------------------------

/** Liga o temporizador para o usuário logado. Devolve a função que desliga. */
export function attachFocus(user: string): () => void {
  userId = user;
  lastServerNow = 0;
  samples = [];
  memoryCursor = null;
  set({ status: "idle", session: null, locked: false, progress: null, lastEnded: null, error: null, prefs: null });
  void loadPreferences();
  void sync();
  try {
    channel = new BroadcastChannel(`teleaula-focus-${user}`);
    channel.onmessage = (event) => {
      if (event.data?.type === "state") apply(event.data.state as FocusState, { broadcast: false });
    };
  } catch {
    channel = null;
  }
  const onVisible = () => document.visibilityState === "visible" && void sync();
  const onOnline = () => void sync();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  window.addEventListener("online", onOnline);
  return () => {
    userId = null;
    window.clearTimeout(pollTimer);
    window.clearTimeout(boundaryTimer);
    window.clearTimeout(breakEndingTimer);
    channel?.close();
    channel = null;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    window.removeEventListener("online", onOnline);
  };
}

/** Leitura atual derivada (útil fora do React). */
export function currentReadout() {
  return snap.session ? readout(snap.session, serverNow()) : null;
}
