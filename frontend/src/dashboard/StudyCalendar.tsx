import { useMemo, useState } from "react";
import Icon from "../components/Icon";
import { useResource } from "../hooks/useResource";
import { CalendarDay, StudyMetrics, studyApi } from "../study/api";
import { formatStudyTime } from "../study/format";
import { monthGrid, monthLabel, shiftMonth, WEEKDAY_INITIALS, WEEKDAY_NAMES } from "./dates";

/**
 * Agenda: o mês com os dias em que a pessoa estudou. Dia ativo (que conta para a
 * sequência) ganha o círculo azul-claro; hoje, o círculo cheio; dia com estudo
 * abaixo do mínimo, um ponto.
 */
export default function StudyCalendar({ metrics }: { metrics: StudyMetrics }) {
  const currentMonth = metrics.today.date.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const firstMonth = (metrics.total.first_day ?? metrics.today.date).slice(0, 7);
  // O mês atual recarrega junto com as métricas (generated_at muda quando algo é creditado).
  const key = month === currentMonth ? `${month}@${metrics.generated_at}` : month;
  const { data, error } = useResource(`calendar:${key}`, () => studyApi.calendar(month));
  const days = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    if (data?.month === month) data.days.forEach((d) => map.set(d.date, d));
    return map;
  }, [data, month]);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const loading = data?.month !== month && !error;
  const threshold = formatStudyTime(metrics.rules.active_day_seconds);
  const title = monthLabel(month, Number(currentMonth.slice(0, 4)));

  return (
    <section className="agenda" aria-labelledby="agenda-title">
      <h2 id="agenda-title" className="section-title">
        Agenda
      </h2>
      <div className="surface calendar">
        <div className="calendar-head">
          <button
            type="button"
            className="icon-button"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            disabled={month <= firstMonth}
            aria-label="Mês anterior"
          >
            <Icon name="left" size={24} />
          </button>
          <h3 className="calendar-month" aria-live="polite">
            {title}
          </h3>
          <button
            type="button"
            className="icon-button"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            disabled={month >= currentMonth}
            aria-label="Próximo mês"
          >
            <Icon name="right" size={24} />
          </button>
        </div>

        <table className={`calendar-grid ${loading ? "is-loading" : ""}`} aria-label={`Dias de estudo em ${title}`}>
          <thead>
            <tr>
              {WEEKDAY_INITIALS.map((letter, i) => (
                <th key={i} scope="col" abbr={WEEKDAY_NAMES[i]}>
                  {letter}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, w) => (
              <tr key={w}>
                {week.map((date, i) => (
                  <td key={i}>{date && <Day date={date} info={days.get(date)} today={metrics.today.date} />}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {error ? (
          <p className="calendar-note is-error">Não foi possível carregar este mês.</p>
        ) : (
          <p className="calendar-note">
            <span className="calendar-key is-active" aria-hidden="true" /> Dia com {threshold} ou mais de estudo
          </p>
        )}
      </div>
    </section>
  );
}

function Day({ date, info, today }: { date: string; info: CalendarDay | undefined; today: string }) {
  const day = Number(date.slice(8));
  const seconds = info?.seconds ?? 0;
  const state = date === today ? "is-today" : date > today ? "is-future" : info?.active ? "is-active" : seconds > 0 ? "is-studied" : "";
  const tip = date > today ? undefined : seconds > 0 ? `${formatStudyTime(seconds)} de estudo` : "Sem estudo";
  return (
    <span className={`calendar-day ${state} ${info?.active ? "has-goal" : ""}`} data-tip={tip} tabIndex={tip ? 0 : undefined}>
      <span aria-hidden="true">{day}</span>
      <span className="sr-only">
        {day}
        {tip && `: ${tip}`}
        {date === today && " (hoje)"}
      </span>
    </span>
  );
}
