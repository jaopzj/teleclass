import { useMemo, useState } from "react";
import Icon from "../components/Icon";
import { notify } from "../notifications/center";
import { Catalog, focusApi, Method, MethodInput, Preset, StartInput, Technique, TimelineStep } from "./api";
import ConfirmDialog from "./ConfirmDialog";
import { duration, TECHNIQUE_TONE } from "./derive";
import MethodEditor, { PlanFields, PlanPreview, previewTimeline, validateMethod } from "./MethodEditor";
import { FocusActionError, startSession, useFocus } from "./store";
import TargetPicker, { TargetValue } from "./TargetPicker";
import Timeline, { planSummary } from "./Timeline";

type Choice = { kind: "preset"; technique: Technique } | { kind: "method"; id: string };

const LAST = "teleaula:focus:last-choice";

function readLast(): Choice {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST) ?? "null");
    if (saved?.kind === "preset" || saved?.kind === "method") return saved;
  } catch {
    /* sem escolha anterior */
  }
  return { kind: "preset", technique: "pomodoro" };
}

/** Montagem da sessão: técnica, variações, vínculo com curso ou aula e objetivo. */
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
    return last.kind === "method" && !methods.some((m) => m.id === last.id) ? { kind: "preset", technique: "pomodoro" } : last;
  });
  const [deepMinutes, setDeepMinutes] = useState(90);
  const [cycles, setCycles] = useState<Record<string, number>>({});
  const custom0 = catalog.presets.find((p) => p.technique === "custom")?.plan;
  const [custom, setCustom] = useState<Omit<MethodInput, "name">>({
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

  const limits = {
    focus: catalog.limits.focus_minutes,
    brk: catalog.limits.break_minutes,
    cycles: catalog.limits.cycles,
  };
  const preset = choice.kind === "preset" ? catalog.presets.find((p) => p.technique === choice.technique) : undefined;
  const method = choice.kind === "method" ? methods.find((m) => m.id === choice.id) : undefined;
  const customErrors = validateMethod(custom, limits);

  const summary = useMemo(() => {
    if (method) return { timeline: method.timeline, text: planSummary(method.plan) };
    if (!preset) return null;
    if (preset.technique === "custom") return null;
    const plan = { ...preset.plan };
    if (preset.technique === "deep_work") plan.focus_seconds = deepMinutes * 60;
    if (preset.technique !== "stopwatch") plan.cycles = cycles[preset.technique] ?? plan.cycles;
    return { timeline: buildTimeline(plan), text: planSummary(plan) };
  }, [method, preset, deepMinutes, cycles]);

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
    const input: StartInput = {
      technique: method ? "custom" : (preset?.technique ?? "pomodoro"),
      method_id: method?.id ?? null,
      intention: intention.trim() || null,
      course_id: target.courseId,
      lesson_key: target.lessonKey,
    };
    if (preset?.technique === "deep_work") input.focus_minutes = deepMinutes;
    if (preset && preset.technique !== "stopwatch" && preset.technique !== "custom" && cycles[preset.technique]) input.cycles = cycles[preset.technique];
    if (preset?.technique === "custom") {
      if (Object.keys(customErrors).length) {
        setError("Revise os campos do plano personalizado.");
        return;
      }
      input.custom = { ...custom, long_break_minutes: custom.long_break_every ? custom.long_break_minutes : 0 };
    }
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
      if (choice.kind === "method" && choice.id === m.id) select({ kind: "preset", technique: "pomodoro" });
      setRemoving(null);
    } catch (e) {
      notify({ title: "Não foi possível excluir", body: (e as Error).message, essential: true });
    }
  }

  return (
    <div className="composer">
      <div className="composer-list" role="radiogroup" aria-label="Técnica de estudo">
        <p className="composer-heading">Técnicas</p>
        {catalog.presets.map((p) => (
          <TechniqueRow
            key={p.technique}
            preset={p}
            selected={choice.kind === "preset" && choice.technique === p.technique}
            onSelect={() => select({ kind: "preset", technique: p.technique })}
          />
        ))}
        <div className="composer-heading composer-heading-row">
          <p>Meus métodos</p>
          <button type="button" className="link-button" onClick={() => setEditing("new")}>
            <Icon name="plus" size={14} /> Novo
          </button>
        </div>
        {methods.length === 0 && (
          <button type="button" className="method-empty" onClick={() => setEditing("new")}>
            Crie um método com seus próprios tempos, como “Revisão de programação: 40 min de foco e 10 de pausa”.
          </button>
        )}
        {methods.map((m) => (
          <div key={m.id} className={`technique ${choice.kind === "method" && choice.id === m.id ? "is-selected" : ""} tone-violet`}>
            <button type="button" role="radio" aria-checked={choice.kind === "method" && choice.id === m.id} className="technique-main" onClick={() => select({ kind: "method", id: m.id })}>
              <span className="technique-swatch" aria-hidden="true" />
              <span className="technique-text">
                <strong>{m.name}</strong>
                <span>{planSummary(m.plan)}</span>
              </span>
            </button>
            <span className="technique-tools">
              <button type="button" className="ftimer-icon" onClick={() => setEditing(m)} aria-label={`Editar ${m.name}`}>
                <Icon name="edit" size={14} />
              </button>
              <button type="button" className="ftimer-icon" onClick={() => setRemoving(m)} aria-label={`Excluir ${m.name}`}>
                <Icon name="trash" size={14} />
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="composer-detail">
        <div className="composer-plan">
          <p className="composer-kicker">{method ? "Método próprio" : preset?.name}</p>
          <h2 className="composer-title">{method ? method.name : preset?.description}</h2>

          {preset?.technique === "deep_work" && (
            <div className="chips" role="radiogroup" aria-label="Duração do bloco">
              {preset.focus_options.map((min) => (
                <button key={min} type="button" role="radio" aria-checked={deepMinutes === min} className={`chip ${deepMinutes === min ? "is-on" : ""}`} onClick={() => setDeepMinutes(min)}>
                  {min} min
                </button>
              ))}
            </div>
          )}
          {preset && preset.technique !== "stopwatch" && preset.technique !== "custom" && (
            <div className="cycle-picker">
              <span>Ciclos</span>
              <div className="stepper">
                <button type="button" aria-label="Menos um ciclo" onClick={() => setCycles({ ...cycles, [preset.technique]: Math.max(1, (cycles[preset.technique] ?? preset.plan.cycles) - 1) })}>
                  −
                </button>
                <output aria-live="polite">{cycles[preset.technique] ?? preset.plan.cycles}</output>
                <button type="button" aria-label="Mais um ciclo" onClick={() => setCycles({ ...cycles, [preset.technique]: Math.min(12, (cycles[preset.technique] ?? preset.plan.cycles) + 1) })}>
                  +
                </button>
              </div>
            </div>
          )}
          {preset?.technique === "custom" && (
            <>
              <PlanFields value={custom} onChange={setCustom} errors={customErrors} limits={limits} idPrefix="custom" />
              <PlanPreview value={custom} />
              <button type="button" className="link-button" onClick={() => setEditing("new")} disabled={Object.keys(customErrors).length > 0}>
                <Icon name="plus" size={14} /> Salvar como método
              </button>
            </>
          )}
          {summary && (
            <div className="plan-preview">
              <Timeline steps={summary.timeline} />
              <p className="muted small">
                {summary.text}
                {summary.timeline[0]?.seconds != null && ` · ${duration(summary.timeline.reduce((a, s) => a + (s.seconds ?? 0), 0))} no total`}
              </p>
            </div>
          )}
          {preset?.technique === "stopwatch" && (
            <p className="muted small">Conta até você encerrar, com limite de {duration(catalog.limits.stopwatch_limit_seconds)} por sessão.</p>
          )}
        </div>

        <div className="composer-context">
          <label className="field-label" htmlFor="focus-intention">
            Objetivo da sessão <span className="muted">(opcional)</span>
          </label>
          <input
            id="focus-intention"
            className="text-input"
            maxLength={140}
            placeholder="Ex.: terminar o módulo de orientação a objetos"
            value={intention}
            onChange={(e) => setIntention(e.target.value)}
          />
          <span className="field-label">Estudar o quê</span>
          <TargetPicker value={target} onChange={setTarget} />
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        <button type="button" className="start-button" onClick={start} disabled={busy === "start"}>
          <Icon name="play" size={16} />
          {busy === "start" ? "Iniciando..." : "Começar a sessão"}
        </button>
      </div>

      {editing && (
        <MethodEditor
          method={editing === "new" ? null : editing}
          limits={limits}
          onSave={saveMethod}
          onClose={() => setEditing(null)}
          initial={editing === "new" && preset?.technique === "custom" && !Object.keys(customErrors).length ? custom : undefined}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Excluir “${removing.name}”?`}
          confirmLabel="Excluir método"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove(removing)}
        >
          <p>O método deixa de aparecer aqui. As sessões que você já fez com ele continuam no histórico.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function TechniqueRow({ preset, selected, onSelect }: { preset: Preset; selected: boolean; onSelect: () => void }) {
  return (
    <div className={`technique tone-${TECHNIQUE_TONE[preset.technique]} ${selected ? "is-selected" : ""}`}>
      <button type="button" role="radio" aria-checked={selected} className="technique-main" onClick={onSelect}>
        <span className="technique-swatch" aria-hidden="true" />
        <span className="technique-text">
          <strong>{preset.name}</strong>
          <span>{preset.technique === "custom" ? "Você define os tempos" : planSummary(preset.plan)}</span>
        </span>
      </button>
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
