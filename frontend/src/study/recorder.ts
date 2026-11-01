// Sessão de estudo de uma aula: liga os trechos do PlaybackTracker ao servidor.
//
// A sessão é aberta no primeiro "play". O servidor grava o horário de abertura
// pelo próprio relógio; aqui, a origem dos tempos é o instante (monotônico) em
// que a resposta chegou. Assim, os trechos são enviados como "ms desde a
// abertura" e nunca ficam adiantados em relação ao relógio do servidor.
//
// Trechos que começam antes da resposta são cortados na origem (perde-se no
// máximo o tempo de ida e volta). Se a sessão não puder ser aberta, nenhum
// trecho é enviado: sem origem confiável, não há como ancorar o tempo.
import { ApiError } from "../api";
import { browserTimezone, studyApi } from "./api";
import { enqueue, flush } from "./queue";
import type { PlaybackSegment } from "./tracker";

// O servidor aceita sessões de até 12 h; abaixo disso, uma nova sessão é aberta.
const ROTATE_AFTER_MS = 11 * 3600 * 1000;
const OPEN_RETRY_MS = [1_000, 3_000, 10_000, 30_000];

function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface LessonContext {
  userId: string;
  courseId: string;
  lessonKey: string;
}

export class StudyRecorder {
  private sessionId = newId();
  private origin: number | null = null;
  private opening: Promise<void> | null = null;
  private seq = 0;
  private waiting: PlaybackSegment[] = []; // trechos à espera da abertura
  private disabled = false;
  private attempts = 0;
  private retryTimer: number | undefined;

  constructor(private readonly context: LessonContext, private readonly now = () => performance.now()) {}

  /** Abre a sessão (uma vez); chamado no primeiro "play". */
  ensureOpen() {
    if (this.origin !== null || this.opening || this.disabled) return;
    const id = this.sessionId;
    this.opening = studyApi
      .openSession({
        id,
        source: "video",
        course_id: this.context.courseId,
        lesson_key: this.context.lessonKey,
        timezone: browserTimezone(),
      })
      .then(() => {
        if (id !== this.sessionId) return;
        this.origin = this.now();
        this.attempts = 0;
        const waiting = this.waiting;
        this.waiting = [];
        waiting.forEach((s) => this.add(s));
      })
      .catch((e) => {
        const status = e instanceof ApiError ? e.status : 0;
        if (status === 404 || status === 400 || status === 422) {
          this.disabled = true; // aula sem vídeo, curso removido, origem desligada
          this.waiting = [];
          return;
        }
        // Falha passageira: tenta de novo. Os trechos esperam em memória.
        const delay = OPEN_RETRY_MS[Math.min(this.attempts++, OPEN_RETRY_MS.length - 1)];
        window.clearTimeout(this.retryTimer);
        this.retryTimer = window.setTimeout(() => this.ensureOpen(), delay);
      })
      .finally(() => {
        this.opening = null;
      });
  }

  add(segment: PlaybackSegment) {
    if (this.disabled) return;
    if (this.origin === null) {
      this.waiting.push(segment);
      this.ensureOpen();
      return;
    }
    if (segment.endMono - this.origin > ROTATE_AFTER_MS) {
      this.rotate();
      this.waiting.push(segment);
      this.ensureOpen();
      return;
    }
    // Corta o que aconteceu antes da origem (segmento iniciado antes da resposta).
    const start = Math.max(segment.startMono, this.origin);
    if (segment.endMono - start < 100) return;
    const mediaFrom = segment.mediaFrom + ((start - segment.startMono) / 1000) * segment.rate;
    if (segment.mediaTo <= mediaFrom) return;
    enqueue(this.context.userId, this.sessionId, {
      seq: this.seq++,
      start_ms: Math.floor(start - this.origin),
      end_ms: Math.floor(segment.endMono - this.origin),
      media_from: round(mediaFrom),
      media_to: round(segment.mediaTo),
      rate: segment.rate,
    });
  }

  /** Página fechando: o que não tem origem é descartado; o resto vai com keepalive. */
  finish() {
    window.clearTimeout(this.retryTimer);
    this.waiting = [];
    void flush({ keepalive: true });
  }

  private rotate() {
    this.sessionId = newId();
    this.origin = null;
    this.seq = 0;
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;
