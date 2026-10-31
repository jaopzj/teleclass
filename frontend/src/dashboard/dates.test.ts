import { describe, expect, it } from "vitest";
import { compactDuration } from "../format";
import { longDate, monthGrid, monthLabel, shiftMonth } from "./dates";

describe("datas da tela inicial", () => {
  it("formata a data longa como no Figma", () => {
    expect(longDate("2026-10-30")).toBe("30 de outubro, Sexta-feira");
  });

  it("monta o mês começando na segunda-feira", () => {
    const december = monthGrid("2025-12"); // 1º de dezembro de 2025 é segunda
    expect(december[0][0]).toBe("2025-12-01");
    expect(december).toHaveLength(5);
    const october = monthGrid("2026-10"); // 1º de outubro de 2026 é quinta
    expect(october[0].slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(october.flat().filter(Boolean)).toHaveLength(31);
    expect(october.every((week) => week.length === 7)).toBe(true);
  });

  it("navega entre meses e virada de ano", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthLabel("2026-10", 2026)).toBe("Outubro");
    expect(monthLabel("2025-12", 2026)).toBe("Dezembro de 2025");
  });

  it("escreve a duração do curso", () => {
    expect(compactDuration(4 * 3600 + 12 * 60)).toBe("4h e 12min");
    expect(compactDuration(3 * 3600)).toBe("3h");
    expect(compactDuration(45 * 60)).toBe("45min");
  });
});
