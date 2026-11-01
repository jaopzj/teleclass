import CourseCard, { CourseCardSkeleton } from "../components/CourseCard";
import Icon from "../components/Icon";
import { plural } from "../format";
import { useCourses } from "../learning/coursesStore";
import { Link, paths } from "../router";

/** "Meus cursos": a biblioteca inteira, com o mesmo cartão da tela inicial. */
export default function LibraryPage() {
  const { data: courses, error } = useCourses();

  return (
    <div className="page library">
      <header className="library-head">
        <div>
          <h1 className="section-title">Meus cursos</h1>
          <p className="muted">
            {courses ? plural(courses.length, "curso na sua biblioteca", "cursos na sua biblioteca") : "Carregando seus cursos..."}
          </p>
        </div>
        {courses && courses.length > 0 && (
          <Link className="button button-primary" to={paths.indexing()}>
            <Icon name="plus" size={18} weight="bold" />
            Adicionar curso
          </Link>
        )}
      </header>

      {error && <div className="alert alert-error">Não foi possível carregar os cursos: {error.message}</div>}

      {!courses && !error && (
        <div className="library-grid">
          {[0, 1, 2, 3].map((i) => (
            <CourseCardSkeleton key={i} />
          ))}
        </div>
      )}

      {courses && courses.length === 0 && (
        <div className="empty">
          <span className="empty-icon">
            <Icon name="folderPlus" size={28} />
          </span>
          <h2>Nenhum curso por aqui ainda</h2>
          <p>Cole o link de um canal do Telegram e ele vira um curso organizado em módulos e aulas.</p>
          <Link className="button button-primary" to={paths.indexing()}>
            Adicionar curso
          </Link>
        </div>
      )}

      {courses && courses.length > 0 && (
        <div className="library-grid">
          {courses.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      )}
    </div>
  );
}
