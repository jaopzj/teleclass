import { ReactNode } from "react";

/** Anel de progresso da etapa. `fraction` null: sem duração (cronômetro), anel contínuo animado. */
export default function TimerRing({
  fraction,
  size = 280,
  stroke = 6,
  tone = "focus",
  children,
  label,
}: {
  fraction: number | null;
  size?: number;
  stroke?: number;
  tone?: "focus" | "rest" | "ready" | "paused";
  children?: ReactNode;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = fraction ?? 0;
  return (
    <div
      className={`ring ring-${tone} ${fraction == null ? "is-open" : ""}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={fraction == null ? c * 0.78 : c * (1 - value)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeLinecap="round"
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}
