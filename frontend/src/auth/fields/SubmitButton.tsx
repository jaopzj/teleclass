import { ButtonHTMLAttributes, ReactNode } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}

/** Botão com estado de carregamento. Desabilitado enquanto carrega (sem envio duplo). */
export default function SubmitButton({ loading, loadingLabel, children, variant = "primary", disabled, className, ...props }: Props) {
  return (
    <button
      type="submit"
      {...props}
      className={`button button-lg ${variant === "primary" ? "button-primary" : ""} button-block auth-submit ${loading ? "is-loading" : ""} ${className ?? ""}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      <span className="auth-submit-label">{loading ? loadingLabel ?? children : children}</span>
      {loading && <span className="mini-spinner on-accent" aria-hidden="true" />}
    </button>
  );
}
