// Visão geral do dia: como está o dia, quanto foi feito, o tempo investido, o que
// falta e a sequência. A faixa do dia mostra uma marca por atividade obrigatória,
// na ordem do dia, e cada conclusão preenche a sua.
import Icon from "../components/Icon";
import { plural } from "../format";
import type { DayDetail, Occurrence } from "./api";
import { relativeDay } from "./dates";
import { groupTimeline, nextActivity, secondsLabel, minutesLabel, STATUS_LABEL } from "./domain";
import { occurrenceColor, tone } from "./parts";
import { useFocus } from "../focus/store";
import { timeShare, useActivityTime } from "./focustime";

export default function Overview({
  data,
  nowMin,
  onStart,
  onFocus,
  compact = false,
}: {
  data: DayDetail;
  /** Minutos do relógio local quando o dia mostrado é hoje; senão null. */
  nowMin: number | null;
  onStart: (o: Occurrence) => void;
  onFocus: (o: Occurrence) => void;
  compact?: boolean;
}) {
  const { summary, streak, occurrences } = data;
  const isToday = data.date === data.today;
  const isPast = data.date < data.today;
  const { periods, unscheduled } = groupTimeline(occurrences);
  const ordered = [...periods.flatMap((p) => p.items), ...unscheduled].filter((o) => o.status !== "cancelled" && !o.is_optional);
  const next = isPast ? null : nextActivity(occurrences, nowMin);
  const noPlan = summary.planned === 0;
  const percent = summary.progress == null ? null : Math.round(summary.progress * 100);

  return (
    <section className={`rt-overview surface ${compact ? "is-compact" : ""}`} aria-label="Resumo do dia">
      <div className="rt-overview-main">
        <p className="rt-overview-line">{contextLine(data, next?.item ?? null, isToday, isPast)}</p>
        {noPlan ? (
          <p className="rt-noplan">{summary.optional_total ? "Só atividades opcionais neste dia." : "Sem planejamento"}</p>
        ) : (
          <div className="rt-strip-wrap">
            <ol className="rt-strip" aria-label={`${summary.completed} de ${summary.planned} atividades concluídas`}>
              {ordered.map((o) => (
                <li key={o.id} className={`rt-strip-seg is-${o.status}`} style={tone(occurrenceColor(o))}>
                  <button type="button" onClick={() => onFocus(o)} aria-label={`${o.title}: ${STATUS_LABEL[o.status]}`} />
                </li>
              ))}
            </ol>
            <span className="rt-strip-value tabular" aria-hidden="true">
              {percent}%
            </span>
          </div>
        )}
        <dl className="rt-stats">
          <div>
            <dt>Concluídas</dt>
            <dd className="tabular">
              {summary.completed}
              <small>/{summary.planned}</small>
            </dd>
          </div>
          <div>
            <dt>Restantes</dt>
            <dd className="tabular">{summary.remaining}</dd>
          </div>
          <div>
            <dt>Tempo investido</dt>
            <dd className="tabular">
              {secondsLabel(summary.invested_seconds)}
              {summary.planned_minutes > 0 && <small> de {minutesLabel(summary.planned_minutes)}</small>}
            </dd>
          </div>
          <div>
            <dt>Sequência</dt>
            <dd className="tabular" title={`Um dia conta quando você conclui pelo menos metade das atividades planejadas. Dias sem planejamento não interrompem.`}>
              <span className={`rt-streak ${streak.current ? "is-on" : ""}`}>
                <Icon name="flame" size={16} />
              </span>
              {plural(streak.current, "dia", "dias")}
            </dd>
          </div>
        </dl>
        {(summary.skipped > 0 || summary.optional_total > 0) && (
          <p className="rt-overview-foot">
            {summary.skipped > 0 && <span>{plural(summary.skipped, "pulada", "puladas")}</span>}
            {summary.optional_total > 0 && (
              <span>
                {summary.optional_completed} de {plural(summary.optional_total, "opcional", "opcionais")}
              </span>
            )}
          </p>
        )}
      </div>
      {!compact && next && <NextCard item={next.item} current={next.current} isToday={data.date === data.today} onStart={onStart} onFocus={onFocus} />}
      {!compact && !next && !noPlan && !isPast && (
        <div className="rt-next is-done">
          <span className="rt-next-icon">
            <Icon name="check" weight="bold" size={20} />
          </span>
          <div>
            <strong>Nada pendente {isToday ? "por hoje" : "neste dia"}</strong>
            <p>As atividades concluídas continuam na lista abaixo.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function contextLine(data: DayDetail, next: Occurrence | null, isToday: boolean, isPast: boolean) {
  const { summary } = data;
  const when = relativeDay(data.date, data.today);
  if (summary.planned === 0) return isPast ? `${when}: um dia livre.` : `${when}: dia livre até agora. Descansar também conta.`;
  if (isPast) return `${when}: ${summary.completed} de ${plural(summary.planned, "atividade feita", "atividades feitas")}.`;
  if (!summary.remaining) return `${when}: tudo o que estava planejado foi feito.`;
  if (isToday && next?.start_time) return `${plural(summary.remaining, "atividade", "atividades")} pela frente.`;
  return `${when}: ${plural(summary.remaining, "atividade pendente", "atividades pendentes")}.`;
}

function NextCard({
  item,
  current,
  isToday,
  onStart,
  onFocus,
}: {
  item: Occurrence;
  current: boolean;
  isToday: boolean;
  onStart: (o: Occurrence) => void;
  onFocus: (o: Occurrence) => void;
}) {
  const { session: focus } = useFocus();
  const { session: running, invested } = useActivityTime(item, focus);
  const share = timeShare(invested, item.duration_minutes);
  const label = item.status === "in_progress" ? "Em andamento" : current ? "Agora" : "A seguir";
  return (
    <div className="rt-next" style={tone(occurrenceColor(item))}>
      <span className="rt-next-label">
        {label}
        {item.start_time && item.status !== "in_progress" && <span className="tabular"> · {item.start_time}</span>}
      </span>
      <button type="button" className="rt-next-title" onClick={() => onFocus(item)}>
        {item.title}
      </button>
      <p className="rt-next-meta">
        {running ? (
          <span className="tabular">
            {secondsLabel(invested)}
            {item.duration_minutes ? ` de ${minutesLabel(item.duration_minutes)} · ${Math.round(share! * 100)}%` : " no Foco"}
          </span>
        ) : (
          <>
            {item.duration_minutes ? <span>{minutesLabel(item.duration_minutes)}</span> : null}
            {item.link && <span>{item.link.lesson_title ?? item.link.module_title ?? item.link.course_title ?? "Conteúdo indisponível"}</span>}
          </>
        )}
      </p>
      {isToday && item.status === "pending" && !item.focusing && (
        <button type="button" className="button button-primary button-sm" onClick={() => onStart(item)}>
          <Icon name="play" size={14} />
          {item.link?.available ? "Iniciar e abrir" : "Iniciar"}
        </button>
      )}
    </div>
  );
}
