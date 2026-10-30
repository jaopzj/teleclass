// Captura do tempo de reprodução efetiva a partir dos eventos reais do <video>.
//
// Um trecho só fica aberto enquanto o vídeo está de fato tocando: não pausado,
// não terminado, sem salto em andamento, sem erro, com dados suficientes e com
// a posição avançando. Tudo é medido com um relógio monotônico
// (performance.now()), que não muda quando o relógio do computador é ajustado.
//
// Fecha o trecho: pause, waiting/stalled (buffering), seeking, ended, error,
// emptied/abort, troca de velocidade, posição parada por mais de STALL_MS e o
// limite de MAX_SEGMENT_MS (para enviar aos poucos). Nunca soma tempo parado:
// num travamento, o trecho termina no último avanço observado.
//
// Esta classe só observa e emite trechos; quem envia é o StudyRecorder.

export interface MediaLike extends EventTarget {
  readonly paused: boolean;
  readonly ended: boolean;
  readonly seeking: boolean;
  readonly readyState: number;
  readonly error: unknown;
  readonly currentTime: number;
  readonly playbackRate: number;
}

export interface PlaybackSegment {
  startMono: number; // ms, relógio monotônico
  endMono: number;
  mediaFrom: number; // s, posição do vídeo
  mediaTo: number;
  rate: number;
}

export interface TrackerOptions {
  now?: () => number;
  maxSegmentMs?: number;
  stallMs?: number;
  /** Chamado no primeiro "play": hora de abrir a sessão no servidor. */
  onPlayIntent?: () => void;
}

const HAVE_FUTURE_DATA = 3;
export const MAX_SEGMENT_MS = 15_000;
export const STALL_MS = 2_500;
const MIN_SEGMENT_MS = 100;

const CLOSE_EVENTS = ["pause", "waiting", "stalled", "seeking", "ended", "error", "emptied", "abort"] as const;
const OPEN_EVENTS = ["playing", "seeked", "canplay"] as const;

interface OpenSegment {
  start: number;
  mediaFrom: number;
  rate: number;
  lastProgress: number; // instante (mono) do último avanço observado
  lastMedia: number; // posição nesse instante
}

export class PlaybackTracker {
  private open: OpenSegment | null = null;
  private readonly now: () => number;
  private readonly maxSegmentMs: number;
  private readonly stallMs: number;

  constructor(
    private readonly media: MediaLike,
    private readonly emit: (segment: PlaybackSegment) => void,
    private readonly options: TrackerOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.maxSegmentMs = options.maxSegmentMs ?? MAX_SEGMENT_MS;
    this.stallMs = options.stallMs ?? STALL_MS;
  }

  attach() {
    for (const name of [...CLOSE_EVENTS, ...OPEN_EVENTS, "play", "timeupdate", "ratechange"]) {
      this.media.addEventListener(name, this.onEvent);
    }
    this.maybeOpen();
  }

  /** Fecha o trecho aberto e para de observar (troca de aula, saída da página). */
  detach() {
    this.close(this.now());
    for (const name of [...CLOSE_EVENTS, ...OPEN_EVENTS, "play", "timeupdate", "ratechange"]) {
      this.media.removeEventListener(name, this.onEvent);
    }
  }

  /** Fecha o trecho em andamento e já abre outro (antes de enviar: aba oculta, página fechando). */
  cut() {
    const open = this.open;
    if (!open) return;
    const t = this.now();
    this.close(t);
    if (this.open === null && t - open.lastProgress <= this.stallMs) this.maybeOpen();
  }

  /** Chamado a cada segundo: detecta travamento silencioso e limita o tamanho do trecho. */
  tick() {
    const open = this.open;
    if (!open) return;
    const t = this.now();
    if (t - open.lastProgress > this.stallMs) {
      this.close(open.lastProgress, open.lastMedia);
      return;
    }
    if (t - open.start >= this.maxSegmentMs) this.cut();
  }

  get isCounting() {
    return this.open !== null;
  }

  private onEvent = (event: Event) => {
    const t = this.now();
    switch (event.type) {
      case "play":
        this.options.onPlayIntent?.();
        break;
      case "timeupdate":
        this.onProgress(t);
        break;
      case "ratechange":
        this.close(t);
        this.maybeOpen();
        break;
      default:
        if ((CLOSE_EVENTS as readonly string[]).includes(event.type)) this.close(t);
        else this.maybeOpen();
    }
  };

  private canCount() {
    const m = this.media;
    return !m.paused && !m.ended && !m.seeking && !m.error && m.readyState >= HAVE_FUTURE_DATA;
  }

  private maybeOpen() {
    if (this.open || !this.canCount()) return;
    const t = this.now();
    const position = this.media.currentTime;
    this.open = { start: t, mediaFrom: position, rate: this.media.playbackRate, lastProgress: t, lastMedia: position };
  }

  private onProgress(t: number) {
    const open = this.open;
    if (!open) {
      this.maybeOpen();
      return;
    }
    if (!this.canCount()) {
      this.close(t);
      return;
    }
    const position = this.media.currentTime;
    const elapsed = (t - open.lastProgress) / 1000;
    // Salto sem "seeking" (alguns navegadores) ou volta no tempo: fecha no último ponto bom.
    const jumped = position < open.lastMedia - 0.5 || position > open.lastMedia + elapsed * open.rate * 1.5 + 1;
    if (jumped || t - open.lastProgress > this.stallMs) {
      this.close(open.lastProgress, open.lastMedia);
      this.maybeOpen();
      return;
    }
    if (position > open.lastMedia) {
      if (open.lastMedia === open.mediaFrom) {
        // Primeiro avanço do trecho: o tempo antes dele (vídeo ainda parado) não conta.
        const needed = ((position - open.mediaFrom) / open.rate) * 1000;
        open.start = Math.max(open.start, t - needed);
      }
      open.lastProgress = t;
      open.lastMedia = position;
    }
    if (t - open.start >= this.maxSegmentMs) this.cut();
  }

  private close(at: number, mediaAt?: number) {
    const open = this.open;
    if (!open) return;
    this.open = null;
    // Se a posição não andou nos últimos instantes, o trecho termina no último avanço.
    const stalled = at - open.lastProgress > this.stallMs;
    const end = stalled ? open.lastProgress : at;
    let mediaTo = stalled ? open.lastMedia : mediaAt ?? this.media.currentTime;
    if (!Number.isFinite(mediaTo) || mediaTo < open.mediaFrom) mediaTo = open.lastMedia;
    if (end - open.start < MIN_SEGMENT_MS || mediaTo <= open.mediaFrom) return;
    this.emit({ startMono: open.start, endMono: end, mediaFrom: open.mediaFrom, mediaTo, rate: open.rate });
  }
}
