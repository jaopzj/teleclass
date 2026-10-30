// Sessão da plataforma (quem está logado) e situação da conta do Telegram.
// A autenticação no Teleaula e a do Telegram são coisas separadas: aqui só
// guardamos o que o backend informa sobre cada uma.
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AUTH_EVENT } from "../api";
import { AuthenticatedSession, authApi, TelegramStatus, User } from "./api";

type AuthState =
  | { status: "loading" }
  | { status: "offline"; message: string }
  | { status: "anonymous" }
  | { status: "authenticated"; user: User; telegram: TelegramStatus };

interface AuthContextValue {
  state: AuthState;
  /** Relê a sessão no backend (ex.: depois de vincular o Telegram). */
  refresh: () => Promise<void>;
  /** Usa a sessão devolvida por login/cadastro, sem um pedido extra. */
  setSession: (session: AuthenticatedSession) => void;
  setTelegram: (telegram: TelegramStatus) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const session = await authApi.session();
      setState(
        session.user && session.telegram
          ? { status: "authenticated", user: session.user, telegram: session.telegram }
          : { status: "anonymous" },
      );
    } catch (e) {
      setState({ status: "offline", message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    refresh();
    // Qualquer pedido que descubra sessão encerrada (ou Telegram revogado) avisa por aqui.
    const onChange = () => refresh();
    window.addEventListener(AUTH_EVENT, onChange);
    return () => window.removeEventListener(AUTH_EVENT, onChange);
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      refresh,
      setSession: (session) => setState({ status: "authenticated", user: session.user, telegram: session.telegram }),
      setTelegram: (telegram) =>
        setState((current) => (current.status === "authenticated" ? { ...current, telegram } : current)),
      logout: async () => {
        try {
          await authApi.logout();
        } finally {
          setState({ status: "anonymous" });
        }
      },
    }),
    [state, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth fora do AuthProvider");
  return value;
}
