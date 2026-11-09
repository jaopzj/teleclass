// Adicionar ou editar uma atividade do dia. O essencial (nome, data, horário e
// duração) fica à vista; o resto em "Mais opções". Ao editar uma atividade que
// veio de uma rotina, a pessoa escolhe o alcance da mudança.
import { FormEvent, useId, useState } from "react";
import Icon from "../components/Icon";
import { ApiError } from "../api";
import { notify } from "../notifications/center";
import { ActivityFields, ContentLink, EditScope, LinkInput, Occurrence, Period, Priority, routineApi } from "./api";
import { longDay } from "./dates";
import { PERIODS, PRIORITY_LABEL } from "./domain";
import { ColorPicker, ContentLinkPicker, DurationField, IconPicker, WeekdayPicker } from "./pickers";
import Sheet, { Dialog } from "./Sheet";
import { bumpRoutine } from "./session";

export interface Draft extends ActivityFields {
  date: string;
  link: ContentLink | LinkInput | null;
  repeat: boolean;
  repeat_weekdays: number[];
}

export function emptyDraft(date: string, partial: Partial<Draft> = {}): Draft {
  return {
    date,
    title: "",
    description: "",
    icon_key: null,
    color: null,
    duration_minutes: null,
    start_time: null,
    period: null,
    priority: "normal",
    is_optional: false,
    notes: "",
    link: null,
    repeat: false,
    repeat_weekdays: [],
    ...partial,
  };
}

const fromOccurrence = (o: Occurrence): Draft => ({
  date: o.date,
  title: o.title,
  description: o.description,
  icon_key: o.icon_key,
  color: o.color,
  duration_minutes: o.duration_minutes,
  start_time: o.start_time,
  period: o.start_time ? null : o.period,
  priority: o.priority,
  is_optional: o.is_optional,
  notes: o.notes,
  link: o.link,
  repeat: false,
  repeat_weekdays: [],
});

const EDITABLE: (keyof ActivityFields)[] = [
  "title", "description", "icon_key", "color", "duration_minutes", "start_time", "period", "priority", "is_optional", "notes",
];

const sameLink = (a: LinkInput | null, b: LinkInput | null) =>
  (a?.type ?? null) === (b?.type ?? null) && (a?.course_id ?? null) === (b?.course_id ?? null) &&
  (a?.section_id ?? null) === (b?.section_id ?? null) && (a?.lesson_key ?? null) === (b?.lesson_key ?? null);

const linkInput = (l: ContentLink | LinkInput | null): LinkInput | null =>
  l ? { type: l.type, course_id: l.course_id, section_id: l.section_id ?? null, lesson_key: l.lesson_key ?? null } : null;

export default function ActivityForm({
  occurrence,
  initial,
  onClose,
  onSaved,
}: {
  /** Editar esta ocorrência; sem ela, cria uma atividade avulsa. */
  occurrence?: Occurrence;
  initial?: Draft;
  onClose: () => void;
  onSaved: (o: Occurrence) => void;
}) {
  const editing = !!occurrence;
  const [draft, setDraft] = useState<Draft>(() => (occurrence ? fromOccurrence(occurrence) : initial ?? emptyDraft("")));
  const [more, setMore] = useState(() => !!occurrence || !!initial?.link || !!initial?.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askScope, setAskScope] = useState<Partial<ActivityFields> & { link?: LinkInput | null } | null>(null);
  const ids = useId();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const changes = () => {
    if (!occurrence) return {};
    const base = fromOccurrence(occurrence);
    const out: Partial<ActivityFields> & { link?: LinkInput | null } = {};
    for (const key of EDITABLE) if (draft[key] !== base[key]) (out as Record<string, unknown>)[key] = draft[key];
    if (!sameLink(linkInput(draft.link), linkInput(base.link))) out.link = linkInput(draft.link);
    if ("start_time" in out && out.start_time) out.period = null;
    return out;
  };

  const save = async (scope: EditScope = "occurrence", explicit?: ReturnType<typeof changes>) => {
    setBusy(true);
    setError(null);
    try {
      let saved: Occurrence;
      if (occurrence) {
        const diff = explicit ?? changes();
        if (!Object.keys(diff).length) return onClose();
        saved = await routineApi.updateOccurrence(occurrence.id, diff, scope);
        notify({ title: scope === "occurrence" ? "Alteração salva" : scope === "following" ? "Salvo nesta e nas próximas" : "Rotina base atualizada", tone: "success", durationMs: 3000 });
      } else {
        saved = await routineApi.createOccurrence(draft.date, {
          title: draft.title,
          description: draft.description,
          icon_key: draft.icon_key,
          color: draft.color,
          duration_minutes: draft.duration_minutes,
          start_time: draft.start_time,
          period: draft.start_time ? null : draft.period,
          priority: draft.priority,
          is_optional: draft.is_optional,
          notes: draft.notes,
          link: linkInput(draft.link),
          repeat_weekdays: draft.repeat && draft.repeat_weekdays.length ? draft.repeat_weekdays : null,
        });
        notify({ title: "Atividade adicionada", body: saved.title, tone: "success", durationMs: 3000 });
      }
      bumpRoutine();
      onSaved(saved);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível salvar. Seus dados continuam aqui; tente de novo.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) return setError("Dê um nome à atividade.");
    if (occurrence?.routine_activity_id && occurrence.routine && !occurrence.routine.deleted) {
      const diff = changes();
      if (!Object.keys(diff).length) return onClose();
      return setAskScope(diff);
    }
    void save();
  };

  return (
    <Sheet
      title={editing ? "Editar atividade" : "Adicionar atividade"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form={`${ids}-form`} className="button button-primary" disabled={busy}>
            {busy ? "Salvando..." : editing ? "Salvar" : "Adicionar"}
          </button>
        </>
      }
    >
      <form id={`${ids}-form`} className="rt-form" onSubmit={submit} noValidate>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <label className="rt-field">
          <span>Nome</span>
          <input
            className="rt-input rt-input-lg"
            value={draft.title}
            maxLength={120}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Ex.: Ler 20 páginas, Treino, Revisar aula"
            required
          />
        </label>
        <div className="rt-row">
          {!editing ? (
            <label className="rt-field">
              <span>Data</span>
              <input className="rt-input" type="date" value={draft.date} onChange={(e) => e.target.value && set("date", e.target.value)} required />
            </label>
          ) : (
            <div className="rt-field">
              <span>Data</span>
              <p className="rt-static">{longDay(draft.date)}</p>
            </div>
          )}
          <label className="rt-field">
            <span>
              Horário <em>opcional</em>
            </span>
            <span className="rt-timefield">
              <input className="rt-input" type="time" value={draft.start_time ?? ""} onChange={(e) => set("start_time", e.target.value || null)} />
              {draft.start_time && (
                <button type="button" className="icon-button icon-button-sm" aria-label="Tirar horário" onClick={() => set("start_time", null)}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </span>
          </label>
        </div>
        {!draft.start_time && (
          <div className="rt-field">
            <span>
              Período <em>opcional</em>
            </span>
            <div className="rt-seg" role="radiogroup" aria-label="Período">
              <button type="button" role="radio" aria-checked={!draft.period} onClick={() => set("period", null)}>
                Sem horário
              </button>
              {PERIODS.map((p) => (
                <button key={p.key} type="button" role="radio" aria-checked={draft.period === p.key} onClick={() => set("period", p.key as Period)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="rt-field">
          <label htmlFor={`${ids}-dur`}>
            Duração estimada <em>opcional</em>
          </label>
          <DurationField id={`${ids}-dur`} value={draft.duration_minutes} onChange={(v) => set("duration_minutes", v)} />
        </div>

        <button type="button" className="rt-disclosure" aria-expanded={more} onClick={() => setMore((v) => !v)}>
          <Icon name="down" size={16} />
          Mais opções
        </button>
        {more && (
          <div className="rt-more">
            <label className="rt-field">
              <span>Descrição</span>
              <textarea className="rt-input" rows={2} value={draft.description} maxLength={2000} onChange={(e) => set("description", e.target.value)} />
            </label>
            <div className="rt-row">
              <div className="rt-field">
                <span>Ícone</span>
                <IconPicker value={draft.icon_key} color={draft.color} onChange={(v) => set("icon_key", v)} />
              </div>
              <div className="rt-field">
                <span>Prioridade</span>
                <div className="rt-seg" role="radiogroup" aria-label="Prioridade">
                  {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                    <button key={p} type="button" role="radio" aria-checked={draft.priority === p} onClick={() => set("priority", p)}>
                      {PRIORITY_LABEL[p]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="rt-field">
              <span>Cor</span>
              <ColorPicker value={draft.color} onChange={(v) => set("color", v)} />
            </div>
            <label className="rt-check">
              <input type="checkbox" checked={draft.is_optional} onChange={(e) => set("is_optional", e.target.checked)} />
              <span>
                Opcional
                <small>Fica fora do progresso do dia.</small>
              </span>
            </label>
            <div className="rt-field">
              <span>Conteúdo do Teleclass</span>
              <ContentLinkPicker value={draft.link} onChange={(link, label) => set("link", label ?? link)} />
            </div>
            <label className="rt-field">
              <span>Observações</span>
              <textarea className="rt-input" rows={2} value={draft.notes} maxLength={2000} onChange={(e) => set("notes", e.target.value)} />
            </label>
            {!editing && (
              <div className="rt-field">
                <label className="rt-check">
                  <input type="checkbox" checked={draft.repeat} onChange={(e) => set("repeat", e.target.checked)} />
                  <span>
                    Repetir toda semana
                    <small>Vira uma rotina com esta atividade, que você ajusta em Minhas rotinas.</small>
                  </span>
                </label>
                {draft.repeat && <WeekdayPicker value={draft.repeat_weekdays} onChange={(v) => set("repeat_weekdays", v)} />}
              </div>
            )}
          </div>
        )}
      </form>
      {askScope && occurrence && (
        <ScopeDialog
          occurrence={occurrence}
          busy={busy}
          onCancel={() => setAskScope(null)}
          onChoose={(scope) => {
            const diff = askScope;
            setAskScope(null);
            void save(scope, diff);
          }}
        />
      )}
    </Sheet>
  );
}

/** Alcance da edição de uma atividade que veio de uma rotina. */
export function ScopeDialog({ occurrence, busy, onCancel, onChoose }: { occurrence: Occurrence; busy: boolean; onCancel: () => void; onChoose: (scope: EditScope) => void }) {
  const [scope, setScope] = useState<EditScope>("occurrence");
  const name = occurrence.routine?.name ?? "rotina";
  const options: { key: EditScope; title: string; text: string }[] = [
    { key: "occurrence", title: "Somente neste dia", text: `Só ${longDay(occurrence.date).toLowerCase()} muda. A rotina ${name} continua igual.` },
    { key: "following", title: "Este e os próximos dias", text: `Muda aqui, nos próximos dias já planejados com ${name} e na rotina base.` },
    { key: "routine", title: "Só a rotina base", text: `Vale para os próximos dias que você ainda não ajustou. Este dia fica como está.` },
  ];
  return (
    <Dialog
      title="Onde aplicar a mudança?"
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="button" onClick={onCancel} disabled={busy}>
            Voltar
          </button>
          <button type="button" className="button button-primary" onClick={() => onChoose(scope)} disabled={busy}>
            Salvar
          </button>
        </>
      }
    >
      <div className="rt-options" role="radiogroup" aria-label="Alcance">
        {options.map((o) => (
          <label key={o.key} className="rt-option">
            <input type="radio" name="rt-scope" checked={scope === o.key} onChange={() => setScope(o.key)} data-autofocus={o.key === "occurrence" ? "" : undefined} />
            <span>
              <strong>{o.title}</strong>
              <small>{o.text}</small>
            </span>
          </label>
        ))}
      </div>
      <p className="rt-muted">Dias passados nunca mudam.</p>
    </Dialog>
  );
}
