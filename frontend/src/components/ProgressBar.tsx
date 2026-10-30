export default function ProgressBar({ value, label, size = "md" }: { value: number; label?: string; size?: "sm" | "md" }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={`progress progress-${size}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
    >
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}
