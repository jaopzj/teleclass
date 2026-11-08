// Contrato de /api/auth e /api/telegram (docs/autenticacao.md).
import { request } from "../api";

export interface User {
  id: string;
  username: string;
  created_at: string;
}

/** Como o Telegram entregou o código. `input` diz o que a pessoa digita. */
export interface CodeDelivery {
  method: "app" | "sms" | "sms_word" | "sms_phrase" | "call" | "flash_call" | "missed_call" | "email" | "fragment" | "unknown";
  input: "digits" | "text" | "phone" | "phone_tail";
  length: number | null;
  beginning?: string;
  prefix?: string;
  email?: string;
  url?: string;
}

export interface LinkFlow {
  step: "code" | "password" | "qr";
  /** "qr": vínculo por QR code, aprovado no celular (sem telefone nem código). */
  method?: "phone" | "qr";
  phone: string | null;
  /** Conteúdo do QR (tg://login?token=...), renovado pelo backend quando expira. */
  qr_url?: string | null;
  qr_expires_in?: number;
  delivery: CodeDelivery;
  next_method: string | null;
  can_resend: boolean;
  resend_in: number;
  code_expired: boolean;
  attempts_left: number;
  password_hint: string | null;
  expires_in: number;
}

export interface TelegramAccount {
  name: string;
  username: string | null;
  phone: string;
  linked_at: string;
}

export interface TelegramStatus {
  configured: boolean;
  linked: boolean;
  needs_reauth: boolean;
  account: TelegramAccount | null;
  flow: LinkFlow | null;
  fast_crypto?: boolean;
}

export interface Session {
  user: User | null;
  telegram: TelegramStatus | null;
  /** Só vem sem login: criar conta exige código de convite (TELEAULA_INVITE_CODE). */
  invite_required?: boolean;
}

export interface AuthenticatedSession {
  user: User;
  telegram: TelegramStatus;
}

export type LinkResult = LinkFlow | { step: "done"; account: TelegramAccount };

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

export const authApi = {
  session: () => request<Session>("/api/auth/session"),
  availability: (username: string) =>
    request<{ username: string; available: boolean; reason: string | null }>(
      `/api/auth/username-availability?username=${encodeURIComponent(username)}`,
    ),
  register: (username: string, password: string, invite = "") =>
    request<AuthenticatedSession>("/api/auth/register", json({ username, password, invite })),
  login: (username: string, password: string) =>
    request<AuthenticatedSession>("/api/auth/login", json({ username, password })),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
};

export const telegramApi = {
  status: () => request<TelegramStatus>("/api/telegram/status"),
  sendPhone: (phone: string) => request<LinkResult>("/api/telegram/link/phone", json({ phone })),
  resend: () => request<LinkResult>("/api/telegram/link/resend", { method: "POST" }),
  startQr: () => request<LinkResult>("/api/telegram/link/qr", { method: "POST" }),
  qrState: () => request<LinkResult>("/api/telegram/link/qr"),
  sendCode: (code: string) => request<LinkResult>("/api/telegram/link/code", json({ code })),
  sendPassword: (password: string) => request<LinkResult>("/api/telegram/link/password", json({ password })),
  cancel: () => request<void>("/api/telegram/link", { method: "DELETE" }),
  unlink: (password: string) => request<TelegramStatus>("/api/telegram/unlink", json({ password })),
};
