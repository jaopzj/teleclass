import CourseCard, { CourseCardSkeleton } from "../components/CourseCard";
import Icon from "../components/Icon";
import { CourseCard as Course } from "../learning/api";
import { Link, paths } from "../router";

const SHOWN = 3;

/** Os cursos estudados por último primeiro; completa com os ainda não iniciados. */
export function recentCourses(courses: Course[], count = SHOWN) {
  const watched = courses
    .filter((c) => c.progress.last_watched)
    .sort((a, b) => b.progress.last_watched!.watched_at.localeCompare(a.progress.last_watched!.watched_at));
  const rest = courses.filter((c) => !c.progress.last_watched);
  return [...watched, ...rest].slice(0, count);
}

export default function RecentCourses({ courses, error }: { courses: Course[] | null; error: Error | null }) {
  return (
    <section className="recent" aria-labelledby="recent-title">
      <div className="title-row">
        <h2 id="recent-title" className="section-title">
          Continuar de onde parou
        </h2>
        {courses && courses.length > SHOWN && (
          <Link to={paths.library()} className="section-link">
            Ver todos
            <Icon name="arrow" size={16} weight="bold" />
          </Link>
        )}
      </div>

      {error && !courses && <div className="alert alert-error">Não foi possível carregar seus cursos: {error.message}</div>}

      {!courses && !error && (
        <div className="recent-grid">
          {Array.from({ length: SHOWN }, (_, i) => (
            <CourseCardSkeleton key={i} />
          ))}
        </div>
      )}

      {courses && courses.length === 0 && (
        <div className="empty empty-compact">
          <span className="empty-icon">
            <Icon name="folderPlus" size={28} />
          </span>
          <h2>Adicione seu primeiro curso</h2>
          <p>Cole o link de um canal do Telegram e ele vira um curso organizado em módulos e aulas.</p>
          <Link className="button button-primary" to={paths.indexing()}>
            <Icon name="plus" size={18} weight="bold" />
            Adicionar curso
          </Link>
        </div>
      )}

      {courses && courses.length > 0 && (
        <div className="recent-grid">
          {recentCourses(courses).map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      )}
    </section>
  );
}
