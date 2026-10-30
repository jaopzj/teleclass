// Cliente HTTP comum e tipos da tela de indexação, que espelham os `to_dict()` do
// backend (app/indexing/structure.py e report.py). Os tipos da área de membros
// ficam em learning/api.ts.

export interface Media {
  kind: string;
  file_name: string | null;
  mime_type: string | null;
  size: number | null;
  duration: number | null;
}

export interface Material {
  message_id: number;
  reason: "tag" | "album" | "chronological";
  via: number | null;
  grouped_id: number | null;
  media: Media | null;
  caption: string;
}

export interface Lesson {
  title: string;
  title_source: string;
  position: number;
  ref: string | null;
  ref_raw: string | null;
  summary_location: string | null;
  resolved: boolean;
  description: string;
  materials: Material[];
}

export interface Section {
  title: string;
  level: number;
  implicit: boolean;
  location: string | null;
  lessons: Lesson[];
  children: Section[];
}

export interface Report {
  summary: {
    parser: string | null;
    message_ids: number[];
    discarded_candidates: { parser: string; message_ids: number[]; refs: number }[];
    warnings: string[];
    fallback_reason: string | null;
  };
  stats: Record<string, number>;
  unresolved: { ref: string; location: string | null; section: string }[];
  duplicates_in_summary: { ref: string; kept_at: string | null; ignored_at: string[] }[];
  multi_message_refs: { ref: string; message_ids: number[] }[];
  shared_messages: { message_id: number; refs: string[] }[];
  refs_not_in_summary: Record<string, number[]>;
  orphans: { message_ids: number[]; grouped_id: number | null; refs: string[]; caption: string }[];
}

export interface IndexResult {
  name: string;
  course: { title: string; strategy: "summary" | "fallback"; sections: Section[] };
  report: Report;
}

export interface SnapshotInfo {
  name: string;
  title: string | null;
  messages: number;
  modified_at: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.detail ?? `Erro ${response.status}`, response.status, body);
  }
  return response.json() as Promise<T>;
}

export const api = {
  status: () => request<{ configured: boolean; authorized: boolean }>("/api/telegram/status"),
  snapshots: () => request<SnapshotInfo[]>("/api/snapshots"),
  collect: (link: string) =>
    request<{ name: string; messages: number }>("/api/snapshots", {
      method: "POST",
      body: JSON.stringify({ link }),
    }),
  index: (name: string) => request<IndexResult>(`/api/snapshots/${encodeURIComponent(name)}/index`),
};
