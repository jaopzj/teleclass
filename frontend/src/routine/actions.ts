// Ações sobre as atividades do dia, com atualização otimista onde é seguro:
// a tela muda na hora e volta ao estado anterior se o servidor recusar.
import { useCallback, useState } from "react";
import { ApiError } from "../api";
import { notify } from "../notifications/center";
import { navigate, paths } from "../router";
import type { FocusSession } from "../focus/api";
import { act as focusAct, startSession, sync as syncFocus } from "../focus/store";
import { LinkInput, Occurrence, routineApi, Status } from "./api";
import { bumpRoutine } from "./session";

export type Patch = (id: string, change: Partial<Occurrence> | null) => () => void;

/** Destino de um vínculo com curso, módulo ou aula. */
export function linkTarget(link: LinkInput) {
  if (link.type === "lesson" && link.lesson_key) return paths.lesson(link.course_id, link.lesson_key);
  if (link.type === "module" && link.section_id) return paths.module(link.course_id, link.section_id);
  return paths.course(link.course_id);
}

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Tente de novo em instantes.");

export function failed(title: string, e: unknown) {
  notify({ title, body: message(e), tone: "neutral" });
}

/**
 * `patch(id, change)` aplica uma mudança local e devolve como desfazê-la;
 * `null` tira a atividade da lista.
 */
export function useOccurrenceActions(patch: Patch, onBusy: (session: FocusSession, next: Occurrence) => void, focusSession: FocusSession | null) {
  const [pending, setPending] = useState<Set<string>>(new Set());

  const run = useCallback(
    async <T,>(id: string, change: Partial<Occurrence> | null, call: () => Promise<T>, errorTitle: string): Promise<T | undefined> => {
      const undo = patch(id, change);
      setPending((s) => new Set(s).add(id));
      try {
        const result = await call();
        bumpRoutine();
        return result;
      } catch (e) {
        undo();
        failed(errorTitle, e);
        return undefined;
      } finally {
        setPending((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
    },
    [patch],
  );

  const setStatus = useCallback(
    (o: Occurrence, status: Exclude<Status, "in_progress">, extra: { actual_minutes?: number | null; reason?: string | null } = {}) =>
      run(o.id, { status, focusing: false }, () => routineApi.setStatus(o.id, status, extra), "Não foi possível salvar").then((r) => {
        // Concluir, pular ou cancelar encerra a sessão do Foco desta atividade no servidor.
        if (r && status !== "pending" && o.focusing) void syncFocus();
        return r;
      }),
    [run],
  );

  /** Inicia o cronômetro do Foco (cronômetro livre) com o tempo indo para esta atividade. */
  const start = useCallback(
    async (o: Occurrence, { open = false, force = false } = {}) => {
      if (focusSession && !force) return onBusy(focusSession, o);
      const undo = patch(o.id, { status: "in_progress", focusing: true });
      try {
        await startSession({
          technique: "stopwatch",
          intention: o.title,
          course_id: o.link?.available ? o.link.course_id : null,
          lesson_key: o.link?.available && o.link.type === "lesson" ? o.link.lesson_key : null,
          activity_id: o.id,
        });
        bumpRoutine();
        if (open && o.link?.available) navigate(linkTarget(o.link));
      } catch (e) {
        undo();
        failed("Não foi possível iniciar", e);
      }
    },
    [patch, onBusy, focusSession],
  );

  return { run, setStatus, start, pending };
}

/** Pausar, retomar e parar agem na sessão do Foco, esteja onde estiver. */
export async function focusAction(action: "pause" | "resume" | "stop") {
  try {
    await focusAct(action);
    bumpRoutine();
    return true;
  } catch (e) {
    failed("Não foi possível atualizar o cronômetro", e);
    return false;
  }
}
