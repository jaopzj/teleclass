import { describe, expect, it } from "vitest";
import type { Occurrence } from "./api";
import { addDays, addMonths, monthWeeks, relativeDay, weekday, weekStart, weekTitle } from "./dates";
import { busyLevel, conflictIds, groupTimeline, minutesLabel, nextActivity, timeRange } from "./domain";

const occ = (id: string, extra: Partial<Occurrence> = {}): Occurrence =>
  ({
    id,
    date: "2026-11-09",
    title: id,
    start_time: null,
    duration_minutes: null,
    period: null,
    display_period: null,
    position: 0,
    status: "pending",
    is_optional: false,
    ...extra,
  }) as Occurrence;

describe("datas", () => {
  it("semana começa na segunda", () => {
    expect(weekday("2026-11-09")).toBe(0);
    expect(weekday("2026-11-15")).toBe(6);
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
  });
  it("aritmética sem fuso", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
  it("grade do mês cobre semanas inteiras", () => {
    const weeks = monthWeeks("2026-11-20");
    expect(weeks[0][0]).toBe("2026-10-26");
    expect(weeks[weeks.length - 1][6]).toBe("2026-12-06");
  });
  it("rótulos", () => {
    expect(relativeDay("2026-11-10", "2026-11-09")).toBe("Amanhã");
    expect(weekTitle("2026-11-11")).toBe("9 – 15 de novembro");
  });
});

describe("timeline", () => {
  it("agrupa por período e deixa o resto em sem horário", () => {
    const g = groupTimeline([
      occ("noite", { start_time: "19:00", display_period: "evening" }),
      occ("manhã-livre", { period: "morning", display_period: "morning", position: 0 }),
      occ("manhã", { start_time: "07:00", display_period: "morning", position: 5 }),
      occ("solta-2", { position: 2 }),
      occ("solta-1", { position: 1 }),
    ]);
    expect(g.periods.map((p) => [p.key, p.items.map((i) => i.id)])).toEqual([
      ["morning", ["manhã", "manhã-livre"]],
      ["evening", ["noite"]],
    ]);
    expect(g.unscheduled.map((i) => i.id)).toEqual(["solta-1", "solta-2"]);
  });

  it("próxima atividade respeita o relógio", () => {
    const items = [
      occ("a", { start_time: "08:00", duration_minutes: 30, display_period: "morning" }),
      occ("b", { start_time: "10:00", display_period: "morning" }),
      occ("c"),
    ];
    expect(nextActivity(items, 8 * 60 + 10)).toEqual({ item: items[0], current: true });
    expect(nextActivity(items, 9 * 60)?.item.id).toBe("b");
    expect(nextActivity(items, 11 * 60)?.item.id).toBe("a");
    expect(nextActivity([occ("x", { status: "in_progress" })], 0)?.current).toBe(true);
    expect(nextActivity([occ("x", { status: "completed" })], 0)).toBeNull();
  });

  it("formatos e conflitos", () => {
    expect(minutesLabel(90)).toBe("1 h 30");
    expect(timeRange({ start_time: "08:00", duration_minutes: 45 })).toBe("08:00 – 08:45");
    expect(conflictIds([["a", "b"], ["a", "c"]]).get("a")).toEqual(["b", "c"]);
    expect(busyLevel(0, 0)).toBe(0);
    expect(busyLevel(400, 2)).toBe(3);
  });
});
