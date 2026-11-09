// Construtor de rotinas: dados, modalidade, dias e atividades, numa página
// (não num modal). A duração estimada é calculada das atividades.
import { FormEvent, useEffect, useId, useMemo, useState } from "react";
import Icon from "../components/Icon";
import { ApiError } from "../api";
import { notify } from "../notifications/center";
import { Link, navigate, paths } from "../router";
import { ContentLink, LinkInput, Mode, Period, Priority, Routine, routineApi, RoutineInput } from "./api";
import { toMinutes, toTime, WEEKDAY_LONG } from "./dates";
import { minutesLabel, MODE_HINT, MODE_LABEL, PERIODS, PRIORITY_LABEL } from "./domain";
import { ColorPicker, ContentLinkPicker, DurationField, IconPicker, WeekdayPicker } from "./pickers";
import { IconTile, RoutineIcon, tone } from "./parts";
import { bumpRoutine } from "./session";

interface ActivityDraft {
  key: string;
  id?: string;
  title: string;
  description: string;
  icon_key: string | null;
  color: string | null;
  duration_minutes: number | null;
  start_time: string | null;
  period: Period | null;
  priority: Priority;
  is_optional: boolean;
  notes: string;
  link: ContentLink | LinkInput | null;
}

let seq = 0;
const newKey = () => `n${++seq}`;

const blankActivity = (): ActivityDraft => ({
  key: newKey(),
  title: "",
  description: "",
  icon_key: null,
  color: null,
  duration_minutes: 30,
  start_time: null,
  period: null,
  priority: "normal",
  is_optional: false,
  notes: "",
  link: null,
});

interface Form {
  name: string;
  description: string;
  icon_key: string | null;
  color: string | null;
  mode: Mode;
  preferred_start_time: string | null;
  weekdays: number[];
  activities: ActivityDraft[];
}

const fromRoutine = (r: Routine): Form => ({
  name: r.name,
  description: r.description,
  icon_key: r.icon_key,
  color: r.color,
  mode: r.mode,
  preferred_start_time: r.preferred_start_time,
  weekdays: r.weekdays,
  activities: r.activities.map((a) => ({ ...a, key: a.id })),
});

const emptyForm = (): Form => ({
  name: "",
  description: "",
  icon_key: null,
  color: "sky",
  mode: "scheduled",
  preferred_start_time: null,
  weekdays: [],
  activities: [blankActivity()],
});

export default function RoutineEditor({ routineId }: { routineId?: string }) {
  const [form, setForm] = useState<Form | null>(routineId ? null : emptyForm());
  const [original, setOriginal] = useState<Routine | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const ids = useId();

  useEffect(() => {
    if (!routineId) return;
    routineApi
      .routine(routineId)
      .then((r) => {
        setOriginal(r);
        setForm(fromRoutine(r));
      })
      .catch((e) => setLoadError(e instanceof ApiError && e.status === 404 ? "Esta rotina não existe mais." : "Não foi possível abrir a rotina."));
  }, [routineId]);

  const total = useMemo(() => (form?.activities ?? []).reduce((sum, a) => sum + (a.duration_minutes ?? 0), 0), [form]);

  if (loadError) {
    return (
      <div className="empty">
        <h2>{loadError}</h2>
        <Link className="button" to={paths.routine("rotinas")}>
          Voltar para Minhas rotinas
        </Link>
      </div>
    );
  }
  if (!form) return <div className="surface skeleton rt-skel-editor" aria-busy="true" />;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => f && { ...f, [key]: value });
  const setAct = (key: string, patch: Partial<ActivityDraft>) =>
    setForm((f) => f && { ...f, activities: f.activities.map((a) => (a.key === key ? { ...a, ...patch } : a)) });
  const move = (index: number, delta: number) =>
    setForm((f) => {
      if (!f) return f;
      const list = [...f.activities];
      const j = index + delta;
      if (j < 0 || j >= list.length) return f;
      [list[index], list[j]] = [list[j], list[index]];
      return { ...f, activities: list };
    });
  const remove = (key: string) => setForm((f) => f && { ...f, activities: f.activities.filter((a) => a.key !== key) });
  const add = () => {
    const last = form.activities[form.activities.length - 1];
    const next = blankActivity();
    // Por horário: a nova começa quando a anterior termina.
    if (form.mode === "scheduled") {
      const start = toMinutes(last?.start_time) ?? toMinutes(form.preferred_start_time);
      if (start != null) next.start_time = toTime(start + (last?.duration_minutes ?? 0));
    }
    setForm({ ...form, activities: [...form.activities, next] });
    setOpen(next.key);
    window.setTimeout(() => document.getElementById(`rt-act-${next.key}`)?.focus(), 50);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError("Dê um nome à rotina.");
    const activities = form.activities.filter((a) => a.title.trim());
    setBusy(true);
    setError(null);
    const body: RoutineInput = {
      name: form.name.trim(),
      description: form.description,
      icon_key: form.icon_key,
      color: form.color,
      mode: form.mode,
      preferred_start_time: form.preferred_start_time,
      weekdays: form.weekdays,
      activities: activities.map((a) => ({
        id: a.id,
        title: a.title.trim(),
        description: a.description,
        icon_key: a.icon_key,
        color: a.color,
        duration_minutes: a.duration_minutes,
        start_time: form.mode === "scheduled" ? a.start_time : null,
        period: form.mode === "flexible" ? a.period : null,
        priority: a.priority,
        is_optional: a.is_optional,
        notes: a.notes,
        link: a.link ? { type: a.link.type, course_id: a.link.course_id, section_id: a.link.section_id ?? null, lesson_key: a.link.lesson_key ?? null } : null,
      })),
    };
    try {
      const saved = routineId ? await routineApi.saveRoutine(routineId, body) : await routineApi.createRoutine(body);
      bumpRoutine();
      notify({
        title: routineId ? "Rotina salva" : "Rotina criada",
        body: saved.weekdays.length ? `Entra na agenda às ${saved.weekdays.map((d) => WEEKDAY_LONG[d].toLowerCase()).join(", ")}.` : "Aplique-a a um dia quando quiser.",
        tone: "success",
      });
      navigate(paths.routine("rotinas"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar. Seus dados continuam aqui; tente de novo.");
      setBusy(false);
    }
  };

  return (
    <form className="rt-editor" onSubmit={submit} noValidate>
      <div className="rt-editor-top">
        <Link className="section-link" to={paths.routine("rotinas")}>
          <Icon name="back" size={16} />
          Minhas rotinas
        </Link>
        {original && original.status !== "active" && <span className="rt-state">{original.status === "paused" ? "Pausada" : "Arquivada"}</span>}
      </div>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="rt-editor-grid">
        <section className="surface rt-editor-card" aria-labelledby={`${ids}-about`}>
          <h2 id={`${ids}-about`} className="rt-card-title">
            Sobre a rotina
          </h2>
          <div className="rt-editor-identity" style={tone(form.color)}>
            <IconTile icon={form.icon_key} color={form.color} label={form.name || "R"} size={52} />
            <label className="rt-field rt-grow">
              <span>Nome</span>
              <input className="rt-input rt-input-lg" value={form.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Rotina matinal, Estudos, Academia" required />
            </label>
          </div>
          <label className="rt-field">
            <span>
              Descrição <em>opcional</em>
            </span>
            <textarea className="rt-input" rows={2} maxLength={1000} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="O objetivo desta rotina" />
          </label>
          <div className="rt-row">
            <div className="rt-field">
              <span>Ícone</span>
              <IconPicker value={form.icon_key} color={form.color} onChange={(v) => set("icon_key", v)} />
            </div>
            <div className="rt-field">
              <span>Cor</span>
              <ColorPicker value={form.color} onChange={(v) => set("color", v)} />
            </div>
          </div>
          <div className="rt-field">
            <span>Modalidade</span>
            <div className="rt-modes-pick" role="radiogroup" aria-label="Modalidade">
              {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                <label key={m} className={`rt-mode ${form.mode === m ? "is-on" : ""}`}>
                  <input type="radio" name={`${ids}-mode`} checked={form.mode === m} onChange={() => set("mode", m)} />
                  <strong>{MODE_LABEL[m]}</strong>
                  <small>{MODE_HINT[m]}</small>
                </label>
              ))}
            </div>
          </div>
          <div className="rt-row">
            <div className="rt-field">
              <span>
                Dias da semana <em>opcional</em>
              </span>
              <WeekdayPicker value={form.weekdays} onChange={(v) => set("weekdays", v)} />
              <small className="rt-help">{form.weekdays.length ? "Entra sozinha na agenda nesses dias." : "Sem dias: aplique a rotina quando quiser."}</small>
            </div>
            {form.mode !== "scheduled" && (
              <label className="rt-field">
                <span>
                  Horário de início <em>opcional</em>
                </span>
                <input className="rt-input" type="time" value={form.preferred_start_time ?? ""} onChange={(e) => set("preferred_start_time", e.target.value || null)} />
              </label>
            )}
          </div>
          {routineId && <p className="rt-note">Mudanças valem de hoje em diante para os dias que você ainda não ajustou. Dias passados ficam como estão.</p>}
        </section>

        <section className="surface rt-editor-card" aria-labelledby={`${ids}-acts`}>
          <div className="rt-card-head">
            <h2 id={`${ids}-acts`} className="rt-card-title">
              Atividades
            </h2>
            <span className="rt-total tabular">{total ? `${minutesLabel(total)} no total` : ""}</span>
          </div>
          {form.activities.length === 0 && <p className="rt-muted">Uma rotina pode começar vazia. Adicione atividades quando quiser.</p>}
          <ol className="rt-acts">
            {form.activities.map((a, i) => (
              <li key={a.key} className={`rt-act ${open === a.key ? "is-open" : ""}`} style={tone(a.color ?? form.color)}>
                <div className="rt-act-row">
                  <span className="rt-act-order">
                    <button type="button" className="icon-button icon-button-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Mover ${a.title || "atividade"} para cima`}>
                      <Icon name="up" size={14} />
                    </button>
                    <button type="button" className="icon-button icon-button-sm" onClick={() => move(i, 1)} disabled={i === form.activities.length - 1} aria-label={`Mover ${a.title || "atividade"} para baixo`}>
                      <Icon name="down" size={14} />
                    </button>
                  </span>
                  {form.mode === "sequence" && <span className="rt-act-num tabular">{i + 1}</span>}
                  {form.mode === "scheduled" && (
                    <input className="rt-input rt-act-time" type="time" value={a.start_time ?? ""} onChange={(e) => setAct(a.key, { start_time: e.target.value || null })} aria-label="Horário" />
                  )}
                  {form.mode === "flexible" && (
                    <select className="rt-input rt-act-period" value={a.period ?? ""} onChange={(e) => setAct(a.key, { period: (e.target.value || null) as Period | null })} aria-label="Período">
                      <option value="">Qualquer hora</option>
                      {PERIODS.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="rt-act-icon" aria-hidden="true">
                    {a.icon_key ? <RoutineIcon name={a.icon_key} size={16} /> : <i />}
                  </span>
                  <input id={`rt-act-${a.key}`} className="rt-input rt-act-title" value={a.title} maxLength={120} onChange={(e) => setAct(a.key, { title: e.target.value })} placeholder="Nome da atividade" aria-label="Nome da atividade" />
                  <label className="rt-act-dur">
                    <input
                      className="rt-input rt-input-num"
                      type="number"
                      min={1}
                      max={960}
                      value={a.duration_minutes ?? ""}
                      onChange={(e) => setAct(a.key, { duration_minutes: e.target.value ? Math.max(1, Math.min(960, Number(e.target.value))) : null })}
                      aria-label="Duração em minutos"
                      placeholder="—"
                    />
                    <span>min</span>
                  </label>
                  <button type="button" className="icon-button icon-button-sm" aria-expanded={open === a.key} aria-label={`Detalhes de ${a.title || "atividade"}`} onClick={() => setOpen((v) => (v === a.key ? null : a.key))}>
                    <Icon name="settings" size={16} />
                  </button>
                  <button type="button" className="icon-button icon-button-sm" aria-label={`Remover ${a.title || "atividade"}`} onClick={() => remove(a.key)}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
                {(a.is_optional || a.link || a.priority === "high") && open !== a.key && (
                  <p className="rt-act-tags">
                    {a.is_optional && <span>Opcional</span>}
                    {a.priority === "high" && <span>Prioridade alta</span>}
                    {a.link && (
                      <span>
                        <Icon name="book" size={12} /> {(a.link as ContentLink).lesson_title ?? (a.link as ContentLink).module_title ?? (a.link as ContentLink).course_title ?? "Conteúdo"}
                      </span>
                    )}
                  </p>
                )}
                {open === a.key && (
                  <div className="rt-act-more">
                    <label className="rt-field">
                      <span>Descrição</span>
                      <textarea className="rt-input" rows={2} value={a.description} maxLength={2000} onChange={(e) => setAct(a.key, { description: e.target.value })} />
                    </label>
                    <div className="rt-row">
                      <div className="rt-field">
                        <span>Ícone</span>
                        <IconPicker value={a.icon_key} color={a.color ?? form.color} onChange={(v) => setAct(a.key, { icon_key: v })} />
                      </div>
                      <div className="rt-field">
                        <span>Prioridade</span>
                        <div className="rt-seg" role="radiogroup" aria-label="Prioridade">
                          {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                            <button key={p} type="button" role="radio" aria-checked={a.priority === p} onClick={() => setAct(a.key, { priority: p })}>
                              {PRIORITY_LABEL[p]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="rt-field">
                      <span>Cor própria</span>
                      <ColorPicker value={a.color} onChange={(v) => setAct(a.key, { color: v })} />
                    </div>
                    <div className="rt-field">
                      <span>Duração</span>
                      <DurationField value={a.duration_minutes} onChange={(v) => setAct(a.key, { duration_minutes: v })} />
                    </div>
                    <label className="rt-check">
                      <input type="checkbox" checked={a.is_optional} onChange={(e) => setAct(a.key, { is_optional: e.target.checked })} />
                      <span>
                        Opcional
                        <small>Fica fora do progresso do dia.</small>
                      </span>
                    </label>
                    <div className="rt-field">
                      <span>Conteúdo do Teleclass</span>
                      <ContentLinkPicker value={a.link} onChange={(link, label) => setAct(a.key, { link: label ?? link })} />
                    </div>
                    <label className="rt-field">
                      <span>Observações</span>
                      <textarea className="rt-input" rows={2} value={a.notes} maxLength={2000} onChange={(e) => setAct(a.key, { notes: e.target.value })} />
                    </label>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <button type="button" className="rt-add-act" onClick={add}>
            <Icon name="plus" size={16} weight="bold" />
            Adicionar atividade
          </button>
        </section>
      </div>
      <div className="rt-editor-bar">
        <Link className="button button-ghost" to={paths.routine("rotinas")}>
          Cancelar
        </Link>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? "Salvando..." : routineId ? "Salvar rotina" : "Criar rotina"}
        </button>
      </div>
    </form>
  );
}
