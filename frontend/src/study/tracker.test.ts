import { beforeEach, describe, expect, it } from "vitest";
import { PlaybackSegment, PlaybackTracker } from "./tracker";

/** <video> simulado: estado mutável e eventos disparados à mão. */
class FakeVideo extends EventTarget {
  paused = true;
  ended = false;
  seeking = false;
  readyState = 4;
  error: unknown = null;
  currentTime = 0;
  playbackRate = 1;

  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

let clock = 0;
let video: FakeVideo;
let segments: PlaybackSegment[];
let tracker: PlaybackTracker;

const total = () => segments.reduce((s, x) => s + (x.endMono - x.startMono), 0) / 1000;

/** Reproduz por `seconds` de relógio, com timeupdate a cada 250 ms e tick a cada 1 s. */
function advance(seconds: number, { playing = true } = {}) {
  for (let i = 0; i < seconds * 4; i++) {
    clock += 250;
    if (playing) video.currentTime += 0.25 * video.playbackRate;
    video.fire("timeupdate");
    if (clock % 1000 === 0) tracker.tick();
  }
}

function play() {
  video.paused = false;
  video.fire("play");
  video.fire("playing");
}

function pause() {
  video.paused = true;
  video.fire("pause");
}

beforeEach(() => {
  clock = 0;
  video = new FakeVideo();
  segments = [];
  tracker = new PlaybackTracker(video, (s) => segments.push(s), { now: () => clock });
  tracker.attach();
});

describe("PlaybackTracker", () => {
  it("conta só o tempo tocando, não as pausas", () => {
    play();
    advance(10);
    pause();
    clock += 60_000; // pausado por um minuto
    play();
    advance(5);
    pause();
    expect(total()).toBe(15);
  });

  it("em 2× conta o tempo real, não o conteúdo assistido", () => {
    video.playbackRate = 2;
    play();
    advance(600);
    pause();
    expect(total()).toBe(600);
    const media = segments.reduce((s, x) => s + (x.mediaTo - x.mediaFrom), 0);
    expect(media).toBe(1200);
    expect(segments.every((s) => s.rate === 2)).toBe(true);
  });

  it("troca de velocidade fecha o trecho e abre outro com a nova velocidade", () => {
    play();
    advance(4);
    video.playbackRate = 1.5;
    video.fire("ratechange");
    advance(4);
    pause();
    expect(segments.map((s) => s.rate)).toEqual([1, 1.5]);
    expect(total()).toBe(8);
  });

  it("buffering não conta", () => {
    play();
    advance(5);
    video.readyState = 2;
    video.fire("waiting");
    advance(20, { playing: false });
    video.readyState = 4;
    video.fire("playing");
    advance(5);
    pause();
    expect(total()).toBe(10);
  });

  it("travamento silencioso (sem evento) termina no último avanço", () => {
    play();
    advance(6);
    advance(30, { playing: false }); // vídeo congelado, nenhum "waiting"
    expect(total()).toBe(6);
    advance(4); // voltou a andar: o tempo congelado continua de fora
    pause();
    expect(total()).toBeGreaterThanOrEqual(9.75); // no máximo um quarto de segundo a menos, nunca a mais
    expect(total()).toBeLessThanOrEqual(10);
  });

  it("aba congelada: um salto longo entre eventos não é contado", () => {
    play();
    advance(3);
    clock += 120_000; // navegador suspendeu a página
    video.currentTime += 120;
    video.fire("timeupdate");
    advance(2);
    pause();
    expect(total()).toBe(5);
  });

  it("saltos (seek) fecham o trecho; o tempo do salto não conta", () => {
    play();
    advance(5);
    video.seeking = true;
    video.fire("seeking");
    clock += 3000;
    video.currentTime = 300;
    video.seeking = false;
    video.fire("seeked");
    advance(5);
    pause();
    expect(total()).toBe(10);
    expect(segments[1].mediaFrom).toBe(300);
  });

  it("salto sem evento de seeking também fecha o trecho", () => {
    play();
    advance(5);
    video.currentTime = 500;
    advance(3);
    pause();
    expect(total()).toBeCloseTo(7.75, 2); // perde só o quarto de segundo do salto
  });

  it("erro e fim do vídeo fecham o trecho", () => {
    play();
    advance(3);
    video.error = {};
    video.fire("error");
    advance(3, { playing: false });
    expect(total()).toBe(3);
    video.error = null;
    play();
    advance(2);
    video.ended = true;
    video.paused = true;
    video.fire("ended");
    expect(total()).toBe(5);
  });

  it("divide em trechos de no máximo 15 s sem perder tempo", () => {
    play();
    advance(50);
    pause();
    expect(total()).toBe(50);
    expect(Math.max(...segments.map((s) => s.endMono - s.startMono))).toBeLessThanOrEqual(15_250);
    for (let i = 1; i < segments.length; i++) expect(segments[i].startMono).toBe(segments[i - 1].endMono);
  });

  it("eventos repetidos não duplicam tempo", () => {
    play();
    play();
    video.fire("playing");
    advance(5);
    pause();
    pause();
    expect(total()).toBe(5);
    expect(segments).toHaveLength(1);
  });

  it("cut() envia o trecho em andamento e continua contando", () => {
    play();
    advance(4);
    tracker.cut();
    expect(total()).toBe(4);
    advance(3);
    tracker.detach();
    expect(total()).toBe(7);
  });

  it("vídeo pausado nunca abre trecho, nem com timeupdate", () => {
    advance(10, { playing: false });
    video.fire("canplay");
    expect(segments).toHaveLength(0);
    expect(tracker.isCounting).toBe(false);
  });
});
