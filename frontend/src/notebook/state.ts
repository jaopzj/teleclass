// Estado compartilhado do Caderno: visão geral (pastas, etiquetas, cursos e
// contadores), recarregada sempre que algo muda.
import { useCallback, useEffect, useState } from "react";
import { Folder, notebookApi, NOTEBOOK_EVENT, Overview } from "./api";

export function useOverview() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    notebookApi
      .overview()
      .then((o) => {
        setOverview(o);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(NOTEBOOK_EVENT, load);
    return () => window.removeEventListener(NOTEBOOK_EVENT, load);
  }, [load]);
  return { overview, error, reload: load };
}

export interface FolderNode extends Folder {
  children: FolderNode[];
  depth: number;
}

export function folderTree(folders: Folder[]): FolderNode[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const list = byParent.get(f.parent_id) ?? [];
    list.push(f);
    byParent.set(f.parent_id, list);
  }
  const build = (parent: string | null, depth: number): FolderNode[] =>
    (byParent.get(parent) ?? []).map((f) => ({ ...f, depth, children: build(f.id, depth + 1) }));
  return build(null, 0);
}

export function folderPath(folders: Folder[], id: string | null): Folder[] {
  const map = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  const seen = new Set<string>();
  let current = id ? map.get(id) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parent_id ? map.get(current.parent_id) : undefined;
  }
  return path;
}

/** Ids da pasta e de todas as subpastas (para não mover uma pasta para dentro dela mesma). */
export function subtreeIds(folders: Folder[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

export const NOTE_DRAG = "application/x-teleaula-note";
export const FOLDER_DRAG = "application/x-teleaula-folder";

/** Fecha um menu ao clicar fora dele ou apertar Esc. */
export function useDismiss(open: boolean, close: () => void) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => node && !node.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, node, close]);
  return setNode;
}
