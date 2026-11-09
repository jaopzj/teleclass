// Timeline do dia: manhã, tarde e noite pelo horário (ou período) e, à parte,
// "Sem horário". O marcador de cada atividade é o próprio botão de concluir.
// Arrastar (ou "Mover para cima/baixo") só reordena atividades sem horário: as
// com horário seguem o relógio, e mudá-las de lugar é mudar o horário.
import { DragEvent, Fragment, useState } from "react";
import Icon from "../components/Icon";
import type { FocusSession } from "../focus/api";
import type { Occurrence } from "./api";
import { toMinutes } from "./dates";
import { clock, conflictIds, groupTimeline, minutesLabel, secondsLabel, STATUS_LABEL, timeRange } from "./domain";
import Menu, { MenuAction } from "./Menu";
import { occurrenceColor, occurrenceIcon, RoutineIcon, STATUS_ICON, tone } from "./parts";
import { timeShare, useActivityTime } from "./focustime";

export type DayKind = "past" | "today" | "future";

export interface TimelineHandlers {
  onToggle: (o: Occurrence) => void;
  onStart: (o: Occurrence) => void;
  onSession: (action: "pause" | "resume" | "stop") => void;
  onEdit: (o: Occurrence) => void;
  onReschedule: (o: Occurrence) => void;
  onSkip: (o: Occurrence) => void;
  onCancel: (o: Occurrence) => void;
  onReopen: (o: Occurrence) => void;
  onRemove: (o: Occurrence) => void;
  onOpenLink: (o: Occurrence) => void;
  onLogTime: (o: Occurrence) => void;
  /** Nova ordem dos ids de um grupo sem horário. */
  onReorder: (groupIds: string[]) => void;
}

export default function Timeline({
  items,
  conflicts,
  session,
  day,
  nowMin,
  highlight,
  busy,
  handlers,
}: {
  items: Occurrence[];
  conflicts: [string, string][];
  /** Sessão ativa do Foco (de qualquer atividade, ou de nenhuma). */
  session: FocusSession | null;
  /** Concluir e cronometrar só valem hoje; dias seguintes só podem ser editados. */
  day: DayKind;
  nowMin: number | null;
  highlight: string | null;
  busy: Set<string>;
  handlers: TimelineHandlers;
}) {
  const { periods, unscheduled } = groupTimeline(items);
  const clashes = conflictIds(conflicts);
  const byId = new Map(items.map((o) => [o.id, o]));
  // A linha do "agora" fica antes da primeira atividade com horário que ainda não começou.
  const nowBefore =
    nowMin == null ? null : items.filter((o) => o.start_time && toMinutes(o.start_time)! > nowMin).sort((a, b) => toMinutes(a.start_time)! - toMinutes(b.start_time)!)[0]?.id ?? null;
  const nowAtEnd = nowMin != null && !nowBefore && items.some((o) => o.start_time);

  const row = (o: Occurrence, group: Occurrence[]) => (
    <Fragment key={o.id}>
      {nowBefore === o.id && <NowLine minutes={nowMin!} />}
      <Item
        item={o}
        group={group}
        session={session}
        day={day}
        clashes={(clashes.get(o.id) ?? []).map((id) => byId.get(id)!).filter(Boolean)}
        highlighted={highlight === o.id}
        busy={busy.has(o.id)}
        handlers={handlers}
      />
    </Fragment>
  );

  return (
    <div className="rt-timeline">
      {periods.map((p, i) => (
        <section key={p.key} className="rt-period" aria-labelledby={`rt-period-${p.key}`}>
          <h3 id={`rt-period-${p.key}`} className="rt-period-title">
            {p.label}
          </h3>
          <ReorderList items={p.items} onReorder={handlers.onReorder} render={row} />
          {nowAtEnd && i === periods.length - 1 && unscheduled.length === 0 && <NowLine minutes={nowMin!} />}
        </section>
      ))}
      {nowAtEnd && unscheduled.length > 0 && <NowLine minutes={nowMin!} />}
      {unscheduled.length > 0 && (
        <section className="rt-period is-unscheduled" aria-labelledby="rt-period-none">
          <h3 id="rt-period-none" className="rt-period-title">
            Sem horário
          </h3>
          <ReorderList items={unscheduled} onReorder={handlers.onReorder} render={row} />
        </section>
      )}
    </div>
  );
}

function NowLine({ minutes }: { minutes: number }) {
  const label = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return (
    <div className="rt-now" role="separator" aria-label={`Agora, ${label}`}>
      <span className="tabular">{label}</span>
    </div>
  );
}

/** Lista com arrastar e soltar para as atividades sem horário do grupo. */
function ReorderList({
  items,
  onReorder,
  render,
}: {
  items: Occurrence[];
  onReorder: (ids: string[]) => void;
  render: (o: Occurrence, group: Occurrence[]) => JSX.Element;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const movable = (o: Occurrence) => !o.start_time;

  const drop = (target: string) => {
    if (!dragging || dragging === target) return;
    const ids = items.filter(movable).map((o) => o.id);
    const from = ids.indexOf(dragging);
    const to = ids.indexOf(target);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    onReorder(ids);
  };

  return (
    <ol className="rt-items">
      {items.map((o) => (
        <li
          key={o.id}
          className={`${dragging === o.id ? "is-dragging" : ""} ${over === o.id && dragging !== o.id ? "is-over" : ""}`}
          draggable={movable(o)}
          onDragStart={(e: DragEvent) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", o.id);
            setDragging(o.id);
          }}
          onDragOver={(e) => {
            if (!dragging || !movable(o)) return;
            e.preventDefault();
            setOver(o.id);
          }}
          onDragLeave={() => setOver((v) => (v === o.id ? null : v))}
          onDrop={(e) => {
            e.preventDefault();
            drop(o.id);
            setDragging(null);
            setOver(null);
          }}
          onDragEnd={() => {
            setDragging(null);
            setOver(null);
          }}
        >
          {render(o, items)}
        </li>
      ))}
    </ol>
  );
}

function Item({
  item,
  group,
  session: focus,
  day,
  clashes,
  highlighted,
  busy,
  handlers,
}: {
  item: Occurrence;
  group: Occurrence[];
  session: FocusSession | null;
  day: DayKind;
  clashes: Occurrence[];
  highlighted: boolean;
  busy: boolean;
  handlers: TimelineHandlers;
}) {
  const { session, invested, sessionFocus } = useActivityTime(item, focus);
  const share = timeShare(invested, item.duration_minutes);
  const isToday = day === "today";
  const movable = group.filter((o) => !o.start_time);
  const index = movable.findIndex((o) => o.id === item.id);
  const move = (delta: number) => {
    const ids = movable.map((o) => o.id);
    ids.splice(index + delta, 0, ...ids.splice(index, 1));
    handlers.onReorder(ids);
  };
  const done = item.status === "completed";
  const closed = done || item.status === "skipped" || item.status === "cancelled";
  const icon = occurrenceIcon(item);
  const linkLabel = item.link
    ? item.link.available
      ? [item.link.course_title, item.link.type !== "course" ? item.link.lesson_title ?? item.link.module_title : null].filter(Boolean).join(" › ")
      : "Conteúdo indisponível"
    : null;

  const actions: MenuAction[] = [
    { label: "Editar", icon: "edit", onSelect: () => handlers.onEdit(item) },
    { label: "Reagendar", icon: "calendar", onSelect: () => handlers.onReschedule(item), hidden: done },
    { label: "Abrir conteúdo", icon: "book", onSelect: () => handlers.onOpenLink(item), hidden: !item.link?.available },
    { label: "Informar tempo", icon: "clock", onSelect: () => handlers.onLogTime(item), hidden: !done || item.timer_seconds > 0 },
    { label: "Iniciar cronômetro do Foco", icon: "play", onSelect: () => handlers.onStart(item), hidden: !isToday || closed || item.focusing },
    { label: "Mover para cima", icon: "up", onSelect: () => move(-1), hidden: index <= 0, separatorBefore: true },
    { label: "Mover para baixo", icon: "down", onSelect: () => move(1), hidden: index < 0 || index >= movable.length - 1 },
    { label: "Pular", icon: "skip", onSelect: () => handlers.onSkip(item), hidden: closed || day === "future", separatorBefore: true },
    // Uma concluída de outro dia não pode ser concluída de novo, então também não é reaberta.
    { label: "Reabrir", icon: "rotate", onSelect: () => handlers.onReopen(item), hidden: !closed || (done && !isToday), separatorBefore: true },
    { label: "Cancelar neste dia", icon: "close", onSelect: () => handlers.onCancel(item), hidden: closed },
    { label: "Remover do dia", icon: "trash", onSelect: () => handlers.onRemove(item), danger: true, separatorBefore: true },
  ];

  return (
    <article
      id={`rt-item-${item.id}`}
      className={`rt-item is-${item.status} ${highlighted ? "is-highlighted" : ""} ${busy ? "is-busy" : ""}`}
      style={tone(occurrenceColor(item))}
      aria-label={`${item.title}, ${STATUS_LABEL[item.status]}`}
    >
      <div className="rt-item-time tabular" aria-hidden={!item.start_time}>
        {item.start_time ? (
          <>
            <span>{item.start_time}</span>
            {item.duration_minutes ? <small>{minutesLabel(item.duration_minutes)}</small> : null}
          </>
        ) : null}
      </div>
      <button
        type="button"
        className={`rt-node ${isToday ? "" : "is-locked"}`}
        onClick={() => isToday && handlers.onToggle(item)}
        aria-disabled={!isToday}
        aria-pressed={done}
        aria-label={
          !isToday
            ? `${item.title}: ${STATUS_LABEL[item.status]}. ${day === "future" ? "Só dá para concluir no dia." : "Dia encerrado."}`
            : closed
              ? `Reabrir ${item.title}`
              : `Concluir ${item.title}`
        }
        data-tip={!isToday ? (day === "future" ? "Conclua no dia" : "Dia encerrado") : done ? "Desfazer" : closed ? "Reabrir" : "Concluir"}
      >
        {STATUS_ICON[item.status] ? <Icon name={STATUS_ICON[item.status]!} size={14} weight="bold" /> : null}
      </button>
      <div className="rt-item-body">
        <div className="rt-item-head">
          {icon && <RoutineIcon name={icon} size={16} className="rt-item-icon" />}
          <h4 className="rt-item-title">
            <button type="button" onClick={() => handlers.onEdit(item)}>
              {item.title}
            </button>
          </h4>
          {item.is_optional && <span className="rt-item-tag">Opcional</span>}
          {item.priority === "high" && <span className="rt-item-tag is-high">Prioridade alta</span>}
        </div>
        <p className="rt-item-meta">
          {item.status !== "pending" && item.status !== "in_progress" && <span className="rt-item-state">{STATUS_LABEL[item.status]}</span>}
          {item.start_time && item.duration_minutes ? <span className="tabular rt-item-range">{timeRange(item)}</span> : null}
          {!item.start_time && item.duration_minutes ? <span>{minutesLabel(item.duration_minutes)}</span> : null}
          {invested > 0 && !session && (
            <span className="tabular rt-item-spent">
              {item.duration_minutes ? `${secondsLabel(invested)} de ${minutesLabel(item.duration_minutes)} · ${Math.round(share! * 100)}%` : `${secondsLabel(invested)} registrados`}
            </span>
          )}
          {item.routine && <span>{item.routine.name}</span>}
          {linkLabel && (
            <span className={`rt-item-link ${item.link?.available ? "" : "is-off"}`}>
              <Icon name={item.link?.available ? "book" : "alert"} size={13} />
              {linkLabel}
            </span>
          )}
          {item.rescheduled_from && <span>Reagendada</span>}
          {clashes.length > 0 && (
            <span className="rt-item-clash" data-tip={`Mesmo horário que ${clashes.map((c) => c.title).join(", ")}`} tabIndex={0}>
              <Icon name="warningCircle" size={13} />
              Horário sobreposto
            </span>
          )}
        </p>
        {item.skip_reason && <p className="rt-item-note">“{item.skip_reason}”</p>}
        {session && (
          <div className={`rt-timer ${session.paused ? "is-paused" : ""}`} role="timer" aria-live="off">
            <span className="rt-timer-clock tabular">{clock(sessionFocus)}</span>
            <span className="rt-timer-state">
              {session.paused ? "Pausado" : "Foco"}
              {item.duration_minutes ? ` · ${secondsLabel(invested)} de ${minutesLabel(item.duration_minutes)} (${Math.round(share! * 100)}%)` : ""}
            </span>
            {share != null && (
              <span className="rt-timer-bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${share})` }} />
              </span>
            )}
            <span className="rt-timer-actions">
              {session.paused ? (
                <button type="button" className="button button-sm button-soft" onClick={() => handlers.onSession("resume")}>
                  <Icon name="play" size={14} />
                  Retomar
                </button>
              ) : (
                <button type="button" className="button button-sm button-soft" onClick={() => handlers.onSession("pause")}>
                  <Icon name="pause" size={14} weight="fill" />
                  Pausar
                </button>
              )}
              <button type="button" className="button button-sm button-primary" onClick={() => handlers.onToggle(item)}>
                <Icon name="check" size={14} weight="bold" />
                Concluir
              </button>
              <button type="button" className="button button-sm button-ghost" onClick={() => handlers.onSession("stop")}>
                Parar
              </button>
            </span>
          </div>
        )}
      </div>
      <div className="rt-item-actions">
        {isToday && !item.focusing && (item.status === "pending" || item.status === "skipped") && (
          <button
            type="button"
            className="icon-button icon-button-sm rt-play"
            onClick={() => handlers.onStart(item)}
            aria-label={item.link?.available ? `Iniciar o Foco em ${item.title} e abrir o conteúdo` : `Iniciar o cronômetro do Foco em ${item.title}`}
            data-tip={item.link?.available ? "Iniciar Foco e abrir" : "Iniciar Foco"}
          >
            <Icon name="play" size={16} />
          </button>
        )}
        <Menu label={`Mais ações para ${item.title}`} actions={actions} />
      </div>
    </article>
  );
}
