// Etapa 1 do cadastro: nome de usuário e senha. Cria a conta e já entra; a
// próxima etapa (Telegram) acontece logada, para o vínculo ficar preso a ela.
import { FormEvent, useRef, useState } from "react";
import { ApiError } from "../api";
import Icon from "../components/Icon";
import { AuthenticatedSession, authApi } from "./api";
import Field, { FieldStatus } from "./fields/Field";
import PasswordInput from "./fields/PasswordInput";
import PasswordStrength from "./fields/PasswordStrength";
import SubmitButton from "./fields/SubmitButton";
import { FormAlert } from "./telegram/PhoneStep";
import { useUsernameAvailability } from "./useUsernameAvailability";
import { normalizeUsername, PASSWORD_MAX, passwordProblem, USERNAME_MAX, usernameProblem } from "./validation";

interface Props {
  onCreated: (session: AuthenticatedSession) => void;
}

type Errors = Partial<Record<"username" | "password" | "confirm" | "form", string>>;

export default function AccountForm({ onCreated }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const refs = { username: useRef<HTMLInputElement>(null), password: useRef<HTMLInputElement>(null), confirm: useRef<HTMLInputElement>(null) };
  const availability = useUsernameAvailability(username);

  const localErrors: Errors = {
    username: usernameProblem(username) ?? undefined,
    password: passwordProblem(password, username) ?? undefined,
    confirm: !confirm ? "Repita a senha." : confirm !== password ? "As senhas não são iguais." : undefined,
  };
  const shown = (key: "username" | "password" | "confirm") =>
    serverErrors[key] ?? (touched[key] ? localErrors[key] : undefined) ?? undefined;

  const usernameError =
    shown("username") ?? (availability.state === "taken" ? availability.message : undefined);
  const usernameStatus: FieldStatus =
    availability.state === "checking" ? "validating" : availability.state === "available" && !serverErrors.username ? "valid" : "idle";

  function edit(key: "username" | "password" | "confirm", setter: (v: string) => void) {
    return (value: string) => {
      setter(value);
      if (serverErrors[key] || serverErrors.form) setServerErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setTouched({ username: true, password: true, confirm: true });
    const first = (["username", "password", "confirm"] as const).find((k) => localErrors[k]);
    if (first) return refs[first].current?.focus();
    if (availability.state === "taken") return refs.username.current?.focus();
    setBusy(true);
    setServerErrors({});
    try {
      onCreated(await authApi.register(normalizeUsername(username), password));
    } catch (e) {
      const error = e as ApiError;
      const field = error.field === "username" || error.field === "password" ? error.field : "form";
      setServerErrors({ [field]: error.message });
      if (field !== "form") refs[field].current?.focus();
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <Field
        id="signup-username"
        label="Nome de usuário"
        status={usernameStatus}
        error={usernameError}
        success="Disponível"
        hint="Letras, números, ponto e sublinhado. É com ele que você entra."
      >
        <div className="input-group">
          <span className="input-icon" aria-hidden="true">
            <Icon name="user" size={16} />
          </span>
          <input
            ref={refs.username}
            id="signup-username"
            className="input has-icon"
            value={username}
            maxLength={USERNAME_MAX + 8}
            onChange={(e) => edit("username", setUsername)(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, username: true }))}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            disabled={busy}
            aria-invalid={Boolean(usernameError) || undefined}
            aria-describedby="signup-username-message"
          />
        </div>
      </Field>

      <Field id="signup-password" label="Senha" error={shown("password")}>
        <PasswordInput
          ref={refs.password}
          id="signup-password"
          value={password}
          maxLength={PASSWORD_MAX}
          onChange={(e) => edit("password", setPassword)(e.target.value)}
          onBlur={() => password && setTouched((t) => ({ ...t, password: true }))}
          autoComplete="new-password"
          disabled={busy}
          aria-invalid={Boolean(shown("password")) || undefined}
          aria-describedby="signup-password-message signup-strength"
        />
      </Field>
      <div id="signup-strength" className="strength-slot">
        <PasswordStrength password={password} username={username} />
      </div>

      <Field
        id="signup-confirm"
        label="Confirme a senha"
        error={shown("confirm")}
        status={confirm && confirm === password ? "valid" : "idle"}
        success="As senhas conferem"
      >
        <PasswordInput
          ref={refs.confirm}
          id="signup-confirm"
          value={confirm}
          maxLength={PASSWORD_MAX}
          onChange={(e) => edit("confirm", setConfirm)(e.target.value)}
          onBlur={() => confirm && setTouched((t) => ({ ...t, confirm: true }))}
          autoComplete="new-password"
          disabled={busy}
          aria-invalid={Boolean(shown("confirm")) || undefined}
          aria-describedby="signup-confirm-message"
        />
      </Field>

      {serverErrors.form && <FormAlert error={{ message: serverErrors.form }} />}

      <SubmitButton loading={busy} loadingLabel="Criando sua conta...">
        Continuar
        <Icon name="arrow" size={16} />
      </SubmitButton>
    </form>
  );
}
