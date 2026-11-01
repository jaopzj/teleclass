// Estado da reprodução derivado dos eventos reais do <video>.
//
// O <video> é a fonte da verdade: nada aqui guarda "estou tocando" por conta
// própria. Cada evento relevante gera um novo snapshot imutável, que os
// componentes leem via useSyncExternalStore (sem estado duplicado e sem
// listeners espalhados pelos componentes).

export type PlaybackStatus =
  | "loading" // carregando o vídeo pela primeira vez (ou depois de "tentar de novo")
  | "idle" // pronto, nunca reproduzido
  | "playing"
  | "paused" // pausa intencional: nunca mostra carregamento
  | "buffering" // queria tocar, mas faltam dados
  | "ended"
  | "error";

export interface MediaSnapshot {
  status: PlaybackStatus;
  currentTime: number; // atualizado ~4x/s; a barra de progresso lê o vídeo direto, quadro a quadro
  duration: number;
  buffered: Array<[number, number]>;
  volume: number;
  muted: boolean;
  rate: number;
  started: boolean;
  error: MediaError | null;
}

const EVENTS = [
  "loadstart",
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "canplaythrough",
  "play",
  "playing",
  "pause",
  "waiting",
  "stalled",
  "seeking",
  "seeked",
  "timeupdate",
  "progress",
  "durationchange",
  "volumechange",
  "ratechange",
  "ended",
  "error",
  "emptied",
] as const;

const HAVE_FUTURE_DATA = 3;

export class MediaStore {
  private video: HTMLVideoElement | null = null;
  private listeners = new Set<() => void>();
  private snapshot: MediaSnapshot = initialSnapshot();
  private ready = false; // já recebeu dados suficientes para tocar ao menos uma vez
  private waiting = false;
  private started = false;

  attach(video: HTMLVideoElement | null) {
    if (this.video === video) return;
    this.detach();
    this.video = video;
    if (!video) return;
    for (const name of EVENTS) video.addEventListener(name, this.onEvent);
    this.ready = video.readyState >= HAVE_FUTURE_DATA;
    this.update();
  }

  detach() {
    if (!this.video) return;
    for (const name of EVENTS) this.video.removeEventListener(name, this.onEvent);
    this.video = null;
  }

  /** Volta ao estado de carregamento (usado ao recarregar depois de um erro). */
  reset() {
    this.ready = false;
    this.waiting = false;
    this.update();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private onEvent = (event: Event) => {
    const video = this.video!;
    switch (event.type) {
      case "loadstart":
      case "emptied":
        this.ready = false;
        this.waiting = false;
        break;
      case "canplay":
      case "canplaythrough":
      case "loadeddata":
        if (video.readyState >= HAVE_FUTURE_DATA) {
          this.ready = true;
          this.waiting = false;
        }
        break;
      case "playing":
        this.ready = true;
        this.waiting = false;
        this.started = true;
        break;
      case "play":
        this.started = true;
        break;
      case "waiting":
      case "stalled":
        this.waiting = video.readyState < HAVE_FUTURE_DATA;
        break;
      case "seeked":
      case "timeupdate":
        // Alguns navegadores não disparam "playing" depois de um salto curto.
        if (this.waiting && video.readyState >= HAVE_FUTURE_DATA) this.waiting = false;
        break;
    }
    this.update();
  };

  private update() {
    const video = this.video;
    if (!video) return;
    const status = this.status(video);
    const next: MediaSnapshot = {
      status,
      currentTime: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      buffered: ranges(video.buffered),
      volume: video.volume,
      muted: video.muted,
      rate: video.playbackRate,
      started: this.started,
      error: video.error,
    };
    if (!changed(this.snapshot, next)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  private status(video: HTMLVideoElement): PlaybackStatus {
    if (video.error) return "error";
    if (video.ended) return "ended";
    if (!this.ready) return "loading";
    if (video.paused) return this.started ? "paused" : "idle";
    if (this.waiting || video.readyState < HAVE_FUTURE_DATA) return "buffering";
    return "playing";
  }
}

function initialSnapshot(): MediaSnapshot {
  return {
    status: "loading",
    currentTime: 0,
    duration: 0,
    buffered: [],
    volume: 1,
    muted: false,
    rate: 1,
    started: false,
    error: null,
  };
}

function ranges(list: TimeRanges): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < list.length; i++) out.push([list.start(i), list.end(i)]);
  return out;
}

function changed(a: MediaSnapshot, b: MediaSnapshot) {
  return (
    a.status !== b.status ||
    Math.abs(a.currentTime - b.currentTime) >= 0.2 ||
    a.duration !== b.duration ||
    a.volume !== b.volume ||
    a.muted !== b.muted ||
    a.rate !== b.rate ||
    a.started !== b.started ||
    a.error !== b.error ||
    a.buffered.length !== b.buffered.length ||
    a.buffered.some(([s, e], i) => Math.abs(s - b.buffered[i][0]) > 0.5 || Math.abs(e - b.buffered[i][1]) > 0.5)
  );
}
