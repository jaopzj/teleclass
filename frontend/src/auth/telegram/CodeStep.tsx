import { FormEvent, useCallback, useEffect, useState } from "react";
import Icon from "../../components/Icon";
import { LinkFlow } from "../api";
import CodeInput from "../fields/CodeInput";
import Field from "../fields/Field";
import SubmitButton from "../fields/SubmitButton";
import { describeDelivery, NEXT_METHOD_LABEL } from "./delivery";
import { FormAlert } from "./PhoneStep";
import { Busy, LinkError } from "./useTelegramLink";

interface Props {
  flow: LinkFlow;
  busy: Busy;
  error: LinkError | null;
  notice: string | null;
  rejection: number;
  onSubmit: (code: string) => void;
  onResend: () => void;
  onChangePhone: () => void;
  onUseQr: () => void;
}

function useCountdown(seconds: number, key: unknown) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    if (seconds <= 0) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const value = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000));
      setLeft(value);
      if (value === 0) window.clearInterval(timer);
    }, 500);
    return () => window.clearInterval(timer);
  }, [seconds, key]);
  return left;
}

export default function CodeStep({ flow, busy, error, notice, rejection, onSubmit, onResend, onChangePhone, onUseQr }: Props) {
  const { delivery } = flow;
  const info = describeDelivery(delivery, flow.phone ?? "");
  const boxes = (delivery.input === "digits" || delivery.input === "phone_tail") && delivery.length ? delivery.length : null;
  const [code, setCode] = useState("");
  const wait = useCountdown(flow.resend_in, flow);
  const working = busy !== null;

  // Código recusado: limpa as caixas para digitar de novo.
  useEffect(() => {
    if (rejection) setCode("");
  }, [rejection]);

  const complete = useCallback((value: string) => onSubmit(value), [onSubmit]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (code.trim()) onSubmit(code.trim());
  }

  const fieldError = error && (error.field === "code" || error.code === "code_invalid") ? error.message : null;
  const otherError = error && !fieldError ? error : null;
  const resendLabel = flow.code_expired
    ? "Pedir novo código"
    : flow.next_method
      ? `Reenviar ${NEXT_METHOD_LABEL[flow.next_method] ?? ""}`.trim()
      : "Reenviar código";

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="step-intro">
        <span className="step-icon">
          <Icon name={info.icon} size={20} />
        </span>
        <div>
          <h2>{info.title}</h2>
          <p className="muted">{info.body}</p>
        </div>
      </div>

      <div className="phone-chip">
        <span>{flow.phone ?? ""}</span>
        <button type="button" className="link-button" onClick={onChangePhone} disabled={working}>
          Trocar número
        </button>
      </div>

      <Field
        id="tg-code"
        label={info.label}
        error={fieldError}
        hint={flow.code_expired ? "Este código expirou. Peça um novo abaixo." : boxes ? "Ao completar, verificamos automaticamente." : undefined}
      >
        {boxes ? (
          <CodeInput
            id="tg-code"
            label={info.label}
            length={boxes}
            value={code}
            onChange={setCode}
            onComplete={complete}
            disabled={working || flow.code_expired}
            invalid={Boolean(fieldError)}
            autoFocus
          />
        ) : (
          <input
            id="tg-code"
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={working || flow.code_expired}
            autoFocus
            autoComplete="one-time-code"
            inputMode={delivery.input === "text" ? "text" : "numeric"}
            aria-describedby="tg-code-message"
            aria-invalid={Boolean(fieldError) || undefined}
          />
        )}
      </Field>

      {otherError && <FormAlert error={otherError} />}
      {notice && (
        <div className="form-notice" role="status">
          <Icon name="check" size={16} />
          {notice}
        </div>
      )}

      <SubmitButton loading={busy === "code"} loadingLabel="Verificando com o Telegram..." disabled={working || !code || flow.code_expired}>
        Confirmar código
      </SubmitButton>

      <div className="resend-row">
        {flow.can_resend ? (
          wait > 0 && !flow.code_expired ? (
            <span className="muted">Não recebeu? Você poderá pedir de novo em {wait}s.</span>
          ) : (
            <button type="button" className="link-button" onClick={onResend} disabled={working}>
              {busy === "resend" ? <span className="mini-spinner" /> : <Icon name="rotate" size={14} />}
              {resendLabel}
            </button>
          )
        ) : (
          <span className="muted">Não recebeu? Confira o número ou troque-o acima.</span>
        )}
      </div>
      <div className="resend-row">
        <span className="muted">O código não chega?</span>
        <button type="button" className="link-button" onClick={onUseQr} disabled={working}>
          {busy === "qr" ? <span className="mini-spinner" /> : null}
          Entrar com QR code
        </button>
      </div>
    </form>
  );
}
