// Leituras derivadas do resultado da indexação (`IndexResult`). Tudo aqui é
// calculado a partir do que o backend devolveu; nada é guardado em separado.
import type { IconName } from "../components/Icon";
import type { Lesson, Material, Report, Section } from "../api";

export function countLessons(section: Section): number {
  return section.lessons.length + section.children.reduce((n, c) => n + countLessons(c), 0);
}

export function countUnresolved(section: Section): number {
  return section.lessons.filter((l) => !l.resolved).length + section.children.reduce((n, c) => n + countUnresolved(c), 0);
}

export function countSubtopics(section: Section): number {
  return section.children.length + section.children.reduce((n, c) => n + countSubtopics(c), 0);
}

export type LessonKind = "video" | "image" | "audio" | "file" | "text" | "missing";

/** O que a aula tem de principal, pelo material mais "forte" que ela recebeu. */
export function lessonKind(lesson: Lesson): LessonKind {
  const kinds = new Set(lesson.materials.map((m) => m.media?.kind ?? "text"));
  if (lesson.materials.length === 0) return "missing";
  if (kinds.has("video")) return "video";
  if (kinds.has("document") || kinds.has("other")) return "file";
  if (kinds.has("audio") || kinds.has("voice")) return "audio";
  if (kinds.has("photo")) return "image";
  return "text";
}

export const KIND_ICON: Record<LessonKind, IconName> = {
  video: "play",
  image: "image",
  audio: "audio",
  file: "file",
  text: "text",
  missing: "warningCircle",
};

export const KIND_LABEL: Record<LessonKind, string> = {
  video: "Vídeo",
  image: "Imagem",
  audio: "Áudio",
  file: "Arquivo",
  text: "Texto",
  missing: "Sem mensagem",
};

export const MEDIA_LABEL: Record<string, string> = {
  video: "Vídeo",
  photo: "Imagem",
  audio: "Áudio",
  voice: "Mensagem de voz",
  document: "Arquivo",
  other: "Mídia",
};

export function materialIcon(material: Material): IconName {
  switch (material.media?.kind) {
    case "video":
      return "video";
    case "photo":
      return "image";
    case "audio":
    case "voice":
      return "audio";
    case undefined:
      return "text";
    default:
      return "file";
  }
}

export const REASON_LABEL: Record<Material["reason"], string> = {
  tag: "Identificador na legenda",
  album: "Mesmo álbum",
  chronological: "Ordem cronológica",
};

export const TITLE_SOURCE_LABEL: Record<string, string> = {
  caption: "Título da legenda",
  file_name: "Título do nome do arquivo",
  summary_label: "Título do sumário",
  generated: "Título gerado",
};

/** Indicadores na ordem do backend; rótulos para as chaves conhecidas. */
export const STAT_LABELS: Record<string, string> = {
  messages: "Mensagens",
  media_messages: "Com mídia",
  lessons: "Aulas",
  resolved_lessons: "Resolvidas",
  unresolved_lessons: "Não resolvidas",
  materials: "Materiais",
  orphan_media_messages: "Mídias fora do curso",
};

/** Indicadores que pedem atenção quando passam de zero. */
export const ATTENTION_STATS = new Set(["unresolved_lessons", "orphan_media_messages"]);

export interface IssueGroup {
  key: string;
  title: string;
  hint: string;
  items: string[];
}

const firstLine = (text: string) => text.trim().split("\n")[0].slice(0, 80);

/** Pontos do relatório para conferir, cada grupo com uma explicação curta. */
export function issueGroups(report: Report): IssueGroup[] {
  const groups: IssueGroup[] = [
    {
      key: "unresolved",
      title: "Referências não resolvidas",
      hint: "Estão no sumário, mas nenhuma mensagem do canal tem o identificador.",
      items: report.unresolved.map((u) => `#${u.ref} · ${u.section}${u.location ? ` · sumário ${u.location}` : ""}`),
    },
    {
      key: "orphans",
      title: "Materiais fora do curso",
      hint: "Mensagens com mídia que não entraram em nenhuma aula.",
      items: report.orphans.map(
        (o) =>
          `${o.message_ids.length === 1 ? "Mensagem" : "Mensagens"} ${o.message_ids.join(", ")}` +
          (o.refs.length ? ` · ${o.refs.map((r) => `#${r}`).join(" ")}` : "") +
          (o.caption.trim() ? ` · ${firstLine(o.caption)}` : ""),
      ),
    },
    {
      key: "not-in-summary",
      title: "No canal, mas fora do sumário",
      hint: "Identificadores usados em mensagens que o sumário não cita.",
      items: Object.entries(report.refs_not_in_summary).map(([ref, ids]) => `#${ref} · mensagens ${ids.join(", ")}`),
    },
    {
      key: "duplicates",
      title: "Duplicadas no sumário",
      hint: "O mesmo identificador aparece mais de uma vez; vale a primeira ocorrência.",
      items: report.duplicates_in_summary.map(
        (d) => `#${d.ref} · mantida em ${d.kept_at ?? "?"}, ignorada em ${d.ignored_at.join(", ")}`,
      ),
    },
    {
      key: "multi",
      title: "Referências com várias mensagens",
      hint: "Uma aula recebeu mais de uma mensagem com o mesmo identificador.",
      items: report.multi_message_refs.map((m) => `#${m.ref} · mensagens ${m.message_ids.join(", ")}`),
    },
    {
      key: "shared",
      title: "Mensagens em mais de uma aula",
      hint: "A mesma mensagem foi associada a aulas diferentes.",
      items: report.shared_messages.map((s) => `Mensagem ${s.message_id} · ${s.refs.map((r) => `#${r}`).join(" ")}`),
    },
    {
      key: "warnings",
      title: "Avisos do sumário",
      hint: "Observações do leitor do sumário.",
      items: report.summary.warnings,
    },
    {
      key: "candidates",
      title: "Outros candidatos a sumário",
      hint: "Mensagens que pareciam sumário, mas foram descartadas.",
      items: report.summary.discarded_candidates.map((c) => `Mensagens ${c.message_ids.join(", ")} · ${c.refs} referências`),
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** "2:4" (mensagem:linha) → texto legível. */
export function formatLocation(location: string | null) {
  if (!location) return null;
  const [message, line] = location.split(":");
  return line ? `mensagem ${message}, linha ${line}` : `mensagem ${message}`;
}
