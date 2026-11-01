import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import Icon from "../components/Icon";
import { AuthenticatedSession, authApi } from "./api";
import Field from "./fields/Field";
import PasswordInput from "./fields/PasswordInput";
import SubmitButton from "./fields/SubmitButton";
import { FormAlert } from "./telegram/PhoneStep";

interface Props {
  onLogin: (session: AuthenticatedSession) => void;
  onSignup: () => void;
}

export default function LoginForm({ onLogin, onSignup }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const user = useRef<HTMLInputElement>(null);
  const pass = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = window.setTimeout(() => setRetryIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [retryIn]);

  const usernameError = touched && !username.trim() ? "Informe seu nome de usuário." : null;
  const passwordError = touched && !password ? "Informe sua senha." : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || retryIn > 0) return;
    setTouched(true);
    if (!username.trim()) return user.current?.focus();
    if (!password) return pass.current?.focus();
    setBusy(true);
    setError(null);
    try {
      onLogin(await authApi.login(username.trim(), password));
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      if (err.retryAfter) setRetryIn(err.retryAfter);
      if (err.code === "invalid_credentials") {
        setPassword("");
        pass.current?.focus();
      }
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <Field id="login-username" label="Nome de usuário" error={usernameError}>
        <div className="input-group">
          <span className="input-icon" aria-hidden="true">
            <Icon name="user" size={16} />
          </span>
          <input
            ref={user}
            id="login-username"
            className="input has-icon"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setError(null);
            }}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            disabled={busy}
            aria-invalid={Boolean(usernameError) || undefined}
            aria-describedby="login-username-message"
          />
        </div>
      </Field>
      <Field id="login-password" label="Senha" error={passwordError}>
        <PasswordInput
          ref={pass}
          id="login-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          autoComplete="current-password"
          disabled={busy}
          aria-invalid={Boolean(passwordError) || undefined}
          aria-describedby="login-password-message"
        />
      </Field>

      <div className="form-alert-slot">{error && <FormAlert error={{ message: retryIn > 0 ? `${error} (${retryIn}s)` : error }} />}</div>

      <SubmitButton loading={busy} loadingLabel="Entrando..." disabled={retryIn > 0}>
        Entrar
      </SubmitButton>
      <p className="auth-switch">
        Ainda não tem conta?{" "}
        <button type="button" className="link-button" onClick={onSignup}>
          Criar conta
        </button>
      </p>
    </form>
  );
}
