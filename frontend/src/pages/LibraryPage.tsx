import CourseCover from "../components/CourseCover";
import Icon from "../components/Icon";
import ProgressBar from "../components/ProgressBar";
import { formatDuration, formatPercent, formatRelative, plural } from "../format";
import { useResource } from "../hooks/useResource";
import { CourseCard, learningApi } from "../learning/api";
import { Link, paths } from "../router";
import StudyOverview from "../study/StudyOverview";

export default function LibraryPage() {
  const { data: courses, error, loading } = useResource("courses", learningApi.courses);

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div>
          <h1>Meus cursos</h1>
          <p className="muted">
            {courses ? plural(courses.length, "curso disponível", "cursos disponíveis") : "Carregando seus cursos..."}
          </p>
        </div>
      </header>

      {error && <div className="alert alert-error">Não foi possível carregar os cursos: {error.message}</div>}

      {courses && courses.length > 0 && <StudyOverview />}

      {loading && !courses && (
        <div className="library-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="course-card skeleton" />
          ))}
        </div>
      )}

      {courses && courses.length === 0 && (
        <div className="empty">
          <Icon name="library" size={32} />
          <h2>Nenhum curso por aqui ainda</h2>
          <p className="muted">Colete um canal do Telegram na tela de indexação e ele aparece nesta biblioteca.</p>
          <Link className="button button-primary" to={paths.indexing()}>
            Ir para a indexação
          </Link>
        </div>
      )}

      {courses && courses.length > 0 && (
        <>
          <h2 className="library-section-title">Cursos</h2>
          <div className="library-grid">
            {courses.map((course) => (
              <CourseCardView key={course.id} course={course} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CourseCardView({ course }: { course: CourseCard }) {
  const { stats, progress } = course;
  const done = progress.total > 0 && progress.completed === progress.total;
  return (
    <Link to={paths.course(course.id)} className="course-card">
      <div className="course-card-media">
        <CourseCover id={course.id} title={course.title} />
        {progress.started && (
          <span className="course-card-badge">{done ? "Concluído" : formatPercent(progress.percent, progress.completed)}</span>
        )}
      </div>
      <div className="course-card-body">
        <h2 className="course-card-title" title={course.title}>
          {course.title}
        </h2>
        <p className="course-card-meta">
          {plural(stats.modules, "módulo", "módulos")} · {plural(stats.lessons, "aula", "aulas")}
          {stats.duration > 0 && ` · ${formatDuration(stats.duration)}`}
        </p>
        <div className="course-card-progress">
          <ProgressBar value={progress.percent} size="sm" label="Progresso do curso" />
          <span>
            {progress.started
              ? `${progress.completed} de ${progress.total} concluídas`
              : "Não iniciado"}
          </span>
        </div>
        {progress.last_watched && !done && (
          <p className="course-card-resume">
            <Icon name="play" size={12} />
            <span>
              Continuar: <strong>{progress.resume?.title ?? progress.last_watched.title}</strong>
            </span>
            <span className="muted">{formatRelative(progress.last_watched.watched_at)}</span>
          </p>
        )}
      </div>
    </Link>
  );
}
