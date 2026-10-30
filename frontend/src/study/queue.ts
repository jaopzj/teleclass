// Fila de trechos ainda não confirmados pelo servidor.
//
// Fica no localStorage para sobreviver a recarregar a página, fechar o
// navegador ou perder a conexão: na próxima vez que o app abrir, os trechos
// pendentes são enviados. Cada trecho tem (sessão, sequência) únicos, e o
// servidor ignora repetições, então reenviar nunca conta duas vezes.
//
// Toda operação lê o armazenamento, altera e grava de volta, para que duas abas
// abertas não apaguem os trechos uma da outra.
import { ApiError } from "../api";
import { SegmentPayload, studyApi } from "./api";
import { invalidateStudyMetrics } from "./metricsStore";

const STORAGE_KEY = "teleaula:study-queue:v1";
const BATCH = 50;
const RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

interface Entry {
  userId: string;
  sessionId: string;
  segments: SegmentPayload[];
}

type Queue = Record<string, Entry>;

let memory: Queue = {}; // se o localStorage não estiver disponível

function read(): Queue {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Queue) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return memory;
  }
}

function write(queue: Queue) {
  memory = queue;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* modo privado ou cota cheia: a fila fica só em memória */
  }
}

function update(change: (queue: Queue) => void) {
  const queue = read();
  change(queue);
  for (const [id, entry] of Object.entries(queue)) if (!entry.segments.length) delete queue[id];
  write(queue);
}

export function enqueue(userId: string, sessionId: string, segment: SegmentPayload) {
  update((queue) => {
    const entry = (queue[sessionId] ??= { userId, sessionId, segments: [] });
    if (!entry.segments.some((s) => s.seq === segment.seq)) entry.segments.push(segment);
  });
  scheduleFlush(1_000);
}

export function pendingCount(userId: string) {
  return Object.values(read())
    .filter((e) => e.userId === userId)
    .reduce((n, e) => n + e.segments.length, 0);
}

function remove(sessionId: string, seqs: Set<number> | "all") {
  update((queue) => {
    const entry = queue[sessionId];
    if (!entry) return;
    entry.segments = seqs === "all" ? [] : entry.segments.filter((s) => !seqs.has(s.seq));
  });
}

// --- envio --------------------------------------------------------------------

let currentUser: string | null = null;
let flushing: Promise<void> | null = null;
let timer: number | undefined;
let failures = 0;

function scheduleFlush(delay: number) {
  if (timer !== undefined) return;
  timer = window.setTimeout(() => {
    timer = undefined;
    void flush();
  }, delay);
}

/** Envia os trechos pendentes do usuário logado. Com `keepalive`, sobrevive ao fechamento da página. */
export function flush({ keepalive = false } = {}): Promise<void> {
  if (keepalive) return send(true); // sem esperar o envio em andamento: a página pode estar fechando
  flushing ??= send(false).finally(() => (flushing = null));
  return flushing;
}

async function send(keepalive: boolean) {
  const user = currentUser;
  if (!user) return;
  let credited = false;
  let retry = false;
  for (const entry of Object.values(read())) {
    if (entry.userId !== user || !entry.segments.length) continue;
    const batch = entry.segments.slice(0, BATCH);
    try {
      const result = await studyApi.sendSegments(entry.sessionId, batch, keepalive);
      // Recusados também saem da fila: a decisão do servidor é definitiva.
      remove(entry.sessionId, new Set(result.results.map((r) => r.seq)));
      if (result.results.some((r) => r.credited_seconds > 0 && !r.duplicate)) credited = true;
      if (entry.segments.length > BATCH) retry = true;
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 404 || status === 422 || status === 400) remove(entry.sessionId, "all"); // não adianta repetir
      else retry = true; // sem conexão, servidor fora, limite de pedidos, sessão expirada
    }
  }
  if (credited) invalidateStudyMetrics();
  if (keepalive) return;
  if (retry) {
    scheduleFlush(RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
    failures++;
  } else failures = 0;
}

/** Liga a fila ao usuário logado e reenvia o que ficou pendente de outras visitas. */
export function startStudySync(userId: string) {
  currentUser = userId;
  const retryNow = () => void flush();
  const onVisible = () => document.visibilityState === "visible" && retryNow();
  window.addEventListener("online", retryNow);
  document.addEventListener("visibilitychange", onVisible);
  void flush();
  return () => {
    window.removeEventListener("online", retryNow);
    document.removeEventListener("visibilitychange", onVisible);
    if (currentUser === userId) currentUser = null;
  };
}
