import { useMemo, useState } from "react";
import Icon from "../components/Icon";
import { notify } from "../notifications/center";
import { Catalog, focusApi, Method, MethodInput, Plan, Preset, StartInput, Technique, TimelineStep } from "./api";
import ConfirmDialog from "./ConfirmDialog";
import { duration } from "./derive";
import MethodEditor, { PlanFields, previewTimeline, validateMethod } from "./MethodEditor";
import { FocusActionError, startSession, useFocus } from "./store";
import Stepper from "./Stepper";
import TargetPicker, { TargetValue } from "./TargetPicker";
import Timeline, { planSummary } from "./Timeline";

type Choice = { kind: "preset"; technique: Technique } | { kind: "method"; id: string };

const LAST = "teleaula:focus:last-choice";
const DEFAULT: Choice = { kind: "preset", technique: "pomodoro" };

function readLast(): Choice {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST) ?? "null");
    if (saved?.kind === "preset" || saved?.kind === "method") return saved;
  } catch {
    /* sem escolha anterior */
  }
  return DEFAULT;
}

type PlanValue = Omit<MethodInput, "name">;

/**
 * Preparação da sessão, em duas colunas: à esquerda a técnica (padrões e
 * métodos próprios); à direita a configuração, a prévia da sequência, o
 * objetivo, o vínculo com os estudos e a única ação principal.
 */
export default function Composer({
  catalog,
  methods,
  onMethodsChange,
  initialTarget,
}: {
  catalog: Catalog;
  methods: Method[];
  onMethodsChange: (methods: Method[]) => void;
  initialTarget?: TargetValue;
}) {
  const { busy } = useFocus();
  const [choice, setChoice] = useState<Choice>(() => {
    const last = readLast();
    return last.kind === "method" && !methods.some((m) => m.id === last.id) ? DEFAULT : last;
  });
  const [deepMinutes, setDeepMinutes] = useState(90);
  const [cycles, setCycles] = useState<Record<string, number>>({});
  const custom0 = catalog.presets.find((p) => p.technique === "custom")?.plan;
  const [custom, setCustom] = useState<PlanValue>({
    focus_minutes: (custom0?.focus_seconds ?? 2400) / 60,
    short_break_minutes: (custom0?.short_break_seconds ?? 600) / 60,
    long_break_minutes: (custom0?.long_break_seconds ?? 0) / 60,
    long_break_every: custom0?.long_break_every ?? null,
    cycles: custom0?.cycles ?? 3,
  });
  const [intention, setIntention] = useState("");
  const [target, setTarget] = useState<TargetValue>(initialTarget ?? { courseId: null, lessonKey: null });
  const [editing, setEditing] = useState<Method | "new" | null>(null);
  const [removing, setRemoving] = useState<Method | null>(null);
  const [error, setError] = useState<string | null>(null);

  const limits = { focus: catalog.limits.focus_minutes, brk: catalog.limits.break_minutes, cycles: catalog.limits.cycles };
  const preset = choice.kind === "preset" ? catalog.presets.find((p) => p.technique === choice.technique) : undefined;
  const method = choice.kind === "method" ? methods.find((m) => m.id === choice.id) : undefined;
  const customErrors = validateMethod(custom, limits);
  const customInvalid = preset?.technique === "custom" && Object.keys(customErrors).length > 0;
  const maxCycles = limits.cycles[1];

  // Plano efetivo da escolha atual: alimenta a prévia e o resumo.
  const plan: Plan | null = useMemo(() => {
    if (method) return method.plan;
    if (!preset) return null;
    if (preset.technique === "custom") {
      if (customInvalid) return null;
      return {
        technique: "custom",
        focus_seconds: custom.focus_minutes * 60,
        short_break_seconds: custom.short_break_minutes * 60,
        long_break_seconds: custom.long_break_every ? custom.long_break_minutes * 60 : 0,
        long_break_every: custom.long_break_every,
        cycles: custom.cycles,
      };
    }
    const p = { ...preset.plan };
    if (preset.technique === "deep_work") p.focus_seconds = deepMinutes * 60;
    if (preset.technique !== "stopwatch") p.cycles = cycles[preset.technique] ?? p.cycles;
    return p;
  }, [method, preset, deepMinutes, cycles, custom, customInvalid]);
  const steps = useMemo(() => (method ? method.timeline : plan ? buildTimeline(plan) : []), [method, plan]);

  function select(next: Choice) {
    setChoice(next);
    setError(null);
    try {
      localStorage.setItem(LAST, JSON.stringify(next));
    } catch {
      /* modo privado */
    }
  }

  async function start() {
    setError(null);
    if (customInvalid) {
      setError("Revise os tempos destacados antes de começar.");
      return;
    }
    const input: StartInput = {
      technique: method ? "custom" : (preset?.technique ?? "pomodoro"),
      method_id: method?.id ?? null,
      intention: intention.trim() || null,
      course_id: target.courseId,
      lesson_key: target.lessonKey,
    };
    if (preset?.technique === "deep_work") input.focus_minutes = deepMinutes;
    if (preset && preset.technique !== "stopwatch" && preset.technique !== "custom" && cycles[preset.technique]) input.cycles = cycles[preset.technique];
    if (preset?.technique === "custom") input.custom = { ...custom, long_break_minutes: custom.long_break_every ? custom.long_break_minutes : 0 };
    try {
      await startSession(input);
    } catch (e) {
      setError((e as FocusActionError).message);
    }
  }

  async function saveMethod(input: MethodInput) {
    if (editing && editing !== "new") {
      const updated = await focusApi.updateMethod(editing.id, input);
      onMethodsChange(methods.map((m) => (m.id === updated.id ? updated : m)));
      notify({ title: "Método atualizado", body: updated.name, tone: "success" });
    } else {
      const created = await focusApi.createMethod(input);
      onMethodsChange([...methods, created]);
      select({ kind: "method", id: created.id });
      notify({ title: "Método criado", body: `${created.name} está pronto para usar.`, tone: "success" });
    }
    setEditing(null);
  }

  async function remove(m: Method) {
    try {
      await focusApi.deleteMethod(m.id);
      onMethodsChange(methods.filter((x) => x.id !== m.id));
      if (choice.kind === "method" && choice.id === m.id) select(DEFAULT);
      setRemoving(null);
    } catch (e) {
      notify({ title: "Não foi possível excluir", body: (e as Error).message, essential: true });
    }
  }

  const title = method ? method.name : (preset?.name ?? "");
  const description = method ? "Método criado por você." : preset?.description;
  const technique = preset?.technique;
  const currentCycles = preset && technique ? (cycles[technique] ?? preset.plan.cycles) : 0;

  return (
    <div className="fx-timer-grid">
      <section className="surface fx-card fx-methods" aria-labelledby="fx-methods-title">
        <h2 id="fx-methods-title" className="fx-card-title">
          Técnicas
        </h2>
        <div className="fx-method-list" role="radiogroup" aria-labelledby="fx-methods-title">
          {catalog.presets.map((p) => (
            <MethodRow
              key={p.technique}
              name={p.name}
              detail={p.technique === "custom" ? "Você define os tempos" : planSummary(p.plan)}
              selected={choice.kind === "preset" && choice.technique === p.technique}
              onSelect={() => select({ kind: "preset", technique: p.technique })}
            />
          ))}
        </div>

        <div className="fx-methods-sub">
          <h3 id="fx-own-title">Meus métodos</h3>
          <button type="button" className="button button-ghost button-sm" onClick={() => setEditing("new")}>
            <Icon name="plus" size={16} /> Novo
          </button>
        </div>
        {methods.length === 0 ? (
          <p className="fx-methods-empty">Salve seus próprios tempos, como “Revisão: 40 min de foco e 10 de pausa”, para usar com um clique.</p>
        ) : (
          <div className="fx-method-list" role="radiogroup" aria-labelledby="fx-own-title">
            {methods.map((m) => (
              <MethodRow
                key={m.id}
                name={m.name}
                detail={planSummary(m.plan)}
                selected={choice.kind === "method" && choice.id === m.id}
                onSelect={() => select({ kind: "method", id: m.id })}
                onEdit={() => setEditing(m)}
                onRemove={() => setRemoving(m)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="surface fx-card fx-config" aria-labelledby="fx-config-title">
        <header className="fx-config-head" key={title}>
          <h2 id="fx-config-title" className="fx-card-title">
            {title}
          </h2>
          {description && <p className="muted">{description}</p>}
        </header>

        {technique === "deep_work" && preset && (
          <div className="fx-field">
            <span className="fx-label" id="fx-deep-label">
              Duração do bloco
            </span>
            <div className="fx-seg" role="radiogroup" aria-labelledby="fx-deep-label">
              {preset.focus_options.map((min) => (
                <button key={min} type="button" role="radio" aria-checked={deepMinutes === min} onClick={() => setDeepMinutes(min)}>
                  {min} min
                </button>
              ))}
            </div>
          </div>
        )}
        {preset && technique && technique !== "stopwatch" && technique !== "custom" && (
          <div className="fx-field fx-field-row">
            <span className="fx-label" id="fx-cycles-label">
              Ciclos
            </span>
            <Stepper
              value={currentCycles}
              min={1}
              max={maxCycles}
              labelledBy="fx-cycles-label"
              onChange={(v) => Number.isFinite(v) && setCycles({ ...cycles, [technique]: Math.min(maxCycles, Math.max(1, v)) })}
            />
          </div>
        )}
        {technique === "custom" && (
          <div className="fx-custom">
            <PlanFields value={custom} onChange={setCustom} errors={customErrors} limits={limits} idPrefix="custom" />
            <button type="button" className="button button-ghost button-sm fx-save-method" onClick={() => setEditing("new")} disabled={customInvalid}>
              <Icon name="plus" size={16} /> Salvar como método
            </button>
          </div>
        )}
        {method && (
          <div className="fx-field fx-field-row">
            <span className="fx-label">Tempos do método</span>
            <button type="button" className="button button-ghost button-sm" onClick={() => setEditing(method)}>
              <Icon name="edit" size={16} /> Editar
            </button>
          </div>
        )}

        {plan && <SessionPreview plan={plan} steps={steps} stopwatchLimit={catalog.limits.stopwatch_limit_seconds} />}

        <div className="fx-field">
          <label className="fx-label" htmlFor="fx-intention">
            Objetivo da sessão <span className="fx-optional">opcional</span>
          </label>
          <input
            id="fx-intention"
            className="input fx-input"
            maxLength={140}
            placeholder="Ex.: concluir os exercícios de orientação a objetos"
            value={intention}
            onChange={(e) => setIntention(e.target.value)}
          />
        </div>
        <div className="fx-field">
          <span className="fx-label" id="fx-target-label">
            Vincular aos estudos <span className="fx-optional">opcional</span>
          </span>
          <TargetPicker value={target} onChange={setTarget} labelledBy="fx-target-label" />
        </div>

        <footer className="fx-config-foot">
          {error && (
            <p className="fx-error" role="alert">
              <Icon name="warningCircle" size={16} /> {error}
            </p>
          )}
          <button type="button" className="button button-primary button-lg fx-start" onClick={start} disabled={busy === "start"} aria-busy={busy === "start"}>
            <Icon name="play" size={16} />
            {busy === "start" ? "Iniciando..." : "Começar sessão"}
          </button>
        </footer>
      </section>

      {editing && (
        <MethodEditor
          method={editing === "new" ? null : editing}
          limits={limits}
          onSave={saveMethod}
          onClose={() => setEditing(null)}
          initial={editing === "new" && technique === "custom" && !customInvalid ? custom : undefined}
        />
      )}
      {removing && (
        <ConfirmDialog title={`Excluir “${removing.name}”?`} confirmLabel="Excluir método" danger onCancel={() => setRemoving(null)} onConfirm={() => remove(removing)}>
          <p>O método deixa de aparecer aqui. As sessões que você já fez com ele continuam no histórico.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function MethodRow({
  name,
  detail,
  selected,
  onSelect,
  onEdit,
  onRemove,
}: {
  name: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className={`fx-method ${selected ? "is-selected" : ""}`}>
      <button type="button" role="radio" aria-checked={selected} className="fx-method-main" onClick={onSelect}>
        <span className="fx-radio" aria-hidden="true" />
        <span className="fx-method-text">
          <strong>{name}</strong>
          <span>{detail}</span>
        </span>
      </button>
      {onEdit && onRemove && (
        <span className="fx-method-tools">
          <button type="button" className="icon-button icon-button-sm" onClick={onEdit} aria-label={`Editar ${name}`}>
            <Icon name="edit" size={16} />
          </button>
          <button type="button" className="icon-button icon-button-sm" onClick={onRemove} aria-label={`Excluir ${name}`}>
            <Icon name="trash" size={16} />
          </button>
        </span>
      )}
    </div>
  );
}

/** Prévia antes de começar: sequência das etapas em proporção e os números do plano. */
function SessionPreview({ plan, steps, stopwatchLimit }: { plan: Plan; steps: TimelineStep[]; stopwatchLimit: number }) {
  if (plan.focus_seconds == null) {
    return (
      <div className="fx-preview">
        <p className="fx-preview-note">
          <Icon name="clock" size={16} /> Conta para cima até você encerrar, com limite de {duration(stopwatchLimit)}.
        </p>
      </div>
    );
  }
  const total = steps.reduce((a, s) => a + (s.seconds ?? 0), 0);
  const longBreak = plan.long_break_every && plan.long_break_seconds > 0;
  return (
    <div className="fx-preview">
      <Timeline steps={steps} legend />
      <dl className="fx-facts">
        <div>
          <dt>Concentração</dt>
          <dd>{duration(plan.focus_seconds)}</dd>
        </div>
        <div>
          <dt>Pausa</dt>
          <dd>{plan.short_break_seconds ? duration(plan.short_break_seconds) : "Sem pausa"}</dd>
        </div>
        {longBreak ? (
          <div>
            <dt>Pausa longa</dt>
            <dd>
              {duration(plan.long_break_seconds)}
              <span> a cada {plan.long_break_every}</span>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Ciclos</dt>
          <dd>{plan.cycles}</dd>
        </div>
        <div>
          <dt>Duração total</dt>
          <dd>{duration(total)}</dd>
        </div>
      </dl>
    </div>
  );
}

function buildTimeline(plan: Preset["plan"]): TimelineStep[] {
  if (plan.focus_seconds == null) return [{ stage: "focus", cycle: 1, seconds: null }];
  return previewTimeline({
    focus_minutes: plan.focus_seconds / 60,
    short_break_minutes: plan.short_break_seconds / 60,
    long_break_minutes: plan.long_break_seconds / 60,
    long_break_every: plan.long_break_every,
    cycles: plan.cycles,
  });
}
