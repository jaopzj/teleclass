// Contexto do editor: o que os blocos especiais precisam saber da página
// (aula aberta, situação das referências, envio de arquivos).
import { createContext, useContext } from "react";
import type { NoteFile, ResolvedRef } from "../api";

export type Variant = "compact" | "full";

export interface EditorEnv {
  variant: Variant;
  /** Aula a que a anotação está ligada: timestamps soltos apontam para ela. */
  lesson: { courseId: string; lessonKey: string; duration?: number | null } | null;
  /** Situação das referências "@" (curso removido, tempo fora do vídeo...). */
  refs: ResolvedRef[];
  /** Envia um arquivo do caderno. Só no editor completo. */
  upload?: (file: File, kind: "image" | "file") => Promise<NoteFile | null>;
}

export const EditorEnvContext = createContext<EditorEnv>({ variant: "full", lesson: null, refs: [] });

export function useEditorEnv() {
  return useContext(EditorEnvContext);
}

export function refKey(r: { courseId?: string; course_id?: string; kind: string; sectionId?: string | null; section_id?: string | null; lessonKey?: string | null; lesson_key?: string | null; seconds?: number | null }) {
  return [r.courseId ?? r.course_id, r.kind, r.sectionId ?? r.section_id ?? "", r.lessonKey ?? r.lesson_key ?? "", r.seconds ?? ""].join("|");
}
