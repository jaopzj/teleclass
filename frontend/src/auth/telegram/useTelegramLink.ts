// Máquina de estados do vínculo com o Telegram. Cada etapa (telefone, código,
// senha 2FA, concluído) tem um status: ocioso/preenchendo, enviando ou erro. O
// backend é a fonte da verdade: cada resposta diz qual é a próxima etapa.
import { useCallback, useReducer, useRef } from "react";
import { ApiError } from "../../api";
import { LinkFlow, LinkResult, TelegramAccount, telegramApi } from "../api";

export type LinkStep = "phone" | "code" | "qr" | "password" | "done";
export type Busy = null | "phone" | "qr" | "code" | "password" | "resend" | "cancel";

export interface LinkError {
  message: string;
  code?: string;
  field?: string;
  retryAfter?: number;
}

export interface LinkState {
  step: LinkStep;
  flow: LinkFlow | null;
  account: TelegramAccount | null;
  busy: Busy;
  error: LinkError | null;
  /** Aviso não bloqueante, ex.: "Código reenviado por SMS". */
  notice: string | null;
  /** Incrementa a cada erro de código/senha (para animar e limpar o campo). */
  rejection: number;
  /** A etapa de senha apareceu: o indicador de etapas passa a incluí-la. */
  needsPassword: boolean;
}

type Action =
  | { type: "busy"; busy: Busy }
  | { type: "result"; result: LinkResult; notice?: string | null }
  | { type: "error"; error: LinkError; step?: LinkStep; resetFlow?: boolean; reject?: boolean }
  | { type: "restart"; error?: LinkError | null };

function reducer(state: LinkState, action: Action): LinkState {
  switch (action.type) {
    case "busy":
      return { ...state, busy: action.busy, error: action.busy ? null : state.error, notice: action.busy ? null : state.notice };
    case "result": {
      const { result } = action;
      if (result.step === "done") {
        return { ...state, step: "done", account: result.account, flow: null, busy: null, error: null, notice: null };
      }
      return {
        ...state,
        step: result.step,
        flow: result,
        busy: null,
        error: null,
        notice: action.notice ?? null,
        needsPassword: state.needsPassword || result.step === "password",
      };
    }
    case "error":
      return {
        ...state,
        busy: null,
        error: action.error,
        notice: null,
        step: action.step ?? state.step,
        flow: action.resetFlow
          ? null
          : state.flow && action.error.code === "code_expired"
            ? { ...state.flow, code_expired: true, can_resend: true, resend_in: 0 }
            : state.flow,
        rejection: action.reject ? state.rejection + 1 : state.rejection,
        needsPassword: action.resetFlow ? false : state.needsPassword,
      };
    case "restart":
      return { ...state, step: "phone", flow: null, busy: null, error: action.error ?? null, notice: null, needsPassword: false };
  }
}

// Erros que encerram o fluxo no backend: volta ao telefone (que continua preenchido).
const RESTART_CODES = new Set(["link_expired", "too_many_attempts", "telegram_in_use", "phone_not_registered", "resend_limit", "send_code_unavailable"]);

function toError(e: unknown): LinkError {
  if (e instanceof ApiError) {
    if (e.status === 0) return { message: e.message, code: "network_error" };
    return { message: e.message, code: e.code, field: e.field, retryAfter: e.retryAfter };
  }
  return { message: "Algo deu errado. Tente de novo.", code: "unknown" };
}

const DELIVERY_NOTICE: Record<string, string> = {
  app: "Enviamos um novo código pelo app do Telegram.",
  sms: "Enviamos um novo código por SMS.",
  call: "Você vai receber uma ligação com o código.",
  flash_call: "Você vai receber uma ligação rápida.",
  missed_call: "Você vai receber uma chamada perdida.",
  email: "Enviamos um novo código por e-mail.",
};

export function useTelegramLink(initialFlow: LinkFlow | null) {
  const [state, dispatch] = useReducer(reducer, {
    step: initialFlow ? initialFlow.step : "phone",
    flow: initialFlow,
    account: null,
    busy: null,
    error: null,
    notice: null,
    rejection: 0,
    needsPassword: initialFlow?.step === "password",
  });
  // Trava síncrona contra cliques/teclas repetidos antes do React re-renderizar.
  const inFlight = useRef(false);

  const run = useCallback(async (busy: Exclude<Busy, null>, call: () => Promise<LinkResult>, notice?: (r: LinkResult) => string | null) => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: "busy", busy });
    try {
      const result = await call();
      dispatch({ type: "result", result, notice: notice?.(result) });
    } catch (e) {
      const error = toError(e);
      if (error.code && RESTART_CODES.has(error.code)) dispatch({ type: "restart", error });
      else dispatch({ type: "error", error, reject: error.code === "code_invalid" || error.code === "password_invalid" || error.code === "code_format" });
    } finally {
      inFlight.current = false;
    }
  }, []);

  const pollQr = useCallback(async () => {
    if (inFlight.current) return;
    try {
      dispatch({ type: "result", result: await telegramApi.qrState() });
    } catch (e) {
      const error = toError(e);
      if (error.code !== "network_error") dispatch({ type: "restart", error });
    }
  }, []);

  return {
    state,
    sendPhone: (phone: string) => run("phone", () => telegramApi.sendPhone(phone)),
    resend: () =>
      run("resend", telegramApi.resend, (r) => (r.step === "code" ? DELIVERY_NOTICE[r.delivery.method] ?? "Código reenviado." : null)),
    sendCode: (code: string) => run("code", () => telegramApi.sendCode(code)),
    /** QR code em vez do código (que às vezes não chega quando o servidor está na nuvem). */
    startQr: () => run("qr", telegramApi.startQr),
    /** Consulta o QR: imagem renovada, etapa da senha 2FA ou vínculo concluído. */
    pollQr,
    sendPassword: (password: string) => run("password", () => telegramApi.sendPassword(password)),
    /** Trocar o número: descarta o fluxo no backend e volta à etapa do telefone. */
    changePhone: async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      dispatch({ type: "busy", busy: "cancel" });
      try {
        await telegramApi.cancel();
      } catch {
        // mesmo sem resposta, recomeçar pelo telefone é seguro: o backend substitui o fluxo
      } finally {
        inFlight.current = false;
        dispatch({ type: "restart" });
      }
    },
  };
}
