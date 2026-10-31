import type { JSONContent } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import { ConflictVersion, notebookApi, ResolvedRef } from "./api";

const DEBOUNCE_MS = 900;
const MAX_WAIT_MS = 5000;
const RETRY_MS = 4000;
const POLL_MS = 15000;

export type SyncStatus = "saved" | "dirty" | "saving" | "offline" | "error" | "conflict";

interface Draft {
  doc: JSONContent;
  title: string;
  base: number;
  at: number;
}

export interface SyncInitial {
  id: string | null;
  doc: JSONContent;
  title: string;
  revision: number;
}

export interface NoteSyncOptions {
  initial: SyncInitial;
  /** Chave do rascunho local quando a nota ainda não existe (ex.: nova nota rápida da aula). */
  draftKey?: string;
  /** Cria a nota no primeiro salvamento (notas rápidas). */
  create?: (doc: JSONContent) => Promise<{ id: string; revision: number }>;
  /** Outro dispositivo salvou e aqui não há alterações: a tela troca o conteúdo. */
  onRemote?: (version: { doc: JSONContent; title: string; revision: number }) => void;
  onSaved?: (ack: { id: string; revision: number; refs?: ResolvedRef[]; updated_at?: string }) => void;
  readOnly?: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function readDraft(key: string): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

/**
 * Salvamento automático confiável de uma anotação:
 *
 * - grava ~1 s depois que a pessoa para de digitar (no máximo a cada 5 s);
 * - cada alteração vai também para o localStorage até o servidor confirmar:
 *   travamento, aba fechada ou queda de rede não perdem o texto;
 * - sem conexão: fica "offline" e envia sozinho quando a rede volta;
 * - ao sair da página, envia o que faltar com `keepalive`;
 * - outro dispositivo gravou antes (409): não sobrescreve, mostra o conflito;
 * - sem alterações locais, busca de tempos em tempos a versão do servidor para
 *   acompanhar edições feitas em outro dispositivo.
 */
export function useNoteSync({ initial, draftKey, create, onRemote, onSaved, readOnly }: NoteSyncOptions) {
  const keyFor = (id: string | null) => (id ? `teleaula:notebook:${id}` : draftKey ?? null);
  // Rascunho local mais novo que o servidor: entra no lugar do conteúdo inicial.
  const [boot] = useState(() => {
    const key = keyFor(initial.id);
    const draft = key ? readDraft(key) : null;
    if (!draft || (same(draft.doc, initial.doc) && draft.title === initial.title)) {
      if (key && draft) localStorage.removeItem(key);
      return { doc: initial.doc, title: initial.title, status: "saved" as SyncStatus, conflict: null as ConflictVersion | null };
    }
    if (draft.base === initial.revision) return { doc: draft.doc, title: draft.title, status: "dirty" as SyncStatus, conflict: null };
    return {
      doc: draft.doc,
      title: draft.title,
      status: "conflict" as SyncStatus,
      conflict: initial.id
        ? { id: initial.id, revision: initial.revision, title: initial.title, doc: initial.doc, words: 0, content_updated_at: "" }
        : null,
    };
  });

  const [status, setStatusState] = useState<SyncStatus>(boot.status);
  const [conflict, setConflict] = useState<ConflictVersion | null>(boot.conflict);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [noteId, setNoteId] = useState<string | null>(initial.id);

  const idRef = useRef(initial.id);
  const docRef = useRef(boot.doc);
  const titleRef = useRef(boot.title);
  const revision = useRef(initial.revision);
  const saved = useRef({ doc: initial.doc, title: initial.title });
  const saving = useRef(false);
  const timer = useRef<number>();
  const firstDirtyAt = useRef<number | null>(null);
  const statusRef = useRef<SyncStatus>(boot.status);
  const optsRef = useRef({ create, onRemote, onSaved });
  optsRef.current = { create, onRemote, onSaved };

  const setStatus = (s: SyncStatus) => {
    statusRef.current = s;
    setStatusState(s);
  };
  const isDirty = () => !same(docRef.current, saved.current.doc) || titleRef.current !== saved.current.title;

  const writeDraft = useCallback(() => {
    const key = keyFor(idRef.current);
    if (!key) return;
    try {
      const draft: Draft = { doc: docRef.current, title: titleRef.current, base: revision.current, at: Date.now() };
      localStorage.setItem(key, JSON.stringify(draft));
    } catch {
      /* sem localStorage: segue só com o servidor */
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clearDraft = useCallback(() => {
    for (const key of [keyFor(idRef.current), draftKey]) {
      if (!key) continue;
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignorado */
      }
    }
  }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (overwrite = false): Promise<void> => {
    window.clearTimeout(timer.current);
    if (readOnly) return;
    if (statusRef.current === "conflict" && !overwrite) return;
    if (saving.current) return; // ao terminar, a gravação em curso confere se há mais a enviar
    if (!isDirty() && !overwrite) {
      if (statusRef.current !== "saved") setStatus("saved");
      clearDraft();
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setStatus("offline");
      return;
    }
    const doc = docRef.current;
    const title = titleRef.current;
    saving.current = true;
    firstDirtyAt.current = null;
    setStatus("saving");
    try {
      if (!idRef.current) {
        const created = await optsRef.current.create!(doc);
        idRef.current = created.id;
        setNoteId(created.id);
        revision.current = created.revision;
        if (draftKey) localStorage.removeItem(draftKey);
        optsRef.current.onSaved?.({ id: created.id, revision: created.revision });
      } else {
        const ack = await notebookApi.saveContent(idRef.current, { title, doc, base_revision: revision.current, overwrite });
        revision.current = ack.revision;
        optsRef.current.onSaved?.(ack);
      }
      saved.current = { doc, title };
      setSavedAt(Date.now());
      if (isDirty()) {
        writeDraft();
        setStatus("dirty");
      } else {
        clearDraft();
        setStatus("saved");
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict((e.body as { current?: ConflictVersion }).current ?? null);
        setStatus("conflict");
      } else if (e instanceof ApiError && e.code === "network_error") {
        setStatus("offline");
        timer.current = window.setTimeout(() => void save(), RETRY_MS);
      } else if (e instanceof ApiError && e.status === 400) {
        setStatus("error"); // conteúdo recusado: não adianta repetir sozinho
      } else {
        setStatus("error");
        timer.current = window.setTimeout(() => void save(), RETRY_MS * 2);
      }
    } finally {
      saving.current = false;
    }
    if (statusRef.current === "dirty") void save();
  }, [readOnly, clearDraft, writeDraft, draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    const now = Date.now();
    firstDirtyAt.current ??= now;
    const wait = Math.min(DEBOUNCE_MS, Math.max(0, firstDirtyAt.current + MAX_WAIT_MS - now));
    timer.current = window.setTimeout(() => void save(), wait);
  }, [save]);

  const touch = useCallback(() => {
    writeDraft();
    if (statusRef.current === "conflict") return;
    if (!isDirty() && !saving.current) {
      setStatus("saved");
      return;
    }
    if (statusRef.current !== "offline") setStatus("dirty");
    schedule();
  }, [schedule, writeDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDoc = useCallback((doc: JSONContent) => {
    docRef.current = doc;
    touch();
  }, [touch]);

  const setTitle = useCallback((title: string) => {
    titleRef.current = title;
    touch();
  }, [touch]);

  // Rascunho restaurado ao abrir: envia logo.
  useEffect(() => {
    if (boot.status === "dirty") schedule();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rede de volta: envia o que ficou pendente.
  useEffect(() => {
    const online = () => {
      if (statusRef.current === "offline" || statusRef.current === "error" || statusRef.current === "dirty") void save();
    };
    const offline = () => {
      if (statusRef.current === "dirty" || statusRef.current === "saving") setStatus("offline");
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [save]);

  // Edições feitas em outro dispositivo.
  const checkRemote = useCallback(async () => {
    const id = idRef.current;
    if (!id || readOnly || statusRef.current !== "saved" || saving.current || document.visibilityState !== "visible") return;
    try {
      const info = await notebookApi.revisionInfo(id);
      if (info.revision <= revision.current || statusRef.current !== "saved" || isDirty()) return;
      const note = await notebookApi.get(id);
      if (statusRef.current !== "saved" || isDirty()) return;
      revision.current = note.revision;
      saved.current = { doc: note.doc, title: note.title };
      docRef.current = note.doc;
      titleRef.current = note.title;
      optsRef.current.onRemote?.({ doc: note.doc, title: note.title, revision: note.revision });
    } catch {
      /* sem rede: tenta na próxima */
    }
  }, [readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const interval = window.setInterval(() => void checkRemote(), POLL_MS);
    const onFocus = () => void checkRemote();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [checkRemote]);

  // Saindo: envia o que faltar.
  useEffect(() => {
    const flush = () => {
      const id = idRef.current;
      if (!id || statusRef.current === "conflict" || !isDirty()) return;
      notebookApi.saveContent(id, { title: titleRef.current, doc: docRef.current, base_revision: revision.current }, true).catch(() => {});
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (statusRef.current === "dirty" || statusRef.current === "saving") flush();
      if (statusRef.current === "error" || statusRef.current === "conflict" || statusRef.current === "offline") {
        event.preventDefault(); // o texto só está neste navegador
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.clearTimeout(timer.current);
      if (!saving.current) flush();
      // Gravação em curso: o rascunho local garante a recuperação.
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Resolve o conflito: manter a minha, usar a do servidor, ou guardar a minha como cópia. */
  const resolve = useCallback(
    async (choice: "mine" | "theirs" | "copy"): Promise<{ doc: JSONContent; title: string } | null> => {
      if (!conflict) return null;
      revision.current = conflict.revision;
      if (choice === "mine") {
        setConflict(null);
        setStatus("dirty");
        await save(true);
        return null;
      }
      if (choice === "copy") {
        await notebookApi.create({ kind: "page", title: `${titleRef.current || "Sem título"} (minha versão)`, doc: docRef.current });
      }
      saved.current = { doc: conflict.doc, title: conflict.title };
      docRef.current = conflict.doc;
      titleRef.current = conflict.title;
      setConflict(null);
      clearDraft();
      setStatus("saved");
      return { doc: conflict.doc, title: conflict.title };
    },
    [conflict, save, clearDraft],
  );

  /** Depois de restaurar uma versão do histórico: a nota mudou no servidor. */
  const reset = useCallback((version: { doc: JSONContent; title: string; revision: number }) => {
    revision.current = version.revision;
    saved.current = { doc: version.doc, title: version.title };
    docRef.current = version.doc;
    titleRef.current = version.title;
    clearDraft();
    setStatus("saved");
  }, [clearDraft]);

  return {
    noteId,
    initialDoc: boot.doc,
    initialTitle: boot.title,
    status,
    conflict,
    savedAt,
    revision: () => revision.current,
    setDoc,
    setTitle,
    saveNow: () => save(),
    resolve,
    reset,
  };
}

export const SYNC_LABEL: Record<SyncStatus, string> = {
  saved: "Salvo",
  dirty: "Editando…",
  saving: "Salvando…",
  offline: "Sem conexão · salvo neste aparelho",
  error: "Falha ao salvar",
  conflict: "Conflito de versões",
};
