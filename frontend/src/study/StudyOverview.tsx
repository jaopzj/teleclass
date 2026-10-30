import { CSSProperties, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import ProgressBar from "../components/ProgressBar";
import { formatPercent, plural } from "../format";
import { browserTimezone, StudyMetrics, studyApi } from "./api";
import { formatDelta, formatStudyTime, shortDate, timezoneLabel, weekdayName, weekdayShort } from "./format";
import { invalidateStudyMetrics, useStudyMetrics } from "./metricsStore";
import "./study.css";

/**
 * Painel "Seu estudo" da tela inicial. Só apresenta: todos os números vêm
 * prontos de /api/study/metrics (app/study/metrics.py).
 */
export default function StudyOverview() {
  const { data, error, loading } = useStudyMetrics();
  useTimezoneSetup(data);

  if (!data) {
    if (error && !loading) {
      return <div className="alert alert-error">Não foi possível carregar suas métricas de estudo: {error.message}</div>;
    }
    return (
      <section className="study" aria-busy="true" aria-label="Seu estudo">
        <div className="study-primary">
          {[0, 1, 2].map((i) => (
            <div key={i} className="study-card skeleton" />
          ))}
        </div>
      </section>
    );
  }

  const threshold = data.rules.active_day_seconds;
  const started = data.total.seconds > 0 || data.lessons.completed > 0;
  return (
    <section className="study" aria-labelledby="study-title">
      <header className="study-head">
        <div>
          <h2 id="study-title">Seu estudo</h2>
          <p className="muted">
            {started
              ? "Calculado a partir do tempo em que suas aulas estiveram tocando."
              : "Dê play numa aula: o tempo em que o vídeo estiver tocando aparece aqui."}
          </p>
        </div>
        <TimezoneNotice timezone={data.timezone} />
      </header>

      <div className="study-primary">
        <TodayCard metrics={data} threshold={threshold} />
        <WeekCard metrics={data} threshold={threshold} />
        <StreakCard metrics={data} threshold={threshold} />
      </div>

      <dl className="study-secondary">
        <AverageStat metrics={data} />
        <div className="study-stat">
          <dt>Aulas concluídas</dt>
          <dd className="study-stat-value">{data.lessons.completed.toLocaleString("pt-BR")}</dd>
          <dd className="study-stat-note">
            {data.lessons.completed_this_week > 0
              ? `+${data.lessons.completed_this_week.toLocaleString("pt-BR")} nesta semana`
              : "Nenhuma nesta semana"}
          </dd>
        </div>
        <CoursesStat metrics={data} />
      </dl>

      <p className="study-footnote">
        Conta só o tempo real de reprodução: pausas, carregamentos e vídeo parado ficam de fora, e assistir em 2× não
        dobra o tempo. Um dia entra na sequência com {formatStudyTime(threshold)} ou mais (a linha tracejada no gráfico). Dias pelo fuso de{" "}
        {timezoneLabel(data.timezone)}.
      </p>
    </section>
  );
}

// --- cartões principais ---------------------------------------------------------

function TodayCard({ metrics, threshold }: { metrics: StudyMetrics; threshold: number }) {
  const { seconds, active } = metrics.today;
  const missing = Math.max(0, threshold - seconds);
  return (
    <article className="study-card">
      <p className="study-label">
        <Icon name="clock" size={15} /> Hoje
      </p>
      <p className="study-value">{formatStudyTime(seconds)}</p>
      <div className="study-goal">
        <ProgressBar value={Math.min(100, (seconds / threshold) * 100)} size="sm" label="Mínimo do dia para a sequência" />
        <span className={active ? "is-done" : undefined}>
          {active ? (
            <>
              <Icon name="check" size={13} /> Dia ativo: conta na sequência
            </>
          ) : (
            `Faltam ${formatStudyTime(Math.max(60, missing))} para contar na sequência`
          )}
        </span>
      </div>
    </article>
  );
}

function WeekCard({ metrics, threshold }: { metrics: StudyMetrics; threshold: number }) {
  const { week } = metrics;
  const diff = week.seconds - week.previous_to_date_seconds;
  const scale = Math.max(threshold * 1.5, ...week.days.map((d) => d.seconds ?? 0));
  const [focused, setFocused] = useState<number | null>(null);
  return (
    <article className="study-card">
      <p className="study-label">
        <Icon name="calendar" size={15} /> Esta semana
      </p>
      <p className="study-value">{formatStudyTime(week.seconds)}</p>
      <p className="study-compare">
        {week.seconds === 0 && week.previous_to_date_seconds === 0 ? (
          <span className="muted">Segunda a domingo</span>
        ) : (
          <>
            <span className={diff > 0 ? "is-up" : diff < 0 ? "is-down" : undefined}>{diff === 0 ? "Igual" : formatDelta(diff)}</span>{" "}
            <span className="muted">vs. mesmo período da semana passada</span>
          </>
        )}
      </p>
      <div
        className="study-bars"
        role="list"
        aria-label="Tempo estudado por dia nesta semana"
        style={{ "--goal": `${(threshold / scale) * 100}%` } as CSSProperties}
      >
        {week.days.map((day, i) => {
          const future = day.seconds === null;
          const isToday = day.date === metrics.today.date;
          const label = `${weekdayName(i)}, ${shortDate(day.date)}: ${future ? "ainda não chegou" : formatStudyTime(day.seconds ?? 0)}`;
          return (
            <div
              key={day.date}
              role="listitem"
              tabIndex={0}
              aria-label={label}
              className={`study-bar ${isToday ? "is-today" : ""} ${future ? "is-future" : ""}`}
              onPointerEnter={() => setFocused(i)}
              onPointerLeave={() => setFocused(null)}
              onFocus={() => setFocused(i)}
              onBlur={() => setFocused(null)}
            >
              <span className="study-bar-track">
                {!future && (day.seconds ?? 0) > 0 && (
                  <span
                    className={`study-bar-fill ${day.active ? "is-active" : ""}`}
                    style={{ height: `${Math.max(4, ((day.seconds ?? 0) / scale) * 100)}%` }}
                  />
                )}
              </span>
              <span className="study-bar-day">{weekdayShort(i).charAt(0)}</span>
              {focused === i && (
                <span className="study-tip" role="tooltip">
                  <strong>{weekdayName(i)}</strong> {shortDate(day.date)}
                  <br />
                  {future ? "Ainda não chegou" : formatStudyTime(day.seconds ?? 0)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function StreakCard({ metrics, threshold }: { metrics: StudyMetrics; threshold: number }) {
  const { current, includes_today, best } = metrics.streak;
  let hint: string;
  if (includes_today) hint = "Hoje já conta.";
  else if (current > 0) hint = `Estude ${formatStudyTime(Math.max(60, threshold - metrics.today.seconds))} hoje para manter.`;
  else hint = `Comece hoje: ${formatStudyTime(threshold)} já contam.`;
  return (
    <article className="study-card">
      <p className="study-label">
        <Icon name="flame" size={15} /> Sequência
      </p>
      <p className="study-value">{plural(current, "dia", "dias")}</p>
      <p className="study-compare muted">
        {hint}
        {best > current && ` Recorde: ${plural(best, "dia", "dias")}.`}
      </p>
      <ol className="study-dots" aria-label="Dias ativos nesta semana">
        {metrics.week.days.map((day, i) => {
          const future = day.seconds === null;
          const isToday = day.date === metrics.today.date;
          return (
            <li
              key={day.date}
              className={`${day.active ? "is-active" : ""} ${isToday ? "is-today" : ""} ${future ? "is-future" : ""}`}
              aria-label={`${weekdayName(i)}: ${future ? "ainda não chegou" : day.active ? "dia ativo" : "sem o mínimo"}`}
            >
              <span className="study-dot">{day.active && <Icon name="check" size={12} />}</span>
              <span className="study-bar-day">{weekdayShort(i).charAt(0)}</span>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

// --- indicadores secundários ------------------------------------------------------

function AverageStat({ metrics }: { metrics: StudyMetrics }) {
  const avg = metrics.daily_average;
  return (
    <div className="study-stat">
      <dt>Média diária</dt>
      <dd className="study-stat-value">{avg ? formatStudyTime(avg.seconds_per_day) : "—"}</dd>
      <dd className="study-stat-note">
        {avg
          ? avg.days === 1
            ? "Com base em ontem"
            : `Nos últimos ${avg.days} dias completos`
          : "Aparece depois do seu primeiro dia completo de estudo"}
        {avg?.seconds_per_active_day != null && avg.active_days < avg.days && (
          <> · {formatStudyTime(avg.seconds_per_active_day)} por dia ativo</>
        )}
      </dd>
    </div>
  );
}

function CoursesStat({ metrics }: { metrics: StudyMetrics }) {
  const { courses } = metrics;
  return (
    <div className="study-stat">
      <dt>Progresso geral</dt>
      <dd className="study-stat-value">
        {courses.started ? formatPercent(courses.percent, courses.completed_lessons) : "—"}
      </dd>
      <dd className="study-stat-note">
        {courses.started ? (
          <>
            <ProgressBar value={courses.percent} size="sm" label="Progresso geral dos cursos iniciados" />
            {`${courses.completed_lessons} de ${plural(courses.total_lessons, "aula", "aulas")} em ${plural(
              courses.started,
              "curso iniciado",
              "cursos iniciados",
            )}`}
          </>
        ) : (
          "Nenhum curso iniciado"
        )}
      </dd>
    </div>
  );
}

// --- fuso horário -------------------------------------------------------------------

/** Sem fuso configurado (conta antiga): usa o do dispositivo, uma vez. */
function useTimezoneSetup(data: StudyMetrics | null) {
  const done = useRef(false);
  useEffect(() => {
    if (!data || data.timezone_configured || done.current) return;
    done.current = true;
    studyApi
      .setTimezone(browserTimezone())
      .then(invalidateStudyMetrics)
      .catch(() => {
        /* continua no padrão; tenta de novo na próxima visita */
      });
  }, [data]);
}

function TimezoneNotice({ timezone }: { timezone: string }) {
  const device = browserTimezone();
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (device === timezone || dismissed) return null;
  async function use() {
    setSaving(true);
    try {
      await studyApi.setTimezone(device);
      invalidateStudyMetrics();
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="study-tz" role="status">
      <span>
        Seus dias contam pelo fuso de <strong>{timezoneLabel(timezone)}</strong>, mas este dispositivo está em{" "}
        <strong>{timezoneLabel(device)}</strong>.
      </span>
      <span className="study-tz-actions">
        <button type="button" className="button button-sm" onClick={use} disabled={saving}>
          Usar {timezoneLabel(device)}
        </button>
        <button type="button" className="button button-sm button-ghost" onClick={() => setDismissed(true)}>
          Manter
        </button>
      </span>
    </div>
  );
}
