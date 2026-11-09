// Diálogos curtos do dia: informar tempo, pular, reagendar, aplicar rotina e
// cronômetro ocupado. Cada um pede só o necessário para a decisão.
import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { useResource } from "../hooks/useResource";
import type { FocusSession } from "../focus/api";
import { ApplyPreview, Occurrence, Routine, routineApi } from "./api";
import { addDays, longDay } from "./dates";
import { minutesLabel, MODE_LABEL } from "./domain";
import { IconTile } from "./parts";
import { Dialog } from "./Sheet";

export function LogTimeDialog({
  occurrence,
  completing = false,
  onCancel,
  onSave,
  onComplete,
}: {
  occurrence: Occurrence;
  /** Aberto ao concluir: pergunta o tempo antes de marcar como concluída. */
  completing?: boolean;
  onCancel: () => void;
  onSave: (minutes: number) => void;
  onComplete?: () => void;
}) {
  const [minutes, setMinutes] = useState<number | "">(occurrence.manual_seconds ? Math.round(occurrence.manual_seconds / 60) : occurrence.duration_minutes ?? "");
  return (
    <Dialog
      title={completing ? "Concluir atividade" : "Quanto tempo levou?"}
      onClose={onCancel}
      actions={
        <>
          {completing ? (
            <button type="button" className="button" onClick={onComplete}>
              Concluir sem tempo
            </button>
          ) : (
            <button type="button" className="button" onClick={onCancel}>
              Agora não
            </button>
          )}
          <button type="button" className="button button-primary" disabled={!minutes} onClick={() => minutes && onSave(minutes)}>
            {completing ? "Concluir" : "Salvar tempo"}
          </button>
        </>
      }
    >
      <p>
        {completing ? (
          <>
            Quanto tempo você dedicou a <strong>{occurrence.title}</strong>? Ele entra no tempo investido do dia.
          </>
        ) : (
          <>
            <strong>{occurrence.title}</strong> foi concluída sem cronômetro. Informe o tempo real para ele entrar no tempo investido.
          </>
        )}
      </p>
      <label className="rt-field">
        <span>Minutos</span>
        <input
          className="rt-input rt-input-num"
          type="number"
          inputMode="numeric"
          min={1}
          max={960}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value ? Math.max(1, Math.min(960, Number(e.target.value))) : "")}
          onKeyDown={(e) => e.key === "Enter" && minutes && onSave(minutes)}
          data-autofocus=""
        />
      </label>
      {occurrence.duration_minutes ? <p className="rt-muted">Planejado: {minutesLabel(occurrence.duration_minutes)}. O planejado não conta sozinho.</p> : null}
    </Dialog>
  );
}

export function SkipDialog({ occurrence, onCancel, onSkip }: { occurrence: Occurrence; onCancel: () => void; onSkip: (reason: string | null) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      title={`Pular “${occurrence.title}”?`}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="button" onClick={onCancel}>
            Voltar
          </button>
          <button type="button" className="button button-primary" onClick={() => onSkip(reason.trim() || null)}>
            Pular
          </button>
        </>
      }
    >
      <p>Ela fica no histórico do dia como pulada, separada das concluídas. A rotina não muda.</p>
      <label className="rt-field">
        <span>
          Motivo <em>opcional</em>
        </span>
        <input className="rt-input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: dia corrido" data-autofocus="" />
      </label>
    </Dialog>
  );
}

export function RescheduleDialog({
  occurrence,
  today,
  onCancel,
  onSave,
}: {
  occurrence: Occurrence;
  today: string;
  onCancel: () => void;
  onSave: (date: string, time: string | null) => void;
}) {
  const [date, setDate] = useState(occurrence.date);
  const [time, setTime] = useState(occurrence.start_time ?? "");
  const quick = [
    { label: "Hoje", date: today },
    { label: "Amanhã", date: addDays(today, 1) },
    { label: "Próxima semana", date: addDays(occurrence.date, 7) },
  ];
  return (
    <Dialog
      title="Reagendar"
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="button" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!date || (date === occurrence.date && (time || null) === occurrence.start_time)}
            onClick={() => onSave(date, time || null)}
          >
            Reagendar
          </button>
        </>
      }
    >
      <p>
        <strong>{occurrence.title}</strong> sai de {longDay(occurrence.date).toLowerCase()}
        {occurrence.start_time ? ` às ${occurrence.start_time}` : ""}. O registro do reagendamento fica no histórico.
      </p>
      <div className="rt-chips">
        {quick.map((q) => (
          <button key={q.label} type="button" className="rt-chip" aria-pressed={date === q.date} onClick={() => setDate(q.date)}>
            {q.label}
          </button>
        ))}
      </div>
      <div className="rt-row">
        <label className="rt-field">
          <span>Data</span>
          <input className="rt-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-autofocus="" />
        </label>
        <label className="rt-field">
          <span>
            Horário <em>opcional</em>
          </span>
          <input className="rt-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
    </Dialog>
  );
}

export function TimerBusyDialog({ session, next, onCancel, onSwitch }: { session: FocusSession; next: Occurrence; onCancel: () => void; onSwitch: (completePrevious: boolean) => void }) {
  const current = session.intention || session.method_name;
  return (
    <Dialog
      title="O cronômetro do Foco já está rodando"
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="button" onClick={onCancel}>
            Continuar em “{current}”
          </button>
          <button type="button" className="button button-primary" onClick={() => onSwitch(false)}>
            Parar e iniciar a nova
          </button>
        </>
      }
    >
      <p>
        Um cronômetro por vez, para o tempo não contar em dobro. Ao parar, o foco de <strong>{current}</strong> fica guardado
        {session.activity_id ? " e a atividade volta a pendente" : " no histórico do Foco"}; depois começa <strong>{next.title}</strong>.
      </p>
      {session.activity_id && (
        <button type="button" className="link-button" onClick={() => onSwitch(true)}>
          Concluir “{current}” e iniciar a nova
        </button>
      )}
    </Dialog>
  );
}

/**
 * Aplicar uma rotina ao dia: escolher a rotina, ver a prévia com conflitos e
 * repetidas, e decidir. Nada é removido ou substituído sem a pessoa ver.
 */
export function ApplyRoutineDialog({ date, onCancel, onApplied }: { date: string; onCancel: () => void; onApplied: (count: number) => void }) {
  const routines = useResource("rt-apply-routines", routineApi.routines);
  const options = (routines.data ?? []).filter((r) => r.status !== "archived");
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [start, setStart] = useState("");
  const [skipDup, setSkipDup] = useState(false);
  const [preview, setPreview] = useState<ApplyPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!routine) return setPreview(null);
    let alive = true;
    routineApi
      .previewApply(routine.id, date, start || null)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [routine, date, start]);

  const dups = preview?.items.filter((i) => i.duplicate_of && !i.already_in_day) ?? [];
  const clashes = preview?.items.filter((i) => i.conflicts.length && !i.already_in_day) ?? [];
  const fresh = preview?.items.filter((i) => !i.already_in_day && !(skipDup && i.duplicate_of)) ?? [];
  const timed = routine?.activities.some((a) => a.start_time);

  const apply = async () => {
    if (!routine) return;
    setBusy(true);
    setError(null);
    try {
      const r = await routineApi.apply(routine.id, date, { start_time: start || null, skip_duplicates: skipDup });
      onApplied(r.created.length);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      wide
      title={`Aplicar rotina em ${longDay(date).toLowerCase()}`}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="button" onClick={routine ? () => setRoutine(null) : onCancel} disabled={busy}>
            {routine ? "Escolher outra" : "Cancelar"}
          </button>
          {routine && (
            <button type="button" className="button button-primary" onClick={apply} disabled={busy || !preview || !fresh.length}>
              {busy ? "Aplicando..." : clashes.length ? "Aplicar mesmo assim" : "Aplicar"}
            </button>
          )}
        </>
      }
    >
      {error && <p className="alert alert-error">{error}</p>}
      {!routine && (
        <>
          {routines.loading && <div className="skeleton rt-skel-row" />}
          {routines.data && !options.length && <p>Você ainda não tem rotinas. Crie uma em Minhas rotinas para aplicá-la aqui.</p>}
          <ul className="rt-pick-list">
            {options.map((r) => (
              <li key={r.id}>
                <button type="button" className="rt-pick" onClick={() => setRoutine(r)}>
                  <IconTile icon={r.icon_key} color={r.color} label={r.name} size={36} />
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      {MODE_LABEL[r.mode]} · {r.activities.length} {r.activities.length === 1 ? "atividade" : "atividades"}
                      {r.estimated_minutes ? ` · ${minutesLabel(r.estimated_minutes)}` : ""}
                      {r.status === "paused" ? " · pausada" : ""}
                    </small>
                  </span>
                  <Icon name="chevron" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {routine && (
        <>
          <div className="rt-apply-head">
            <IconTile icon={routine.icon_key} color={routine.color} label={routine.name} size={36} />
            <strong>{routine.name}</strong>
            {timed && (
              <label className="rt-inline-field">
                Começar às
                <input className="rt-input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
            )}
          </div>
          {preview?.already_applied && fresh.length === 0 && <p className="rt-note">Esta rotina já está neste dia. Aplicar de novo não duplica nada.</p>}
          {!preview && <div className="skeleton rt-skel-row" />}
          {preview && (
            <ul className="rt-preview">
              {preview.items.map((i) => (
                <li key={i.activity_id} className={i.already_in_day || (skipDup && i.duplicate_of) ? "is-skipped" : ""}>
                  <span className="tabular rt-preview-time">{i.start_time ?? "—"}</span>
                  <span className="rt-preview-title">
                    {i.title}
                    {i.duration_minutes ? <small> · {minutesLabel(i.duration_minutes)}</small> : null}
                  </span>
                  {i.already_in_day && <span className="rt-flag">Já no dia</span>}
                  {!i.already_in_day && i.duplicate_of && <span className="rt-flag">Repetida</span>}
                  {!i.already_in_day && i.conflicts.length > 0 && (
                    <span className="rt-flag is-warn">
                      <Icon name="warningCircle" size={13} />
                      {i.conflicts.map((c) => `${c.title}${c.start_time ? ` (${c.start_time})` : ""}`).join(", ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {clashes.length > 0 && <p className="rt-note">Há horários sobrepostos. Você pode aplicar mesmo assim, mudar “Começar às” ou cancelar.</p>}
          {dups.length > 0 && (
            <div className="rt-options" role="radiogroup" aria-label="Atividades repetidas">
              <label className="rt-option">
                <input type="radio" checked={!skipDup} onChange={() => setSkipDup(false)} />
                <span>
                  <strong>Adicionar todas</strong>
                  <small>Mesmo as que têm o mesmo nome de uma atividade do dia.</small>
                </span>
              </label>
              <label className="rt-option">
                <input type="radio" checked={skipDup} onChange={() => setSkipDup(true)} />
                <span>
                  <strong>Pular as repetidas</strong>
                  <small>{dups.map((d) => d.title).join(", ")} não entram de novo.</small>
                </span>
              </label>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
