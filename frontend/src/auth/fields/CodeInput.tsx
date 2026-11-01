import { useEffect, useRef } from "react";

interface Props {
  id: string;
  length: number;
  value: string;
  onChange: (value: string) => void;
  /** Chamado uma vez quando todos os dígitos foram preenchidos. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  label: string;
}

/**
 * Código em caixas separadas. Por baixo é um único <input>, o que mantém colar,
 * apagar, autopreenchimento de "código de uso único" e leitores de tela funcionando.
 */
export default function CodeInput({ id, length, value, onChange, onComplete, disabled, invalid, autoFocus, label }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const completed = useRef<string | null>(null);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (value.length === length && completed.current !== value) {
      completed.current = value;
      onComplete?.(value);
    }
    if (value.length < length) completed.current = null;
  }, [value, length, onComplete]);

  useEffect(() => {
    // Erro: limpa para a pessoa digitar de novo, com o foco já no campo.
    if (invalid && !disabled) input.current?.focus();
  }, [invalid, disabled]);

  return (
    <div className={`code-input ${invalid ? "is-invalid" : ""} ${disabled ? "is-disabled" : ""}`} onClick={() => input.current?.focus()}>
      <input
        ref={input}
        id={id}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-message`}
        className="code-input-native"
        value={value}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
      />
      {Array.from({ length }, (_, i) => {
        const active = !disabled && (i === value.length || (i === length - 1 && value.length === length));
        return (
          <span key={i} className={`code-box ${value[i] ? "is-filled" : ""} ${active ? "is-active" : ""}`} aria-hidden="true">
            {value[i] ?? ""}
          </span>
        );
      })}
    </div>
  );
}
