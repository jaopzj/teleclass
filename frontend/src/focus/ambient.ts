// Sons ambientes do Focus Mode, sintetizados com a Web Audio API.
//
// Nada é baixado: chuva, floresta, cafeteria, ondas, lareira e ruídos são
// gerados no próprio navegador a partir de ruído filtrado e eventos curtos
// (gotas, pássaros, estalos) agendados no relógio de áudio. Não há arquivos de
// terceiros, então não há licença a respeitar nem carregamento a esperar, e o
// custo é baixo (alguns nós de áudio por som).
import { useSyncExternalStore } from "react";

export type SoundId = "rain" | "forest" | "cafe" | "waves" | "fire" | "white" | "brown";

export const SOUNDS: { id: SoundId; name: string; icon: "rain" | "tree" | "coffee" | "wave" | "fire" | "noise" | "wind" }[] = [
  { id: "rain", name: "Chuva", icon: "rain" },
  { id: "forest", name: "Floresta", icon: "tree" },
  { id: "cafe", name: "Cafeteria", icon: "coffee" },
  { id: "waves", name: "Ondas", icon: "wave" },
  { id: "fire", name: "Lareira", icon: "fire" },
  { id: "white", name: "Ruído branco", icon: "noise" },
  { id: "brown", name: "Ruído marrom", icon: "wind" },
];

interface AmbientState {
  sound: SoundId | null;
  status: "stopped" | "playing" | "paused";
  volume: number; // 0..1
  supported: boolean;
}

const STORAGE = "teleaula:focus:ambient";
const listeners = new Set<() => void>();
let state: AmbientState = { sound: null, status: "stopped", volume: 0.5, supported: typeof AudioContext !== "undefined", ...restore() };

function restore(): Partial<AmbientState> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "null");
    if (saved && typeof saved.volume === "number") return { volume: Math.min(1, Math.max(0, saved.volume)), sound: saved.sound ?? null };
  } catch {
    /* sem preferências guardadas */
  }
  return {};
}

function set(next: Partial<AmbientState>) {
  state = { ...state, ...next };
  try {
    localStorage.setItem(STORAGE, JSON.stringify({ volume: state.volume, sound: state.sound }));
  } catch {
    /* modo privado */
  }
  listeners.forEach((l) => l());
}

export function useAmbient(): AmbientState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

// --- motor ----------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let current: { stop: () => void } | null = null;
const buffers = new Map<string, AudioBuffer>();

function audio(): { ctx: AudioContext; master: GainNode } {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
  }
  return { ctx, master: master as GainNode };
}

const curve = (v: number) => v * v * 0.9; // volume percebido mais linear

function noise(kind: "white" | "pink" | "brown", seconds = 4): AudioBuffer {
  const { ctx } = audio();
  const key = `${kind}:${seconds}`;
  const cached = buffers.get(key);
  if (cached) return cached;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === "white") data[i] = white * 0.5;
      else if (kind === "pink") {
        // Filtro de Paul Kellet
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
    }
    // Emenda suave no fim do laço (sem clique ao repetir).
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[length - fade + i] = data[length - fade + i] * (1 - t) + data[i] * t;
    }
  }
  buffers.set(key, buffer);
  return buffer;
}

type Bed = { nodes: AudioNode[]; timers: number[] };

function loop(kind: "white" | "pink" | "brown", out: AudioNode, bed: Bed, gain: number, filters: BiquadFilterNode[] = []) {
  const { ctx } = audio();
  const src = ctx.createBufferSource();
  src.buffer = noise(kind);
  src.loop = true;
  src.loopStart = 0.05;
  src.playbackRate.value = 0.97 + Math.random() * 0.06;
  const g = ctx.createGain();
  g.gain.value = gain;
  let node: AudioNode = src;
  for (const f of filters) {
    node.connect(f);
    node = f;
  }
  node.connect(g).connect(out);
  src.start(ctx.currentTime, Math.random() * 3);
  bed.nodes.push(src, g, ...filters);
  return g;
}

function filter(type: BiquadFilterType, frequency: number, q = 0.7) {
  const f = audio().ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
}

function lfo(target: AudioParam, rate: number, depth: number, bed: Bed) {
  const { ctx } = audio();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = rate;
  g.gain.value = depth;
  osc.connect(g).connect(target);
  osc.start();
  bed.nodes.push(osc, g);
}

/** Agenda eventos curtos à frente no relógio de áudio (resistente a abas em segundo plano). */
function scatter(bed: Bed, minGap: number, maxGap: number, play: (at: number) => void) {
  const { ctx } = audio();
  let next = ctx.currentTime + Math.random() * maxGap;
  const id = window.setInterval(() => {
    const horizon = ctx.currentTime + 0.5;
    while (next < horizon) {
      play(Math.max(next, ctx.currentTime + 0.01));
      next += minGap + Math.random() * (maxGap - minGap);
    }
  }, 120);
  bed.timers.push(id);
}

function burst(out: AudioNode, at: number, { freq, q, gain, length }: { freq: number; q: number; gain: number; length: number }) {
  const { ctx } = audio();
  const src = ctx.createBufferSource();
  src.buffer = noise("white", 1);
  const f = filter("bandpass", freq, q);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(f).connect(g).connect(out);
  src.start(at, Math.random() * 0.8, length + 0.05);
}

function tone(out: AudioNode, at: number, from: number, to: number, length: number, gain: number) {
  const { ctx } = audio();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + length);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

const BUILDERS: Record<SoundId, (out: AudioNode, bed: Bed) => void> = {
  rain(out, bed) {
    loop("pink", out, bed, 0.55, [filter("highpass", 450), filter("lowpass", 7000)]);
    loop("brown", out, bed, 0.35, [filter("lowpass", 350)]);
    scatter(bed, 0.015, 0.09, (at) =>
      burst(out, at, { freq: 1800 + Math.random() * 4200, q: 6 + Math.random() * 6, gain: 0.02 + Math.random() * 0.05, length: 0.02 + Math.random() * 0.03 }),
    );
  },
  forest(out, bed) {
    const wind = loop("brown", out, bed, 0.45, [filter("lowpass", 420)]);
    lfo(wind.gain, 0.06, 0.2, bed);
    const leaves = loop("pink", out, bed, 0.06, [filter("highpass", 2200)]);
    lfo(leaves.gain, 0.11, 0.04, bed);
    scatter(bed, 2.5, 8, (at) => {
      const base = 2600 + Math.random() * 1800;
      const notes = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < notes; i++) {
        const t = at + i * (0.09 + Math.random() * 0.06);
        tone(out, t, base * (0.92 + Math.random() * 0.1), base * (1.15 + Math.random() * 0.25), 0.07 + Math.random() * 0.05, 0.035);
      }
    });
  },
  cafe(out, bed) {
    loop("brown", out, bed, 0.4, [filter("lowpass", 900)]);
    const murmur = loop("pink", out, bed, 0.12, [filter("bandpass", 520, 0.9)]);
    scatter(bed, 0.25, 0.7, (at) => murmur.gain.linearRampToValueAtTime(0.06 + Math.random() * 0.14, at + 0.2));
    scatter(bed, 3, 11, (at) => {
      const f = 2600 + Math.random() * 1500;
      tone(out, at, f, f * 0.995, 0.35, 0.018);
      tone(out, at, f * 1.68, f * 1.67, 0.25, 0.01);
    });
  },
  waves(out, bed) {
    const lp = filter("lowpass", 400);
    const g = loop("pink", out, bed, 0.2, [lp]);
    scatter(bed, 7, 11, (at) => {
      const rise = 3 + Math.random() * 1.5;
      lp.frequency.cancelScheduledValues(at);
      lp.frequency.setTargetAtTime(1700 + Math.random() * 600, at, rise / 3);
      lp.frequency.setTargetAtTime(320, at + rise, 2.2);
      g.gain.setTargetAtTime(0.75, at, rise / 3);
      g.gain.setTargetAtTime(0.18, at + rise, 2.4);
    });
    loop("brown", out, bed, 0.25, [filter("lowpass", 200)]);
  },
  fire(out, bed) {
    loop("brown", out, bed, 0.5, [filter("lowpass", 650)]);
    scatter(bed, 0.03, 0.35, (at) =>
      burst(out, at, { freq: 1500 + Math.random() * 3000, q: 1.5, gain: 0.03 + Math.random() * 0.12, length: 0.008 + Math.random() * 0.02 }),
    );
  },
  white(out, bed) {
    loop("white", out, bed, 0.32, [filter("lowpass", 11000)]);
  },
  brown(out, bed) {
    loop("brown", out, bed, 0.7);
  },
};

function fadeTo(value: number, seconds: number) {
  const { ctx, master } = audio();
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(value, now + seconds);
}

function teardown() {
  current?.stop();
  current = null;
}

export function playAmbient(id: SoundId) {
  if (!state.supported) return;
  const { ctx } = audio();
  void ctx.resume();
  if (state.sound === id && state.status === "playing") return;
  teardown();
  const out = ctx.createGain();
  out.connect(audio().master);
  const bed: Bed = { nodes: [out], timers: [] };
  BUILDERS[id](out, bed);
  current = {
    stop: () => {
      bed.timers.forEach((t) => window.clearInterval(t));
      const at = ctx.currentTime;
      out.gain.setValueAtTime(out.gain.value, at);
      out.gain.linearRampToValueAtTime(0, at + 0.4);
      window.setTimeout(() => bed.nodes.forEach((n) => {
        try {
          (n as AudioScheduledSourceNode).stop?.();
        } catch {
          /* já parado */
        }
        n.disconnect();
      }), 500);
    },
  };
  fadeTo(curve(state.volume), 1.2);
  set({ sound: id, status: "playing" });
}

export function pauseAmbient() {
  if (!ctx || state.status !== "playing") return;
  fadeTo(0, 0.3);
  window.setTimeout(() => void ctx?.suspend(), 320);
  set({ status: "paused" });
}

export function resumeAmbient() {
  if (!ctx || state.status !== "paused" || !state.sound) return;
  void ctx.resume().then(() => fadeTo(curve(state.volume), 0.6));
  set({ status: "playing" });
}

export function stopAmbient() {
  if (ctx) fadeTo(0, 0.3);
  teardown();
  set({ status: "stopped" });
}

export function setAmbientVolume(volume: number) {
  const v = Math.min(1, Math.max(0, volume));
  if (ctx && state.status === "playing") fadeTo(curve(v), 0.15);
  set({ volume: v });
}
