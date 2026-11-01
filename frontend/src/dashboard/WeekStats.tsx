import { CSSProperties } from "react";
import ProgressBar from "../components/ProgressBar";
import { StudyMetrics } from "../study/api";
import { formatDelta, formatStudyTime } from "../study/format";
import { WEEKDAY_INITIALS, WEEKDAY_NAMES } from "./dates";

/**
 * Estatísticas da semana (segunda a domingo): uma barra por dia, o total da
 * semana comparado ao mesmo ponto da anterior e quanto falta para hoje contar.
 */
export default function WeekStats({ metrics }: { metrics: StudyMetrics }) {
  const { week, today, rules } = metrics;
  const threshold = rules.active_day_seconds;
  // A escala nunca é menor que o mínimo do dia: uma semana fraca não parece cheia.
  const peak = Math.max(threshold, ...week.days.map((d) => d.seconds ?? 0));
  const delta = week.seconds - week.previous_to_date_seconds;
  const todayLeft = Math.max(0, threshold - today.seconds);

  return (
    <section className="stats" aria-labelledby="stats-title">
      <h2 id="stats-title" className="section-title">
        Estatísticas
      </h2>
      <div className="surface stats-card">
        <ol className="week-chart" aria-label="Tempo de estudo por dia nesta semana">
          {week.days.map((day, i) => {
            const seconds = day.seconds ?? 0;
            const isToday = day.date === today.date;
            const tone = day.seconds === null ? "is-future" : isToday ? "is-today" : day.active ? "is-active" : seconds > 0 ? "is-low" : "is-empty";
            const label = day.seconds === null ? "ainda não chegou" : seconds > 0 ? formatStudyTime(seconds) : "sem estudo";
            return (
              <li
                key={day.date}
                className={`week-day ${tone}`}
                style={{ "--i": i } as CSSProperties}
                data-tip={day.seconds === null ? undefined : label}
              >
                <span className="week-letter" aria-hidden="true">
                  {WEEKDAY_INITIALS[i]}
                </span>
                <span className="week-bar" style={{ "--h": `${(seconds / peak) * 100}%` } as CSSProperties} aria-hidden="true" />
                <span className="sr-only">
                  {WEEKDAY_NAMES[i]}
                  {isToday && " (hoje)"}: {label}
                </span>
              </li>
            );
          })}
        </ol>

        {/* Resumo em três colunas: cabe ao lado da agenda sem alongar a página. */}
        <dl className="stats-summary">
          <div className="stats-cell">
            <dt>Esta semana</dt>
            <dd className="stats-value">{formatStudyTime(week.seconds)}</dd>
            {(week.seconds > 0 || week.previous_to_date_seconds > 0) && (
              <dd className={`stats-delta ${delta >= 0 ? "is-up" : "is-down"}`} title="Em relação ao mesmo ponto da semana passada">
                {formatDelta(delta)}
                <span className="sr-only"> em relação à semana passada</span>
              </dd>
            )}
          </div>
          <div className="stats-cell">
            <dt>Hoje</dt>
            <dd className="stats-value">{formatStudyTime(today.seconds)}</dd>
            <dd className="stats-progress" title={today.active ? "Dia já conta para a sequência" : `Faltam ${formatStudyTime(todayLeft)} para o dia contar`}>
              <ProgressBar value={(today.seconds / threshold) * 100} size="xs" label="Mínimo do dia para a sequência" />
              <span className="sr-only">
                {today.active ? "Dia já conta para a sequência" : `Faltam ${formatStudyTime(todayLeft)} para o dia contar`}
              </span>
            </dd>
          </div>
          <div className="stats-cell">
            <dt>Melhor sequência</dt>
            <dd className="stats-value">
              {metrics.streak.best} {metrics.streak.best === 1 ? "dia" : "dias"}
            </dd>
          </div>
        </dl>

        <ul className="stats-legend" aria-label="Legenda do gráfico">
          <li>
            <span className="legend-dot is-active" /> {formatStudyTime(threshold)} ou mais
          </li>
          <li>
            <span className="legend-dot is-low" /> Menos de {formatStudyTime(threshold)}
          </li>
          <li>
            <span className="legend-dot is-today" /> Hoje
          </li>
        </ul>
      </div>
    </section>
  );
}
