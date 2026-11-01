interface ProgressBarProps {
  /** 0 a 100. */
  value: number;
  label?: string;
  /** xs: linha fina (métricas) · sm/md: listas · lg: cartões de curso. */
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

export default function ProgressBar({ value, label, size = "md", className = "" }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  // Qualquer progresso acima de zero continua visível como um ponto (como no Figma, em 1%).
  const width = clamped > 0 ? `max(${size === "lg" ? 16 : 6}px, ${clamped}%)` : "0%";
  return (
    <div
      className={`progress progress-${size} ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
    >
      <span style={{ width }} />
    </div>
  );
}
