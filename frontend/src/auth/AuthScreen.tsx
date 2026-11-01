// Login, cadastro e vínculo do Telegram numa única tela, sem recarregar.
//
// - visitante: abas "Entrar" e "Criar conta" (a URL acompanha: /entrar, /cadastro);
// - cadastro: conta (usuário e senha) -> telefone -> código -> [senha 2FA] -> pronto;
// - logado sem Telegram (cadastro interrompido ou sessão revogada): continua do telefone.
import { useCallback, useState } from "react";
import Icon from "../components/Icon";
import { navigate } from "../router";
import AccountForm from "./AccountForm";
import AuthShell from "./AuthShell";
import { useAuth } from "./AuthProvider";
import Stepper, { StepItem } from "./fields/Stepper";
import LoginForm from "./LoginForm";
import TelegramLink from "./telegram/TelegramLink";
import { LinkStep } from "./telegram/useTelegramLink";

export type AuthMode = "login" | "signup";

export const AUTH_PATHS: Record<AuthMode, string> = { login: "/entrar", signup: "/cadastro" };

function steps(needsPassword: boolean): StepItem[] {
  return [
    { key: "account", label: "Conta" },
    { key: "phone", label: "Telefone" },
    { key: "code", label: "Código" },
    ...(needsPassword ? [{ key: "password", label: "Senha 2FA" }] : []),
    { key: "done", label: "Pronto" },
  ];
}

export default function AuthScreen({ mode }: { mode: AuthMode }) {
  const auth = useAuth();
  const { state } = auth;
  const [linkStep, setLinkStep] = useState<{ step: LinkStep; needsPassword: boolean }>({ step: "phone", needsPassword: false });
  const onStepChange = useCallback((step: LinkStep, needsPassword: boolean) => setLinkStep({ step, needsPassword }), []);

  const switchMode = (next: AuthMode) => navigate(AUTH_PATHS[next], { replace: true });

  if (state.status === "authenticated") {
    const { user, telegram } = state;
    const list = steps(linkStep.needsPassword);
    const current = list.findIndex((s) => s.key === linkStep.step);
    const reauth = telegram.needs_reauth;
    return (
      <AuthShell
        footer={
          <span>
            Conectado como <strong>{user.username}</strong> ·{" "}
            <button type="button" className="link-button" onClick={auth.logout}>
              Sair
            </button>
          </span>
        }
      >
        <header className="auth-head">
          <p className="eyebrow">{reauth ? "Reconexão" : "Cadastro"}</p>
          <h1>{reauth ? "Reconecte seu Telegram" : linkStep.step === "done" ? "Conta criada" : `Falta pouco, ${user.username}`}</h1>
          <p className="muted">
            {linkStep.step === "done"
              ? "Conta do TeleClass e Telegram conectados."
              : reauth
                ? "A sessão do Telegram foi encerrada (por exemplo, pelo app do Telegram). Vincule de novo para voltar a assistir."
                : "Sua conta no TeleClass está criada. Agora vincule o Telegram para acessar os cursos."}
          </p>
        </header>
        {!reauth && <Stepper steps={list} current={current} />}
        {!telegram.configured ? (
          <div className="form-alert" role="alert">
            <Icon name="alert" size={16} />
            <span>
              O servidor ainda não está configurado para o Telegram. Quem administra o TeleClass precisa definir TG_API_ID e
              TG_API_HASH no arquivo .env e reiniciar o servidor.
            </span>
          </div>
        ) : (
          <TelegramLink
            initialFlow={telegram.flow}
            onStepChange={onStepChange}
            onDone={async () => {
              await auth.refresh();
              if (location.pathname === AUTH_PATHS.login || location.pathname === AUTH_PATHS.signup) navigate("/", { replace: true });
            }}
          />
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      footer={<span className="muted">Seus dados ficam no servidor do TeleClass, neste computador.</span>}
    >
      <header className="auth-head">
        <h1>{mode === "login" ? "Bem-vindo de volta" : "Crie sua conta"}</h1>
        <p className="muted">
          {mode === "login" ? "Entre para continuar seus cursos." : "Leva um minuto: conta, telefone do Telegram e pronto."}
        </p>
      </header>
      <div className={`segmented is-${mode}`} role="tablist" aria-label="Entrar ou criar conta">
        <span className="segmented-thumb" aria-hidden="true" />
        <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => switchMode("login")}>
          Entrar
        </button>
        <button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => switchMode("signup")}>
          Criar conta
        </button>
      </div>
      {mode === "signup" && <Stepper steps={steps(false)} current={0} />}
      <div className="auth-step" key={mode}>
        {mode === "login" ? (
          <LoginForm
            onLogin={(session) => {
              auth.setSession(session);
              if (location.pathname === AUTH_PATHS.login || location.pathname === AUTH_PATHS.signup) navigate("/", { replace: true });
            }}
            onSignup={() => switchMode("signup")}
          />
        ) : (
          <AccountForm onCreated={auth.setSession} />
        )}
      </div>
    </AuthShell>
  );
}
