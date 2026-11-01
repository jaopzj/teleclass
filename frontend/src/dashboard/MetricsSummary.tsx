import ProgressBar from "../components/ProgressBar";
import { formatPercent, plural } from "../format";
import { StudyMetrics } from "../study/api";
import { formatStudyTime } from "../study/format";

/** Os três números da jornada: ritmo (média diária), entregas (aulas) e avanço (progresso geral). */
export default function MetricsSummary({ metrics }: { metrics: StudyMetrics }) {
  const { daily_average: average, lessons, courses } = metrics;
  return (
    <section className="surface metrics" aria-label="Resumo do estudo">
      <dl className="metrics-grid">
        <div className="metric">
          <dt className="metric-label">Média diária</dt>
          <dd className="metric-value">{average ? formatStudyTime(average.seconds_per_day) : "—"}</dd>
          <dd className="metric-note">
            {!average ? "Ainda sem dados" : average.days === 1 ? "Com base em ontem" : `Últimos ${average.days} dias`}
          </dd>
        </div>
        <div className="metric">
          <dt className="metric-label">Aulas concluídas</dt>
          <dd className="metric-value">{lessons.completed.toLocaleString("pt-BR")}</dd>
          <dd className="metric-note">
            {lessons.completed_this_week > 0
              ? `+${lessons.completed_this_week.toLocaleString("pt-BR")} essa semana`
              : "Nenhuma essa semana"}
          </dd>
        </div>
        <div className="metric">
          <dt className="metric-label">Progresso geral</dt>
          <dd className="metric-value">{formatPercent(courses.percent, courses.completed_lessons)}</dd>
          <dd className="metric-progress">
            <ProgressBar value={courses.percent} size="xs" label="Progresso geral dos cursos iniciados" />
          </dd>
          <dd className="metric-caption">
            {courses.started > 0
              ? `${courses.completed_lessons.toLocaleString("pt-BR")} de ${plural(courses.total_lessons, "aula", "aulas")} em ${plural(courses.started, "curso iniciado", "cursos iniciados")}`
              : "Nenhum curso iniciado ainda"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
