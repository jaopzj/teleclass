// Meu dia (e a visualização "Dia" da agenda): resumo, criação rápida e timeline
// da data escolhida, com todas as ações sobre as atividades.
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import ConfirmDialog from "../focus/ConfirmDialog";
import { useResource } from "../hooks/useResource";
import { notify } from "../notifications/center";
import { navigate } from "../router";
import type { FocusSession } from "../focus/api";
import { sync as syncFocus, useFocus } from "../focus/store";
import { DayDetail, Occurrence, routineApi } from "./api";
import { failed, focusAction, linkTarget, Patch, useOccurrenceActions } from "./actions";
import ActivityForm, { Draft, emptyDraft } from "./ActivityForm";
import { longDay, nowMinutes } from "./dates";
import { ApplyRoutineDialog, LogTimeDialog, RescheduleDialog, SkipDialog, TimerBusyDialog } from "./dialogs";
import Overview from "./Overview";
import { IconTile } from "./parts";
import { bumpRoutine, useFocusChanges, useRoutineRevision } from "./session";
import Timeline from "./Timeline";

type Modal =
  | { kind: "add"; draft: Draft }
  | { kind: "edit"; occurrence: Occurrence }
  | { kind: "time"; occurrence: Occurrence; completing?: boolean }
  | { kind: "skip"; occurrence: Occurrence }
  | { kind: "reschedule"; occurrence: Occurrence }
  | { kind: "remove"; occurrence: Occurrence }
  | { kind: "busy"; session: FocusSession; next: Occurrence }
  | { kind: "apply" }
  | { kind: "unapply"; routine: DayDetail["routines"][number] };

export default function DayView({
  date,
  compact = false,
  addSignal,
  applySignal,
}: {
  date: string;
  /** Visualização "Dia" da agenda: resumo enxuto, sem o cartão da próxima atividade. */
  compact?: boolean;
  /** Muda quando o botão "Adicionar atividade" do cabeçalho é usado. */
  addSignal?: number;
  applySignal?: number;
}) {
  const revision = useRoutineRevision();
  const { session: focusSession } = useFocus();
  useFocusChanges();
  const { data, error, loading, setData, reload } = useResource(`rt-day:${date}:${revision}`, () => routineApi.day(date));
  const [modal, setModal] = useState<Modal | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [now, setNow] = useState(() => nowMinutes());
  const shown = data && data.date === date ? data : null;
  const isToday = !!shown && shown.date === shown.today;

  useEffect(() => {
    const id = window.setInterval(() => setNow(nowMinutes()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) return;
    if (addSignal) setModal({ kind: "add", draft: emptyDraft(date) });
  }, [addSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (first.current) return;
    if (applySignal) setModal({ kind: "apply" });
  }, [applySignal]);
  useEffect(() => {
    first.current = false;
  }, []);

  const patch: Patch = useCallback(
    (id, change) => {
      let previous: DayDetail | undefined;
      setData((d) => {
        previous = d;
        if (!d) return d;
        const occurrences = change === null ? d.occurrences.filter((o) => o.id !== id) : d.occurrences.map((o) => (o.id === id ? { ...o, ...change } : o));
        return { ...d, occurrences, summary: optimisticSummary(d, occurrences) };
      });
      return () => setData(previous);
    },
    [setData],
  );

  const onBusy = useCallback((s: FocusSession, next: Occurrence) => setModal({ kind: "busy", session: s, next }), []);
  const { run, setStatus, start, pending } = useOccurrenceActions(patch, onBusy, focusSession);

  const focusItem = (o: Occurrence) => {
    setHighlight(o.id);
    document.getElementById(`rt-item-${o.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setHighlight((h) => (h === o.id ? null : h)), 1600);
  };

  const toggle = (o: Occurrence) => {
    if (o.status === "completed" || o.status === "skipped" || o.status === "cancelled") return void setStatus(o, "pending");
    // Com tempo do Foco, conclui direto (o servidor encerra a sessão). Sem ele, pergunta o tempo antes.
    if (o.focusing || o.timer_seconds > 0) return void setStatus(o, "completed");
    setModal({ kind: "time", occurrence: o, completing: true });
  };

  const reorder = (groupIds: string[]) => {
    if (!shown) return;
    // Mantém a ordem relativa do resto do dia e encaixa o grupo reordenado.
    const all = [...shown.occurrences].sort((a, b) => a.position - b.position).map((o) => o.id);
    const slots = all.map((id, i) => (groupIds.includes(id) ? i : -1)).filter((i) => i >= 0);
    const next = [...all];
    slots.forEach((slot, k) => (next[slot] = groupIds[k]));
    const positions = new Map(next.map((id, i) => [id, i]));
    const previous = shown;
    setData({ ...shown, occurrences: shown.occurrences.map((o) => ({ ...o, position: positions.get(o.id) ?? o.position })) });
    routineApi
      .reorder(date, next)
      .then(bumpRoutine)
      .catch((e) => {
        setData(previous);
        failed("Não foi possível reordenar", e);
      });
  };

  const handlers = {
    onToggle: toggle,
    onStart: (o: Occurrence) => void start(o, { open: !!o.link?.available }),
    onSession: (action: "pause" | "resume" | "stop") => void focusAction(action),
    onEdit: (o: Occurrence) => setModal({ kind: "edit", occurrence: o }),
    onReschedule: (o: Occurrence) => setModal({ kind: "reschedule", occurrence: o }),
    onSkip: (o: Occurrence) => setModal({ kind: "skip", occurrence: o }),
    onCancel: (o: Occurrence) =>
      void setStatus(o, "cancelled").then(
        (r) => r && notify({ title: "Cancelada neste dia", body: "Ela sai do progresso e continua no histórico.", tone: "neutral", durationMs: 4000, action: { label: "Desfazer", run: () => void setStatus(r, "pending") } }),
      ),
    onReopen: (o: Occurrence) => void setStatus(o, "pending"),
    onRemove: (o: Occurrence) => setModal({ kind: "remove", occurrence: o }),
    onOpenLink: (o: Occurrence) => o.link && navigate(linkTarget(o.link)),
    onLogTime: (o: Occurrence) => setModal({ kind: "time", occurrence: o }),
    onReorder: reorder,
  };

  const close = useCallback(() => setModal(null), []);

  if (error && !shown) {
    return (
      <div className="empty">
        <span className="empty-icon">
          <Icon name="alert" size={24} />
        </span>
        <h2>Não foi possível carregar o dia</h2>
        <p>Verifique a conexão. Nada do que você planejou se perdeu.</p>
        <button type="button" className="button button-primary" onClick={reload}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!shown) return <DaySkeleton compact={compact} />;

  const nowMin = isToday ? now : null;
  const dayKind = shown.date === shown.today ? "today" : shown.date < shown.today ? "past" : "future";
  const empty = shown.occurrences.length === 0;

  return (
    <div className={`rt-day ${loading ? "is-refreshing" : ""}`}>
      <Overview data={shown} nowMin={nowMin} compact={compact} onStart={handlers.onStart} onFocus={focusItem} />

      <section className="rt-plan surface" aria-label={`Atividades de ${longDay(date)}`}>
        <header className="rt-plan-head">
          <h2 className="rt-plan-title">Timeline</h2>
          {shown.routines.length > 0 && (
            <ul className="rt-applied" aria-label="Rotinas neste dia">
              {shown.routines.map((r) => (
                <li key={r.id}>
                  <IconTile icon={r.icon_key} color={r.color} label={r.name} size={22} />
                  {r.name}
                  <button type="button" className="rt-applied-x" aria-label={`Tirar ${r.name} deste dia`} onClick={() => setModal({ kind: "unapply", routine: r })}>
                    <Icon name="close" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="button button-sm button-ghost rt-plan-apply" onClick={() => setModal({ kind: "apply" })}>
            <Icon name="layers" size={16} />
            Aplicar rotina
          </button>
        </header>

        <QuickAdd date={date} onMore={(draft) => setModal({ kind: "add", draft })} />

        {empty ? (
          <div className="rt-empty-day">
            <h3>{shown.date < shown.today ? "Nada planejado neste dia" : "Um dia em branco"}</h3>
            <p>{shown.date < shown.today ? "Dias sem planejamento não contam como falha." : "Adicione uma atividade acima ou aplique uma das suas rotinas. Dias de descanso também valem."}</p>
            <button type="button" className="button button-soft" onClick={() => setModal({ kind: "apply" })}>
              <Icon name="layers" size={16} />
              Aplicar rotina
            </button>
          </div>
        ) : (
          <Timeline items={shown.occurrences} conflicts={shown.conflicts} session={focusSession} day={dayKind} nowMin={nowMin} highlight={highlight} busy={pending} handlers={handlers} />
        )}
        {!empty && shown.occurrences.some((o) => !o.start_time) && (
          <p className="rt-hint">Arraste as atividades sem horário para mudar a ordem. As com horário seguem o relógio: para movê-las, mude o horário.</p>
        )}
      </section>

      {modal?.kind === "add" && <ActivityForm initial={modal.draft} onClose={close} onSaved={(o) => (close(), o.date === date && window.setTimeout(() => focusItem(o), 300))} />}
      {modal?.kind === "edit" && <ActivityForm occurrence={modal.occurrence} onClose={close} onSaved={close} />}
      {modal?.kind === "time" && (
        <LogTimeDialog
          occurrence={modal.occurrence}
          completing={modal.completing}
          onCancel={close}
          onComplete={() => {
            const o = modal.occurrence;
            close();
            void setStatus(o, "completed");
          }}
          onSave={(minutes) => {
            const o = modal.occurrence;
            close();
            void run(
              o.id,
              { status: "completed", manual_seconds: minutes * 60, invested_seconds: o.timer_seconds + minutes * 60 },
              () => routineApi.setStatus(o.id, "completed", { actual_minutes: minutes }),
              "Não foi possível salvar o tempo",
            );
          }}
        />
      )}
      {modal?.kind === "skip" && (
        <SkipDialog
          occurrence={modal.occurrence}
          onCancel={close}
          onSkip={(reason) => {
            const o = modal.occurrence;
            close();
            void setStatus(o, "skipped", { reason }).then((r) => r && notify({ title: "Pulada", body: "Não conta como concluída. Fica no histórico.", tone: "neutral", durationMs: 4000, action: { label: "Desfazer", run: () => void setStatus(r, "pending") } }));
          }}
        />
      )}
      {modal?.kind === "reschedule" && (
        <RescheduleDialog
          occurrence={modal.occurrence}
          today={shown.today}
          onCancel={close}
          onSave={(d, t) => {
            const o = modal.occurrence;
            close();
            void run(o.id, d === date ? { start_time: t, display_period: t ? periodOf(t) : o.period } : null, () => routineApi.reschedule(o.id, d, t), "Não foi possível reagendar").then((r) => {
              if (!r) return;
              const clash = r.conflicts?.length ? ` Mesmo horário que ${r.conflicts.map((c) => c.title).join(", ")}.` : "";
              notify({
                title: d === date ? `Agora às ${t ?? "qualquer hora"}` : `Movida para ${longDay(d).toLowerCase()}`,
                body: `${o.title}.${clash}`,
                tone: "neutral",
                action: d === date ? undefined : { label: "Ver dia", run: () => navigate(`/rotina?data=${d}`) },
              });
            });
          }}
        />
      )}
      {modal?.kind === "remove" && (
        <ConfirmDialog
          title={`Remover “${modal.occurrence.title}” deste dia?`}
          confirmLabel="Remover do dia"
          danger
          onCancel={close}
          onConfirm={() => {
            const o = modal.occurrence;
            close();
            void run(o.id, null, () => routineApi.removeOccurrence(o.id), "Não foi possível remover");
          }}
        >
          <p>{modal.occurrence.routine ? `A rotina ${modal.occurrence.routine.name} continua igual e os outros dias não mudam.` : "A atividade sai só deste dia."}</p>
          {modal.occurrence.invested_seconds > 0 && <p className="muted">O tempo registrado continua no histórico.</p>}
        </ConfirmDialog>
      )}
      {modal?.kind === "busy" && (
        <TimerBusyDialog
          session={modal.session}
          next={modal.next}
          onCancel={close}
          onSwitch={async (completePrevious) => {
            const { session: s, next } = modal;
            close();
            let ok: boolean;
            if (completePrevious && s.activity_id) {
              ok = await routineApi.setStatus(s.activity_id, "completed").then(
                () => (syncFocus(), true),
                (e) => (failed("Não foi possível concluir", e), false),
              );
            } else ok = await focusAction("stop");
            if (ok) void start(next, { open: !!next.link?.available, force: true });
          }}
        />
      )}
      {modal?.kind === "apply" && (
        <ApplyRoutineDialog
          date={date}
          onCancel={close}
          onApplied={(count) => {
            close();
            bumpRoutine();
            notify({ title: count ? `${count} ${count === 1 ? "atividade adicionada" : "atividades adicionadas"}` : "Nada novo para adicionar", tone: count ? "success" : "neutral", durationMs: 3500 });
          }}
        />
      )}
      {modal?.kind === "unapply" && (
        <ConfirmDialog
          title={`Tirar ${modal.routine.name} deste dia?`}
          confirmLabel="Tirar do dia"
          onCancel={close}
          onConfirm={async () => {
            const r = modal.routine;
            close();
            try {
              await routineApi.unapply(r.id, date);
              bumpRoutine();
              notify({ title: `${r.name} saiu deste dia`, body: "A rotina continua em Minhas rotinas.", tone: "neutral", durationMs: 3500 });
            } catch (e) {
              failed("Não foi possível tirar a rotina", e);
            }
          }}
        >
          <p>As atividades ainda não feitas saem deste dia. Concluídas e em andamento ficam no histórico. A rotina e os outros dias não mudam.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function periodOf(time: string) {
  const h = Number(time.slice(0, 2));
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

/** Resumo recalculado localmente durante a atualização otimista (o servidor confirma em seguida). */
function optimisticSummary(d: DayDetail, items: Occurrence[]) {
  const s = { ...d.summary, planned: 0, completed: 0, skipped: 0, in_progress: 0, remaining: 0, cancelled: 0, optional_total: 0, optional_completed: 0, planned_minutes: 0, invested_seconds: 0 };
  for (const o of items) {
    s.invested_seconds += o.invested_seconds;
    if (o.status === "cancelled") {
      s.cancelled++;
      continue;
    }
    if (o.is_optional) {
      s.optional_total++;
      if (o.status === "completed") s.optional_completed++;
      continue;
    }
    s.planned++;
    s.planned_minutes += o.duration_minutes ?? 0;
    if (o.status === "completed") s.completed++;
    else if (o.status === "skipped") s.skipped++;
    else {
      s.remaining++;
      if (o.status === "in_progress") s.in_progress++;
    }
  }
  s.progress = s.planned ? s.completed / s.planned : null;
  return s;
}

/** Criação rápida: nome, horário e duração; "Mais opções" leva ao formulário completo. */
function QuickAdd({ date, onMore }: { date: string; onMore: (draft: Draft) => void }) {
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const draft = () => emptyDraft(date, { title: title.trim(), start_time: time || null, duration_minutes: duration || null });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return input.current?.focus();
    setBusy(true);
    try {
      await routineApi.createOccurrence(date, { title: title.trim(), start_time: time || null, duration_minutes: duration || null });
      setTitle("");
      setTime("");
      setDuration("");
      bumpRoutine();
      input.current?.focus();
    } catch (err) {
      failed("Não foi possível adicionar", err); // o texto digitado continua no campo
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="rt-quick" onSubmit={submit} aria-label="Adicionar atividade rápida">
      <span className="rt-quick-plus" aria-hidden="true">
        <Icon name="plus" size={16} weight="bold" />
      </span>
      <input ref={input} className="rt-quick-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Adicionar atividade" maxLength={120} aria-label="Nome da atividade" />
      <input className="rt-quick-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Horário (opcional)" />
      <label className="rt-quick-dur">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={960}
          value={duration}
          onChange={(e) => setDuration(e.target.value ? Math.max(1, Math.min(960, Number(e.target.value))) : "")}
          placeholder="—"
          aria-label="Duração em minutos (opcional)"
        />
        <span aria-hidden="true">min</span>
      </label>
      <button type="button" className="button button-sm button-ghost" onClick={() => onMore(draft())}>
        Mais opções
      </button>
      <button type="submit" className="button button-sm button-primary" disabled={busy || !title.trim()}>
        Adicionar
      </button>
    </form>
  );
}

export function DaySkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rt-day" aria-busy="true" aria-label="Carregando o dia">
      <div className={`rt-overview surface ${compact ? "is-compact" : ""}`}>
        <div className="rt-overview-main">
          <span className="skeleton skeleton-line" style={{ width: "40%" }} />
          <span className="skeleton rt-skel-strip" />
          <span className="skeleton skeleton-line" style={{ width: "70%" }} />
        </div>
      </div>
      <div className="rt-plan surface">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton rt-skel-row" />
        ))}
      </div>
    </div>
  );
}
