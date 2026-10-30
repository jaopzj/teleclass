import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import { learningApi, Note } from "../learning/api";

const DEBOUNCE_MS = 1000;
const MAX_WAIT_MS = 6000;
const RETRY_MS = 5000;

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

interface Draft {
  body: string;
  base: number;
  at: number;
}

/**
 * Anotação com salvamento automático e proteção contra perda:
 *
 * - grava ~1 s depois que a pessoa para de digitar (no máximo a cada 6 s);
 * - cada alteração também vai para o localStorage até o servidor confirmar,
 *   então um travamento ou queda de rede não perde o texto;
 * - ao sair da aula ou fechar a página, envia o que faltar com `keepalive`;
 * - se outra aba/dispositivo gravou antes (409), não sobrescreve: mostra o
 *   conflito e deixa a pessoa escolher a versão.
 */
export function useNoteAutosave(courseId: string, lessonKey: string, initial: Note) {
  const draftKey = `teleaula:note:${courseId}:${lessonKey}`;
  const [body, setBody] = useState(initial.body);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [savedAt, setSavedAt] = useState<string | null>(initial.updated_at);
  const [conflict, setConflict] = useState<Note | null>(null);

  const bodyRef = useRef(initial.body);
  const revision = useRef(initial.revision);
  const lastSaved = useRef(initial.body);
  const saving = useRef(false);
  const timer = useRef<number>();
  const firstDirtyAt = useRef<number | null>(null);
  const statusRef = useRef<SaveStatus>("saved");
  const setState = (s: SaveStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  const writeDraft = useCallback(
    (text: string) => {
      try {
        const draft: Draft = { body: text, base: revision.current, at: Date.now() };
        localStorage.setItem(draftKey, JSON.stringify(draft));
      } catch {
        /* sem localStorage (modo privado): segue só com o servidor */
      }
    },
    [draftKey],
  );
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignorado */
    }
  }, [draftKey]);

  const save = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current);
    if (statusRef.current === "conflict") return;
    if (saving.current) return; // ao terminar, a gravação em curso verifica se há mais o que enviar
    const text = bodyRef.current;
    if (text === lastSaved.current) {
      setState("saved");
      clearDraft();
      return;
    }
    saving.current = true;
    firstDirtyAt.current = null;
    setState("saving");
    try {
      const note = await learningApi.saveNote(courseId, lessonKey, text, revision.current);
      revision.current = note.revision;
      lastSaved.current = text;
      setSavedAt(note.updated_at);
      if (bodyRef.current === text) {
        setState("saved");
        clearDraft();
      } else {
        writeDraft(bodyRef.current); // base nova para o rascunho que continua pendente
        setState("dirty");
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const current = (e.body as { current?: Note }).current ?? null;
        setConflict(current);
        setState("conflict");
      } else {
        setState("error");
        timer.current = window.setTimeout(() => void save(), RETRY_MS);
      }
    } finally {
      saving.current = false;
    }
    if (statusRef.current === "dirty") void save();
  }, [courseId, lessonKey, clearDraft, writeDraft]);

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    const now = Date.now();
    firstDirtyAt.current ??= now;
    const wait = Math.min(DEBOUNCE_MS, Math.max(0, firstDirtyAt.current + MAX_WAIT_MS - now));
    timer.current = window.setTimeout(() => void save(), wait);
  }, [save]);

  const change = useCallback(
    (text: string) => {
      bodyRef.current = text;
      setBody(text);
      writeDraft(text);
      if (statusRef.current === "conflict") return;
      setState(text === lastSaved.current && !saving.current ? "saved" : "dirty");
      schedule();
    },
    [schedule, writeDraft],
  );

  // Rascunho local que não chegou ao servidor (ex.: a página fechou sem rede).
  useEffect(() => {
    let draft: Draft | null = null;
    try {
      draft = JSON.parse(localStorage.getItem(draftKey) ?? "null");
    } catch {
      draft = null;
    }
    if (!draft || draft.body === initial.body) {
      clearDraft();
      return;
    }
    bodyRef.current = draft.body;
    setBody(draft.body);
    if (draft.base === initial.revision) {
      setState("dirty");
      schedule();
    } else {
      setConflict(initial);
      setState("conflict");
    }
    // Só no carregamento da aula.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Saindo da aula ou fechando a página: envia o que faltar.
  useEffect(() => {
    const flush = () => {
      if (statusRef.current === "conflict" || bodyRef.current === lastSaved.current) return;
      learningApi.saveNote(courseId, lessonKey, bodyRef.current, revision.current, true).catch(() => {});
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (statusRef.current === "dirty" || statusRef.current === "saving") flush();
      if (statusRef.current === "error" || statusRef.current === "conflict") {
        event.preventDefault(); // pede confirmação: o texto só está neste navegador
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.clearTimeout(timer.current);
      if (!saving.current) flush();
      // Se havia gravação em curso, o rascunho local garante a recuperação.
    };
  }, [courseId, lessonKey]);

  const resolveConflict = useCallback(
    (keep: "mine" | "theirs") => {
      if (!conflict) return;
      revision.current = conflict.revision;
      lastSaved.current = conflict.body;
      setConflict(null);
      if (keep === "theirs") {
        bodyRef.current = conflict.body;
        setBody(conflict.body);
        setSavedAt(conflict.updated_at);
        clearDraft();
        setState("saved");
      } else {
        setState("dirty");
        void save();
      }
    },
    [conflict, clearDraft, save],
  );

  return { body, change, status, savedAt, conflict, saveNow: save, resolveConflict };
}
