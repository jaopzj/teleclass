import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../api";
import Icon from "../components/Icon";
import { Method, MethodInput, TimelineStep } from "./api";
import Stepper from "./Stepper";
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

type Limits = { focus: [number, number]; brk: [number, number]; cycles: [number, number] };
type PlanValue = Omit<MethodInput, "name">;

/** Mesma regra do servidor (app/focus/plans.py), só para pré-visualizar. */
export function previewTimeline(m: PlanValue): TimelineStep[] {
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

/** Validação local com os limites do servidor; a mensagem fica junto do campo. */
export function validateMethod(m: PlanValue, limits: Limits) {
  const errors: Partial<Record<keyof MethodInput, string>> = {};
  const range = (v: number, [a, b]: [number, number], unit: string) => (!Number.isInteger(v) || v < a || v > b ? `Use de ${a} a ${b}${unit}` : undefined);
  const f = range(m.focus_minutes, limits.focus, " min");
  if (f) errors.focus_minutes = f;
  const s = range(m.short_break_minutes, limits.brk, " min");
  if (s) errors.short_break_minutes = s;
  if (m.long_break_every != null) {
    const l = range(m.long_break_minutes, [Math.max(1, limits.brk[0]), limits.brk[1]], " min");
    if (l) errors.long_break_minutes = l;
    const e = range(m.long_break_every, [1, limits.cycles[1]], "");
    if (e) errors.long_break_every = e;
  }
  const c = range(m.cycles, limits.cycles, "");
  if (c) errors.cycles = c;
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

function MinutesField({
  id,
  label,
  value,
  onChange,
  error,
  min,
  max,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  error?: string;
  min: number;
  max: number;
}) {
  return (
    <div className="fx-field">
      <label className="fx-label" htmlFor={id}>
        {label}
      </label>
      <div className={`fx-unit ${error ? "is-invalid" : ""}`}>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={Number.isFinite(value) ? String(value) : ""}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Math.round(Number(e.target.value)))}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <span>min</span>
      </div>
      {error && (
        <small className="fx-field-error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}

/** Campos de um plano (editor de método e técnica "Personalizado"). */
export function PlanFields({
  value,
  onChange,
  errors,
  limits,
  idPrefix,
}: {
  value: PlanValue;
  onChange: (next: PlanValue) => void;
  errors: Partial<Record<keyof MethodInput, string>>;
  limits: Limits;
  idPrefix: string;
}) {
  const longOn = value.long_break_every != null;
  return (
    <div className="fx-plan-fields">
      <MinutesField
        id={`${idPrefix}-focus`}
        label="Concentração"
        value={value.focus_minutes}
        onChange={(v) => onChange({ ...value, focus_minutes: v })}
        error={errors.focus_minutes}
        min={limits.focus[0]}
        max={limits.focus[1]}
      />
      <MinutesField
        id={`${idPrefix}-short`}
        label="Pausa curta"
        value={value.short_break_minutes}
        onChange={(v) => onChange({ ...value, short_break_minutes: v })}
        error={errors.short_break_minutes}
        min={limits.brk[0]}
        max={limits.brk[1]}
      />
      <div className="fx-field">
        <span className="fx-label" id={`${idPrefix}-cycles-label`}>
          Ciclos
        </span>
        <Stepper
          id={`${idPrefix}-cycles`}
          value={value.cycles}
          min={limits.cycles[0]}
          max={limits.cycles[1]}
          labelledBy={`${idPrefix}-cycles-label`}
          invalid={!!errors.cycles}
          onChange={(v) => onChange({ ...value, cycles: v })}
        />
        {errors.cycles && <small className="fx-field-error">{errors.cycles}</small>}
      </div>

      <div className="fx-field fx-field-wide">
        <label className="fx-switch-row">
          <span>
            <span className="fx-label">Pausa longa</span>
            <span className="fx-hint">Um descanso maior depois de alguns ciclos</span>
          </span>
          <span className="fx-switch">
            <input
              type="checkbox"
              role="switch"
              checked={longOn}
              onChange={(e) =>
                onChange({
                  ...value,
                  long_break_every: e.target.checked ? Math.min(4, Math.max(2, value.cycles || 2)) : null,
                  long_break_minutes: e.target.checked ? value.long_break_minutes || 15 : 0,
                })
              }
            />
            <span aria-hidden="true" />
          </span>
        </label>
      </div>
      {longOn && (
        <>
          <MinutesField
            id={`${idPrefix}-long`}
            label="Duração da pausa longa"
            value={value.long_break_minutes}
            onChange={(v) => onChange({ ...value, long_break_minutes: v })}
            error={errors.long_break_minutes}
            min={1}
            max={limits.brk[1]}
          />
          <div className="fx-field">
            <span className="fx-label" id={`${idPrefix}-every-label`}>
              A cada quantos ciclos
            </span>
            <Stepper
              value={value.long_break_every ?? 1}
              min={1}
              max={limits.cycles[1]}
              labelledBy={`${idPrefix}-every-label`}
              invalid={!!errors.long_break_every}
              onChange={(v) => onChange({ ...value, long_break_every: v })}
            />
            {errors.long_break_every && <small className="fx-field-error">{errors.long_break_every}</small>}
          </div>
        </>
      )}
    </div>
  );
}

function PlanPreview({ value }: { value: PlanValue }) {
  const steps = useMemo(() => previewTimeline(value), [value]);
  if (!steps.length || !steps.every((s) => Number.isFinite(s.seconds))) return null;
  const focus = steps.filter((s) => s.stage === "focus").reduce((a, s) => a + (s.seconds ?? 0), 0);
  const total = steps.reduce((a, s) => a + (s.seconds ?? 0), 0);
  return (
    <div className="fx-preview">
      <Timeline steps={steps} legend />
      <p className="fx-preview-note">
        {duration(focus)} de concentração · {duration(total)} no total
      </p>
    </div>
  );
}

/** Criar ou editar um método próprio (guardado na conta). */
export default function MethodEditor({
  method,
  limits,
  onSave,
  onClose,
  initial,
}: {
  method: Method | null;
  initial?: PlanValue;
  limits: Limits;
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
  const nameError = value.name.trim().length < 2 ? "Dê um nome com pelo menos 2 letras" : value.name.trim().length > 40 ? "Use até 40 caracteres" : undefined;
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

  const shownNameError = (touched && nameError) || (serverError?.field === "name" ? serverError.message : undefined);
  return createPortal(
    <div className="dialog-backdrop focus-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="dialog fx-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="fx-method-title" noValidate>
        <div className="fx-dialog-head">
          <h2 id="fx-method-title">{method ? "Editar método" : "Novo método"}</h2>
          <button type="button" className="icon-button icon-button-sm" onClick={onClose} aria-label="Fechar" disabled={busy}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="fx-field">
          <label className="fx-label" htmlFor="fx-method-name">
            Nome
          </label>
          <input
            ref={name}
            id="fx-method-name"
            className="input fx-input"
            placeholder="Ex.: Revisão de programação"
            value={value.name}
            maxLength={40}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            aria-invalid={!!shownNameError}
          />
          {shownNameError && <small className="fx-field-error">{shownNameError}</small>}
        </div>
        <PlanFields value={value} onChange={(v) => setValue({ ...value, ...v })} errors={errors} limits={limits} idPrefix="method" />
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
    </div>,
    document.body,
  );
}
