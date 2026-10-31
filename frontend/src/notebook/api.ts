// Tipos e chamadas do Caderno Digital. Espelham app/api/notebook.py.
import type { JSONContent } from "@tiptap/react";
import { ApiError, request } from "../api";

export type NoteKind = "quick" | "page";
export type View = "all" | "recent" | "favorites" | "pinned" | "quick" | "unfiled" | "archived" | "trash";
export type RefStatus = "ok" | "missing_course" | "missing_target" | "out_of_range";

export interface Tag {
  id: string;
  name: string;
  color: string;
  notes?: number | null;
}

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
  notes: number;
}

export interface LinkContext {
  status: "ok" | "missing_course" | "missing_target";
  course_title: string | null;
  lesson_title?: string;
  lesson_number?: number;
  section_title?: string;
  duration?: number | null;
  path?: string[];
  has_video?: boolean;
  available?: boolean;
}

export interface NoteSummary {
  id: string;
  kind: NoteKind;
  title: string;
  excerpt: string;
  words: number;
  folder_id: string | null;
  folder_path: { id: string; name: string }[];
  course_id: string | null;
  section_id: string | null;
  lesson_key: string | null;
  timestamp_seconds: number | null;
  favorite: boolean;
  pinned: boolean;
  archived: boolean;
  deleted_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  content_updated_at: string;
  opened_at: string | null;
  tags: Tag[];
  context: LinkContext | null;
}

export interface ResolvedRef extends Partial<Omit<LinkContext, "status">> {
  course_id: string;
  kind: "course" | "section" | "lesson";
  section_id: string | null;
  lesson_key: string | null;
  seconds: number | null;
  status: RefStatus;
}

export interface NoteFile {
  id: string;
  kind: "image" | "file";
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  url?: string;
}

export interface Note extends NoteSummary {
  doc: JSONContent;
  refs: ResolvedRef[];
  files: NoteFile[];
}

export interface QuickNote extends NoteSummary {
  doc: JSONContent;
}

export interface ContentAck {
  id: string;
  revision: number;
  title: string;
  words: number;
  updated_at: string;
  content_updated_at: string;
  refs: ResolvedRef[];
}

export interface ConflictVersion {
  id: string;
  revision: number;
  title: string;
  doc: JSONContent;
  words: number;
  content_updated_at: string;
}

export interface Overview {
  counts: Record<View, number>;
  folders: Folder[];
  tags: Tag[];
  courses: { id: string; title: string | null; notes: number; missing?: boolean }[];
  tag_colors: string[];
}

export interface SearchResult extends NoteSummary {
  title_highlight: string;
  snippet: string;
}

export interface Target {
  kind: "course" | "section" | "lesson";
  course_id: string;
  course_title: string;
  section_id?: string;
  lesson_key?: string;
  title: string;
  number?: number;
  path: string[];
  duration?: number | null;
  has_video?: boolean;
}

export interface Revision {
  id: number;
  revision: number;
  title: string;
  words: number;
  reason: "autosave" | "conflict" | "before_restore";
  created_at: string;
}

export interface LessonNotes {
  quick: QuickNote[];
  pages: NoteSummary[];
  citing: (NoteSummary & { moments: number[] })[];
}

export interface LinkInput {
  course_id: string | null;
  section_id?: string | null;
  lesson_key?: string | null;
}

export interface CreateInput {
  kind?: NoteKind;
  title?: string;
  doc?: JSONContent;
  folder_id?: string | null;
  link?: LinkInput | null;
  timestamp_seconds?: number | null;
  tag_ids?: string[];
}

export interface UpdateInput {
  title?: string;
  folder_id?: string | null;
  favorite?: boolean;
  pinned?: boolean;
  archived?: boolean;
  tag_ids?: string[];
  link?: LinkInput | null;
  timestamp_seconds?: number | null;
  kind?: "page";
}

export interface ListParams {
  view?: View;
  folder?: string;
  course?: string;
  lesson?: string;
  tag?: string;
  sort?: "updated" | "created" | "title" | "timestamp";
}

const BASE = "/api/notebook";
const qs = (params: Record<string, string | boolean | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : "";
};

/** Avisa as telas do caderno que algo mudou (lista, contadores, aula). */
export const NOTEBOOK_EVENT = "teleaula:notebook-changed";
export function notebookChanged(detail?: { noteId?: string }) {
  window.dispatchEvent(new CustomEvent(NOTEBOOK_EVENT, { detail }));
}

function changed<T>(promise: Promise<T>, noteId?: string): Promise<T> {
  return promise.then((value) => {
    notebookChanged({ noteId });
    return value;
  });
}

export const notebookApi = {
  overview: () => request<Overview>(`${BASE}/overview`),
  list: (params: ListParams) => request<NoteSummary[]>(`${BASE}/notes${qs({ ...params })}`),
  get: (id: string) => request<Note>(`${BASE}/notes/${id}`),
  revisionInfo: (id: string) => request<{ id: string; revision: number; content_updated_at: string; deleted: boolean }>(`${BASE}/notes/${id}/revision`),
  create: (input: CreateInput) => changed(request<Note>(`${BASE}/notes`, { method: "POST", body: JSON.stringify(input) })),
  saveContent: (id: string, body: { title?: string; doc: JSONContent; base_revision: number; overwrite?: boolean }, keepalive = false) =>
    request<ContentAck>(`${BASE}/notes/${id}/content`, { method: "PUT", keepalive, body: JSON.stringify(body) }),
  update: (id: string, input: UpdateInput) =>
    changed(request<Note>(`${BASE}/notes/${id}`, { method: "PATCH", body: JSON.stringify(input) }), id),
  duplicate: (id: string) => changed(request<Note>(`${BASE}/notes/${id}/duplicate`, { method: "POST" })),
  trash: (id: string) => changed(request<void>(`${BASE}/notes/${id}`, { method: "DELETE" }), id),
  destroy: (id: string) => changed(request<void>(`${BASE}/notes/${id}?permanent=true`, { method: "DELETE" }), id),
  restore: (id: string) => changed(request<Note>(`${BASE}/notes/${id}/restore`, { method: "POST" }), id),
  emptyTrash: () => changed(request<{ deleted: number }>(`${BASE}/trash`, { method: "DELETE" })),

  revisions: (id: string) => request<Revision[]>(`${BASE}/notes/${id}/revisions`),
  revision: (id: string, rid: number) => request<Revision & { doc: JSONContent }>(`${BASE}/notes/${id}/revisions/${rid}`),
  restoreRevision: (id: string, rid: number, baseRevision: number) =>
    changed(request<Note>(`${BASE}/notes/${id}/revisions/${rid}/restore`, { method: "POST", body: JSON.stringify({ base_revision: baseRevision }) }), id),

  createFolder: (name: string, parentId: string | null) =>
    changed(request<Folder>(`${BASE}/folders`, { method: "POST", body: JSON.stringify({ name, parent_id: parentId }) })),
  updateFolder: (id: string, input: { name?: string; parent_id?: string | null; position?: number }) =>
    changed(request<void>(`${BASE}/folders/${id}`, { method: "PATCH", body: JSON.stringify(input) })),
  deleteFolder: (id: string) => changed(request<{ trashed: number }>(`${BASE}/folders/${id}`, { method: "DELETE" })),

  createTag: (name: string, color?: string) =>
    changed(request<Tag & { existing?: boolean }>(`${BASE}/tags`, { method: "POST", body: JSON.stringify({ name, color }) })),
  updateTag: (id: string, input: { name?: string; color?: string }) =>
    changed(request<void>(`${BASE}/tags/${id}`, { method: "PATCH", body: JSON.stringify(input) })),
  deleteTag: (id: string) => changed(request<void>(`${BASE}/tags/${id}`, { method: "DELETE" })),

  search: (q: string, scope: { folder?: string; course?: string; tag?: string; archived?: boolean }) =>
    request<{ query: string; results: SearchResult[]; total: number }>(`${BASE}/search${qs({ q, ...scope })}`),
  targets: (q: string, course?: string) => request<Target[]>(`${BASE}/targets${qs({ q, course })}`),
  lesson: (courseId: string, lessonKey: string) =>
    request<LessonNotes>(`${BASE}/lessons/${encodeURIComponent(courseId)}/${encodeURIComponent(lessonKey)}`),

  /** Envio com progresso (XHR): o fetch ainda não informa o progresso do upload. */
  upload(file: File, kind: "image" | "file", onProgress?: (fraction: number) => void): Promise<NoteFile> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      xhr.open("POST", `${BASE}/files`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onerror = () => reject(new ApiError("Sem conexão: o arquivo não foi enviado.", 0, { code: "network_error" }));
      xhr.onload = () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* resposta sem JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as unknown as NoteFile);
        else reject(new ApiError(typeof body.detail === "string" ? body.detail : `Erro ${xhr.status}`, xhr.status, body));
      };
      xhr.send(form);
    });
  },
};

export const fileUrl = (id: string) => `${BASE}/files/${id}`;
