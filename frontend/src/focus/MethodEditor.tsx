import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api";
import Icon from "../components/Icon";
import { Method, MethodInput, TimelineStep } from "./api";
import { duration } from "./derive";
import Timeline from "./Timeline";

export const EMPTY_METHOD: MethodInput = {
  name: "",
  focus_minutes: 40,
  short_break_minutes: 10,
  long_break_minutes: 0,
  long_break_every: null,
  cycles: 3,
};

/** Mesma regra do servidor (app/focus/plans.py), só para pré-visualizar. */
export function previewTimeline(m: Omit<MethodInput, "name">): TimelineStep[] {
  const steps: TimelineStep[] = [];
  for (let c = 1; c <= m.cycles; c++) {
    steps.push({ stage: "focus", cycle: c, seconds: m.focus_minutes * 60 });
    const isLong = !!m.long_break_every && c % m.long_break_every === 0 && m.long_break_minutes > 0;
    if (c >= m.cycles) {
      if (isLong) steps.push({ stage: "long_break", cycle: c, seconds: m.long_break_minutes * 60 });
    } else if (isLong) steps.push({ stage: "long_break", cycle: c, seconds: m.long_break_minutes * 60 });
    else if (m.short_break_minutes > 0) steps.push({ stage: "short_break", cycle: c, seconds: m.short_break_minutes * 60 });
  }
  return steps;
}

export function validateMethod(m: Omit<MethodInput, "name">, limits: { focus: [number, number]; brk: [number, number]; cycles: [number, number] }) {
  const errors: Partial<Record<keyof MethodInput, string>> = {};
  if (!Number.isInteger(m.focus_minutes) || m.focus_minutes < limits.focus[0] || m.focus_minutes > limits.focus[1])
    errors.focus_minutes = `De ${limits.focus[0]} a ${limits.focus[1]} min`;
  if (!Number.isInteger(m.short_break_minutes) || m.short_break_minutes < limits.brk[0] || m.short_break_minutes > limits.brk[1])
    errors.short_break_minutes = `De ${limits.brk[0]} a ${limits.brk[1]} min`;
  if (!Number.isInteger(m.long_break_minutes) || m.long_break_minutes < limits.brk[0] || m.long_break_minutes > limits.brk[1])
    errors.long_break_minutes = `De ${limits.brk[0]} a ${limits.brk[1]} min`;
  if (!Number.isInteger(m.cycles) || m.cycles < limits.cycles[0] || m.cycles > limits.cycles[1])
    errors.cycles = `De ${limits.cycles[0]} a ${limits.cycles[1]}`;
  return errors;
}

export function toInput(m: Method): MethodInput {
  return {
    name: m.name,
    focus_minutes: m.focus_minutes,
    short_break_minutes: m.short_break_minutes,
    long_break_minutes: m.long_break_minutes,
    long_break_every: m.long_break_every,
    cycles: m.cycles,
  };
}

export function totalOf(steps: TimelineStep[]) {
  return steps.reduce((a, s) => a + (s.seconds ?? 0), 0);
}

/** Campos de um plano (usado pelo editor de método e pelo "Personalizado"). */
export function PlanFields({
  value,
  onChange,
  errors,
  limits,
  idPrefix,
}: {
  value: Omit<MethodInput, "name">;
  onChange: (next: Omit<MethodInput, "name">) => void;
  errors: Partial<Record<keyof MethodInput, string>>;
  limits: { focus: [number, number]; brk: [number, number]; cycles: [number, number] };
  idPrefix: string;
}) {
  const longOn = value.long_break_every != null;
  const num = (key: keyof Omit<MethodInput, "name" | "long_break_every">) => ({
    id: `${idPrefix}-${key}`,
    type: "number" as const,
    inputMode: "numeric" as const,
    value: Number.isFinite(value[key]) ? String(value[key]) : "",
    onChange: (e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value === "" ? NaN : Math.round(Number(e.target.value)) }),
    "aria-invalid": !!errors[key],
  });
  return (
    <div className="plan-fields">
      <div className="plan-field">
        <label htmlFor={`${idPrefix}-focus_minutes`}>Concentração</label>
        <div className="unit-input">
          <input {...num("focus_minutes")} min={limits.focus[0]} max={limits.focus[1]} />
          <span>min</span>
        </div>
        {errors.focus_minutes && <small className="field-error">{errors.focus_minutes}</small>}
      </div>
      <div className="plan-field">
        <label htmlFor={`${idPrefix}-short_break_minutes`}>Pausa</label>
        <div className="unit-input">
          <input {...num("short_break_minutes")} min={limits.brk[0]} max={limits.brk[1]} />
          <span>min</span>
        </div>
        {errors.short_break_minutes && <small className="field-error">{errors.short_break_minutes}</small>}
      </div>
      <div className="plan-field">
        <label htmlFor={`${idPrefix}-cycles`}>Ciclos</label>
        <div className="stepper">
          <button type="button" onClick={() => onChange({ ...value, cycles: Math.max(limits.cycles[0], (value.cycles || 1) - 1) })} aria-label="Menos um ciclo">
            −
          </button>
          <input {...num("cycles")} min={limits.cycles[0]} max={limits.cycles[1]} />
          <button type="button" onClick={() => onChange({ ...value, cycles: Math.min(limits.cycles[1], (value.cycles || 0) + 1) })} aria-label="Mais um ciclo">
            +
          </button>
        </div>
        {errors.cycles && <small className="field-error">{errors.cycles}</small>}
      </div>
      <div className="plan-field plan-field-wide">
        <label className="check">
          <input
            type="checkbox"
            checked={longOn}
            onChange={(e) =>
              onChange({
                ...value,
                long_break_every: e.target.checked ? Math.min(4, Math.max(2, value.cycles || 2)) : null,
                long_break_minutes: e.target.checked ? value.long_break_minutes || 15 : 0,
              })
            }
          />
          <span>Pausa longa</span>
        </label>
        {longOn && (
          <div className="plan-inline">
            <div className="unit-input">
              <input {...num("long_break_minutes")} min={1} max={limits.brk[1]} aria-label="Duração da pausa longa" />
              <span>min</span>
            </div>
            <span className="muted">a cada</span>
            <div className="unit-input">
              <input
                id={`${idPrefix}-long_break_every`}
                type="number"
                inputMode="numeric"
                min={1}
                max={limits.cycles[1]}
                value={value.long_break_every ?? ""}
                onChange={(e) => onChange({ ...value, long_break_every: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                aria-label="A cada quantos ciclos"
              />
              <span>ciclos</span>
            </div>
          </div>
        )}
        {errors.long_break_minutes && <small className="field-error">{errors.long_break_minutes}</small>}
      </div>
    </div>
  );
}

export function PlanPreview({ value }: { value: Omit<MethodInput, "name"> }) {
  const steps = useMemo(() => previewTimeline(value), [value]);
  const valid = steps.every((s) => Number.isFinite(s.seconds));
  if (!valid || !steps.length) return null;
  const focus = steps.filter((s) => s.stage === "focus").reduce((a, s) => a + (s.seconds ?? 0), 0);
  return (
    <div className="plan-preview">
      <Timeline steps={steps} />
      <p className="muted small">
        {duration(focus)} de foco · {duration(totalOf(steps))} no total
      </p>
    </div>
  );
}

/** Criar ou editar um método. */
export default function MethodEditor({
  method,
  limits,
  onSave,
  onClose,
  initial,
}: {
  method: Method | null;
  initial?: Omit<MethodInput, "name">;
  limits: { focus: [number, number]; brk: [number, number]; cycles: [number, number] };
  onSave: (input: MethodInput) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState<MethodInput>(method ? toInput(method) : { ...EMPTY_METHOD, ...initial });
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const name = useRef<HTMLInputElement>(null);
  useEffect(() => name.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const errors = validateMethod(value, limits);
  const nameError = value.name.trim().length < 2 ? "Dê um nome com pelo menos 2 letras" : value.name.trim().length > 40 ? "Até 40 caracteres" : undefined;
  const invalid = Object.keys(errors).length > 0 || !!nameError;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true);
    setServerError(null);
    try {
      await onSave({ ...value, name: value.name.trim(), long_break_minutes: value.long_break_every ? value.long_break_minutes : 0 });
    } catch (err) {
      const e = err as ApiError;
      setServerError({ field: e.field, message: e.message });
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="dialog method-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="method-title" noValidate>
        <div className="method-dialog-head">
          <h2 id="method-title">{method ? "Editar método" : "Novo método de estudo"}</h2>
          <button type="button" className="ftimer-icon" onClick={onClose} aria-label="Fechar">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="plan-field plan-field-wide">
          <label htmlFor="method-name">Nome</label>
          <input
            ref={name}
            id="method-name"
            className="text-input"
            placeholder="Ex.: Revisão de programação"
            value={value.name}
            maxLength={40}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            aria-invalid={touched && !!(nameError || serverError?.field === "name")}
          />
          {touched && nameError && <small className="field-error">{nameError}</small>}
          {serverError?.field === "name" && <small className="field-error">{serverError.message}</small>}
        </div>
        <PlanFields value={value} onChange={(v) => setValue({ ...value, ...v })} errors={touched ? errors : {}} limits={limits} idPrefix="method" />
        <PlanPreview value={value} />
        {serverError && serverError.field !== "name" && <div className="alert alert-error">{serverError.message}</div>}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="button button-primary" disabled={busy || (touched && invalid)}>
            {busy ? "Salvando..." : method ? "Salvar alterações" : "Criar método"}
          </button>
        </div>
      </form>
    </div>
  );
}

