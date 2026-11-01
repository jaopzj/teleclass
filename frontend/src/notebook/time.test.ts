import { describe, expect, it } from "vitest";
import { formatStamp, parseStamp, stampProblem } from "./time";

describe("marcações de tempo", () => {
  it("formata", () => {
    expect(formatStamp(194)).toBe("03:14");
    expect(formatStamp(3750)).toBe("1:02:30");
    expect(formatStamp(-3)).toBe("00:00");
  });
  it("entende formatos comuns", () => {
    expect(parseStamp("03:14")).toBe(194);
    expect(parseStamp("3:14")).toBe(194);
    expect(parseStamp("194")).toBe(194);
    expect(parseStamp("1:02:30")).toBe(3750);
    expect(parseStamp("3m14s")).toBe(194);
    expect(parseStamp("3:75")).toBeNull();
    expect(parseStamp("abc")).toBeNull();
    expect(parseStamp("")).toBeNull();
  });
  it("valida contra a duração", () => {
    expect(stampProblem(194, 600)).toBeNull();
    expect(stampProblem(700, 600)).toContain("10:00");
    expect(stampProblem(null, 600)).toContain("mm:ss");
  });
});
