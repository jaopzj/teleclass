import { FormEvent, useEffect, useRef, useState } from "react";
import Icon from "../../components/Icon";
import Field from "../fields/Field";
import PhoneInput from "../fields/PhoneInput";
import SubmitButton from "../fields/SubmitButton";
import { Country, nationalProblem, toE164 } from "../phone";
import { LinkError } from "./useTelegramLink";

interface Props {
  busy: boolean;
  error: LinkError | null;
  onSubmit: (phone: string) => void;
  /** O número continua preenchido se a pessoa voltar a esta etapa. */
  draft: { country: Country; national: string };
  onDraft: (draft: { country: Country; national: string }) => void;
}

export default function PhoneStep({ busy, error, onSubmit, draft, onDraft }: Props) {
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const problem = nationalProblem(draft.national, draft.country);
  const phoneError = error?.field === "phone" ? error.message : null;
  const generalError = error && error.field !== "phone" ? error : null;

  useEffect(() => input.current?.focus(), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (problem) return input.current?.focus();
    onSubmit(toE164(draft.national, draft.country));
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="step-intro">
        <span className="step-icon">
          <Icon name="phone" size={20} />
        </span>
        <div>
          <h2>Vincule sua conta do Telegram</h2>
          <p className="muted">
            Os cursos tocam direto dos canais em que você está, pela sua própria conta. Informe o número usado no Telegram.
          </p>
        </div>
      </div>

      <Field
        id="tg-phone"
        label="Telefone"
        hint="Com DDD. Você também pode colar o número no formato +55 11 91234-5678."
        error={(touched && problem) || phoneError}
      >
        <PhoneInput
          ref={input}
          id="tg-phone"
          country={draft.country}
          national={draft.national}
          onChange={(country, national) => onDraft({ country, national })}
          disabled={busy}
          invalid={Boolean((touched && problem) || error?.field === "phone")}
        />
      </Field>

      {generalError && <FormAlert error={generalError} />}

      <SubmitButton loading={busy} loadingLabel="Pedindo o código ao Telegram...">
        Enviar código
        <Icon name="arrow" size={16} />
      </SubmitButton>

      <p className="auth-footnote">
        <Icon name="shield" size={14} />
        O TeleClass só lê os canais de que você já participa. Nunca envia mensagens nem altera nada na sua conta.
      </p>
    </form>
  );
}

export function FormAlert({ error }: { error: LinkError | { message: string } }) {
  return (
    <div className="form-alert" role="alert">
      <Icon name="alert" size={16} />
      <span>{error.message}</span>
    </div>
  );
}
