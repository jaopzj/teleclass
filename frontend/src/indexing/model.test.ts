import { describe, expect, it } from "vitest";
import type { Lesson, Material, Report, Section } from "../api";
import { countLessons, countSubtopics, countUnresolved, formatLocation, issueGroups, lessonKind } from "./model";

const material = (kind: string | null): Material => ({
  message_id: 1,
  reason: "tag",
  via: null,
  grouped_id: null,
  media: kind ? { kind, file_name: null, mime_type: null, size: null, duration: null } : null,
  caption: "",
});

const lesson = (position: number, resolved = true, materials: Material[] = [material("video")]): Lesson => ({
  title: `Aula ${position}`,
  title_source: "caption",
  position,
  ref: null,
  ref_raw: null,
  summary_location: null,
  resolved,
  description: "",
  materials,
});

const section = (lessons: Lesson[], children: Section[] = []): Section => ({
  title: "Módulo",
  level: 1,
  implicit: false,
  location: null,
  lessons,
  children,
});

describe("contagens da estrutura", () => {
  const tree = section([lesson(1)], [section([lesson(2, false), lesson(3)], [section([lesson(4, false)])])]);
  it("conta aulas, pendências e subtópicos em qualquer profundidade", () => {
    expect(countLessons(tree)).toBe(4);
    expect(countUnresolved(tree)).toBe(2);
    expect(countSubtopics(tree)).toBe(2);
  });
});

describe("lessonKind", () => {
  it("prioriza vídeo, depois arquivo, áudio, imagem e texto", () => {
    expect(lessonKind(lesson(1, true, [material("photo"), material("video")]))).toBe("video");
    expect(lessonKind(lesson(1, true, [material("photo"), material("document")]))).toBe("file");
    expect(lessonKind(lesson(1, true, [material("voice")]))).toBe("audio");
    expect(lessonKind(lesson(1, true, [material("photo")]))).toBe("image");
    expect(lessonKind(lesson(1, true, [material(null)]))).toBe("text");
    expect(lessonKind(lesson(1, false, []))).toBe("missing");
  });
});

describe("issueGroups", () => {
  const empty: Report = {
    summary: { parser: null, message_ids: [], discarded_candidates: [], warnings: [], fallback_reason: null },
    stats: {},
    unresolved: [],
    duplicates_in_summary: [],
    multi_message_refs: [],
    shared_messages: [],
    refs_not_in_summary: {},
    orphans: [],
  };

  it("omite grupos vazios", () => {
    expect(issueGroups(empty)).toEqual([]);
  });

  it("descreve cada ponto a conferir", () => {
    const groups = issueGroups({
      ...empty,
      unresolved: [{ ref: "A099", location: "3:6", section: "03. Extras" }],
      orphans: [{ message_ids: [19], grouped_id: null, refs: ["A050"], caption: "Aula bônus\nmais" }],
      summary: { ...empty.summary, warnings: ["Referências antes do primeiro módulo"] },
    });
    expect(groups.map((g) => g.key)).toEqual(["unresolved", "orphans", "warnings"]);
    expect(groups[0].items).toEqual(["#A099 · 03. Extras · sumário 3:6"]);
    expect(groups[1].items).toEqual(["Mensagem 19 · #A050 · Aula bônus"]);
  });
});

describe("formatLocation", () => {
  it("lê mensagem:linha", () => {
    expect(formatLocation("2:4")).toBe("mensagem 2, linha 4");
    expect(formatLocation(null)).toBeNull();
  });
});
