// Coleta em andamento. Fica fora da página para sobreviver à troca de tela: a
// pessoa pode navegar pela plataforma e é avisada (toast) quando terminar.
//
// O backend responde a coleta numa requisição só (POST /api/snapshots), sem
// identificador de operação nem progresso parcial. Por isso as etapas mostradas
// são as duas requisições reais (coletar e montar a estrutura), sem percentuais.
// Recarregar a página perde o acompanhamento; o backend continua impedindo uma
// segunda coleta simultânea (409).
import { useSyncExternalStore } from "react";
import { api, ApiError, IndexResult } from "../api";
import { invalidateCourses } from "../learning/coursesStore";
import { notify } from "../notifications/center";
import { navigate, paths } from "../router";

export type StepState = "pending" | "running" | "completed" | "failed";

export interface Collection {
  link: string;
  startedAt: number;
  collect: StepState;
  index: StepState;
  /** Nome do snapshot (= id do curso), quando a coleta termina. */
  name?: string;
  messages?: number;
  error?: { message: string; status: number; code?: string };
}

let current: Collection | null = null;
/** Resultado da última coleta, para a inspeção não indexar o mesmo canal duas vezes. */
let lastResult: IndexResult | null = null;
/** Snapshot recém-coletado: a inspeção mostra o aviso de sucesso uma vez. */
let fresh: string | null = null;
/** Link de uma coleta que falhou, devolvido ao campo para ser corrigido. */
let draftLink = "";
const listeners = new Set<() => void>();

function set(next: Collection | null) {
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCollection() {
  return useSyncExternalStore(subscribe, () => current);
}

export function useFreshCourse() {
  return useSyncExternalStore(subscribe, () => fresh);
}

export function dismissFresh() {
  fresh = null;
  listeners.forEach((l) => l());
}

export function isRunning(c: Collection | null) {
  return !!c && (c.collect === "running" || c.index === "running");
}

/** Mensagem para a pessoa, sem detalhes internos do servidor. */
function describe(error: unknown): Collection["error"] {
  if (error instanceof ApiError) {
    // Erros conhecidos do backend (com `code`) já vêm em linguagem de usuário.
    if (error.status >= 500 && !error.code) return { message: "O servidor não conseguiu concluir a operação. Tente de novo em instantes.", status: error.status };
    return { message: error.message, status: error.status, code: error.code };
  }
  return { message: "Algo deu errado. Tente de novo.", status: 0 };
}

const onIndexingPage = () => location.pathname === paths.indexing();

export async function startCollection(link: string) {
  if (isRunning(current)) return; // um clique só por vez; o backend também bloqueia
  dismissFresh();
  draftLink = "";
  set({ link, startedAt: Date.now(), collect: "running", index: "pending" });

  let name: string;
  try {
    const collected = await api.collect(link);
    name = collected.name;
    invalidateCourses(); // o canal já é um curso da biblioteca
    set({ ...current!, collect: "completed", index: "running", name, messages: collected.messages });
  } catch (e) {
    const error = describe(e);
    set({ ...current!, collect: "failed", error });
    if (!onIndexingPage()) {
      notify({
        title: "A coleta não foi concluída",
        body: error?.message,
        action: { label: "Ver detalhes", run: () => navigate(paths.indexing()) },
      });
    }
    return;
  }

  try {
    const result = await api.index(name);
    fresh = name;
    lastResult = result;
    set({ ...current!, index: "completed" });
    if (!onIndexingPage()) {
      notify({
        title: "Curso adicionado",
        body: `${result.course.title} já está na sua biblioteca.`,
        tone: "success",
        action: { label: "Conferir estrutura", run: () => navigate(paths.indexing(name)) },
      });
    }
  } catch (e) {
    set({ ...current!, index: "failed", error: describe(e) });
  }
}

/** Carrega a estrutura de um snapshot, reaproveitando a da coleta que acabou de terminar. */
export function loadIndex(name: string): Promise<IndexResult> {
  if (lastResult?.name === name) {
    const result = lastResult;
    lastResult = null;
    return Promise.resolve(result);
  }
  return api.index(name);
}

/** Link de uma coleta que falhou, devolvido ao campo para ser corrigido. */
export function draft() {
  return draftLink;
}

/** Esquece a coleta (concluída ou com erro) e volta ao formulário. */
export function clearCollection() {
  if (isRunning(current)) return;
  draftLink = current?.error ? current.link : "";
  set(null);
}
