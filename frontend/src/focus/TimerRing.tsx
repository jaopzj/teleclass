import { ReactNode } from "react";
import { Tone } from "./derive";

/**
 * Anel de progresso da etapa. Escala pelo CSS (`--ring-size`); a espessura é
 * proporcional. `fraction` null: sem fim definido (cronômetro), o anel fica
 * cheio e estático, sem animação contínua.
 */
export default function TimerRing({
  fraction,
  tone = "focus",
  stroke = 4,
  children,
  label,
  className = "",
}: {
  fraction: number | null;
  tone?: Tone;
  stroke?: number;
  children?: ReactNode;
  label?: string;
  className?: string;
}) {
  const r = 50 - stroke / 2;
  const c = 2 * Math.PI * r;
  const value = fraction ?? 1;
  return (
    <div className={`fx-ring tone-${tone} ${fraction == null ? "is-open" : ""} ${className}`} role={label ? "img" : undefined} aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="fx-ring-track" cx="50" cy="50" r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="fx-ring-value"
          cx="50"
          cy="50"
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value)}
          transform="rotate(-90 50 50)"
          strokeLinecap="round"
        />
      </svg>
      {children && <div className="fx-ring-center">{children}</div>}
    </div>
  );
}
