import { describe, expect, it } from "vitest";
import { FocusSession } from "./api";
import { clock, nextBoundary, readout } from "./derive";

const base: FocusSession = {
  id: "s",
  version: 1,
  technique: "pomodoro",
  method_id: null,
  method_name: "Pomodoro",
  plan: { technique: "pomodoro", focus_seconds: 1500, short_break_seconds: 300, long_break_seconds: 900, long_break_every: 4, cycles: 4 },
  timeline: [],
  intention: null,
  course: null,
  lesson: null,
  status: "active",
  stage: "focus",
  paused: false,
  running: true,
  cycle: 1,
  cycles_total: 4,
  cycles_completed: 0,
  cycles_invalidated: 0,
  phase_index: 0,
  phase_started_at: 1000,
  phase_ends_at: 2500,
  run_started_at: 1000,
  paused_at: null,
  phase_focus_seconds: 0,
  focus_seconds: 0,
  break_seconds: 0,
  started_at: 1000,
  xp: 0,
  next: null,
  deadline_at: null,
};

describe("readout", () => {
  it("conta a partir dos instantes do servidor", () => {
    const r = readout(base, 1600);
    expect(r.remaining).toBe(900);
    expect(r.elapsed).toBe(600);
    expect(r.fraction).toBeCloseTo(0.4);
    expect(r.focus).toBe(600);
  });

  it("congela quando pausado, mesmo com o relógio andando", () => {
    const paused = { ...base, paused: true, running: false, run_started_at: null, paused_at: 1600, phase_focus_seconds: 600, focus_seconds: 600 };
    expect(readout(paused, 1600).remaining).toBe(900);
    expect(readout(paused, 9000).remaining).toBe(900);
    expect(readout(paused, 9000).focus).toBe(600);
  });

  it("nunca fica negativo depois do fim (até o servidor confirmar a transição)", () => {
    expect(readout(base, 4000).remaining).toBe(0);
    expect(readout(base, 4000).fraction).toBe(1);
  });

  it("cronômetro livre não tem fim", () => {
    const sw = { ...base, plan: { ...base.plan, focus_seconds: null }, phase_ends_at: null, deadline_at: 1000 + 14400 };
    const r = readout(sw, 1300);
    expect(r.remaining).toBeNull();
    expect(r.elapsed).toBe(300);
    expect(nextBoundary(sw)).toBe(15400);
  });

  it("pausa usa início e fim da etapa", () => {
    const br = { ...base, stage: "short_break" as const, run_started_at: null, phase_started_at: 2500, phase_ends_at: 2800, focus_seconds: 1500 };
    const r = readout(br, 2600);
    expect(r.remaining).toBe(200);
    expect(r.focus).toBe(1500);
    expect(nextBoundary(br)).toBe(2800);
  });
});

describe("clock", () => {
  it("formata e arredonda para cima na contagem regressiva", () => {
    expect(clock(1500)).toBe("25:00");
    expect(clock(899.2, { ceil: true })).toBe("15:00");
    expect(clock(3909)).toBe("1:05:09");
    expect(clock(-3)).toBe("00:00");
  });
});
