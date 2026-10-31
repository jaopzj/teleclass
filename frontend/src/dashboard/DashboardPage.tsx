import { displayName, useAuth } from "../auth/AuthProvider";
import { useCourses } from "../learning/coursesStore";
import { useStudyMetrics } from "../study/metricsStore";
import { TimezoneNotice, useTimezoneSetup } from "../study/timezone";
import MetricsSummary from "./MetricsSummary";
import RecentCourses from "./RecentCourses";
import StreakBanner from "./StreakBanner";
import StudyCalendar from "./StudyCalendar";
import WeekStats from "./WeekStats";
import "./dashboard.css";

/**
 * Tela inicial: onde a pessoa está (sequência e números), o que está estudando
 * (cursos recentes) e o ritmo (agenda e semana). Todos os números vêm de
 * /api/study/metrics e /api/courses; nada é calculado aqui.
 */
export default function DashboardPage() {
  const { state } = useAuth();
  const metrics = useStudyMetrics();
  const courses = useCourses();
  useTimezoneSetup(metrics.data);

  // Primeiro nome ("Diane"), como no Figma.
  const full = state.status === "authenticated" ? displayName(state.user, state.telegram) : "";
  const first = full.split(/\s+/)[0] ?? "";
  const name = first.charAt(0).toUpperCase() + first.slice(1);
  const data = metrics.data;

  return (
    <div className="dashboard-wrap">
    <div className="dashboard">
      <div className="dashboard-main">
        {data ? (
          <>
            <StreakBanner name={name} metrics={data} />
            <TimezoneNotice timezone={data.timezone} />
            <MetricsSummary metrics={data} />
          </>
        ) : metrics.error && !metrics.loading ? (
          <div className="alert alert-error dashboard-error" role="alert">
            <span>Não foi possível carregar suas métricas de estudo: {metrics.error.message}</span>
            <button type="button" className="button button-sm" onClick={metrics.reload}>
              Tentar de novo
            </button>
          </div>
        ) : (
          <>
            <div className="streak streak-skeleton skeleton" aria-hidden="true" />
            <div className="surface metrics skeleton" aria-hidden="true" />
          </>
        )}
        <RecentCourses courses={courses.data} error={courses.error} />
      </div>

      <aside className="dashboard-aside" aria-label="Agenda e estatísticas">
        {data ? (
          <>
            <StudyCalendar metrics={data} />
            <WeekStats metrics={data} />
          </>
        ) : (
          <>
            <div className="aside-skeleton" aria-hidden="true">
              <div className="skeleton-title skeleton" />
              <div className="surface calendar skeleton" />
            </div>
            <div className="aside-skeleton" aria-hidden="true">
              <div className="skeleton-title skeleton" />
              <div className="surface stats-card skeleton" />
            </div>
          </>
        )}
      </aside>
    </div>
    </div>
  );
}
