import { FormEvent, useEffect, useRef, useState } from "react";
import Icon from "../../components/Icon";
import { LinkFlow } from "../api";
import Field from "../fields/Field";
import PasswordInput from "../fields/PasswordInput";
import SubmitButton from "../fields/SubmitButton";
import { FormAlert } from "./PhoneStep";
import { Busy, LinkError } from "./useTelegramLink";

interface Props {
  flow: LinkFlow;
  busy: Busy;
  error: LinkError | null;
  rejection: number;
  onSubmit: (password: string) => void;
  onChangePhone: () => void;
}

export default function PasswordStep({ flow, busy, error, rejection, onSubmit, onChangePhone }: Props) {
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (rejection) {
      setPassword("");
      input.current?.focus();
    }
  }, [rejection]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password) onSubmit(password);
  }

  const fieldError = error?.field === "password" ? error.message : null;
  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="step-intro">
        <span className="step-icon">
          <Icon name="shield" size={20} />
        </span>
        <div>
          <h2>Verificação em duas etapas</h2>
          <p className="muted">
            Sua conta do Telegram tem uma senha adicional. Digite-a para concluir. Ela vai direto ao Telegram e não fica salva.
          </p>
        </div>
      </div>

      <Field
        id="tg-password"
        label="Senha do Telegram"
        error={fieldError}
        hint={flow.password_hint ? `Dica: ${flow.password_hint}` : "É a senha que você criou em Privacidade e Segurança no Telegram."}
      >
        <PasswordInput
          ref={input}
          id="tg-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy !== null}
          autoComplete="off"
          aria-describedby="tg-password-message"
          aria-invalid={Boolean(fieldError) || undefined}
        />
      </Field>

      {error && !fieldError && <FormAlert error={error} />}

      <SubmitButton loading={busy === "password"} loadingLabel="Verificando..." disabled={!password}>
        Concluir vínculo
      </SubmitButton>
      <div className="resend-row">
        <button type="button" className="link-button" onClick={onChangePhone} disabled={busy !== null}>
          Usar outro número
        </button>
      </div>
    </form>
  );
}
