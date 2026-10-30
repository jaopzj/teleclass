import { ReactNode } from "react";
import Icon from "../../components/Icon";

export type FieldStatus = "idle" | "validating" | "valid" | "invalid";

interface FieldProps {
  id: string;
  label: string;
  /** Texto de ajuda; dá lugar ao erro ou ao sucesso quando existirem. */
  hint?: ReactNode;
  error?: string | null;
  success?: string | null;
  status?: FieldStatus;
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * Rótulo + controle + mensagem. A linha da mensagem tem altura reservada, então
 * um erro aparecendo ou sumindo não empurra o restante do formulário.
 */
export default function Field({ id, label, hint, error, success, status = "idle", aside, children }: FieldProps) {
  const state = error ? "invalid" : status;
  const message = error || (state === "valid" ? success : null) || hint;
  return (
    <div className={`field is-${state}`}>
      <div className="field-label-row">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      <div className="field-control">
        {children}
        <span className="field-status" aria-hidden="true">
          {state === "validating" && <span className="mini-spinner" />}
          {state === "valid" && <Icon name="check" size={16} />}
          {state === "invalid" && <Icon name="alert" size={16} />}
        </span>
      </div>
      <p id={`${id}-message`} className={`field-message${error ? " is-error" : state === "valid" && success ? " is-success" : ""}`} aria-live="polite">
        {message}
      </p>
    </div>
  );
}
