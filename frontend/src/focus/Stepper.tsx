import Icon from "../components/Icon";

/** Número com botões de menos e mais (ciclos, intervalos). */
export default function Stepper({
  value,
  min,
  max,
  onChange,
  labelledBy,
  id,
  invalid,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  labelledBy?: string;
  id?: string;
  invalid?: boolean;
}) {
  const safe = Number.isFinite(value) ? value : min;
  return (
    <div className={`fx-stepper ${invalid ? "is-invalid" : ""}`} role="group" aria-labelledby={labelledBy}>
      <button type="button" aria-label="Diminuir" onClick={() => onChange(Math.max(min, safe - 1))} disabled={safe <= min}>
        <Icon name="minimize" size={16} />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? String(value) : ""}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Math.round(Number(e.target.value)))}
        aria-labelledby={labelledBy}
        aria-invalid={invalid}
      />
      <button type="button" aria-label="Aumentar" onClick={() => onChange(Math.min(max, safe + 1))} disabled={safe >= max}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

