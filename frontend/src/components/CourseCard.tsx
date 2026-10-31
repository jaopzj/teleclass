import { CSSProperties } from "react";
import { compactDuration, formatPercent, plural } from "../format";
import { CourseCard as Course } from "../learning/api";
import { Link, paths } from "../router";
import { initials } from "./CourseCover";
import Icon from "./Icon";
import ProgressBar from "./ProgressBar";
import "./course-card.css";

/** Leve variação do azul da capa por curso (estável entre visitas), dentro da paleta. */
function coverTint(id: string): CSSProperties {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return { "--cover-shift": `${(h % 5) * 6 - 12}deg` } as CSSProperties;
}

/**
 * Cartão de curso da identidade (Figma: "Cursos recentes"). Leva à aula onde a
 * pessoa parou, ou à página do curso se ainda não começou.
 */
export default function CourseCard({ course }: { course: Course }) {
  const { stats, progress } = course;
  const done = progress.total > 0 && progress.completed === progress.total;
  const resume = !done && progress.resume;
  const to = resume ? paths.lesson(course.id, resume.key, resume.position_seconds) : paths.course(course.id);
  const label = done ? "Concluído" : resume ? `Continuar: ${resume.title}` : "Começar curso";

  return (
    <Link to={to} className="ccard" aria-label={`${course.title}. ${label}`}>
      <div className="ccard-cover" style={coverTint(course.id)} aria-hidden="true">
        <span className="ccard-initials">{initials(course.title)}</span>
        <span className="ccard-action">
          <Icon name={done ? "check" : "play"} size={18} weight={done ? "bold" : "fill"} />
        </span>
      </div>
      <div className="ccard-body">
        <h3 className="ccard-title" title={course.title}>
          {course.title}
        </h3>
        <p className="ccard-meta">
          {plural(stats.modules, "módulo", "módulos")} e {plural(stats.lessons, "aula", "aulas")}
        </p>
        <div className="ccard-progress">
          <ProgressBar value={progress.percent} size="lg" label={`Progresso de ${course.title}`} />
          <div className="ccard-progress-foot">
            <span>{stats.duration > 0 ? compactDuration(stats.duration) : plural(stats.video_lessons, "vídeo", "vídeos")}</span>
            <span>
              {done ? (
                <strong>Concluído</strong>
              ) : (
                <>
                  Completo: <strong>{formatPercent(progress.percent, progress.completed)}</strong>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function CourseCardSkeleton() {
  return <div className="ccard ccard-skeleton skeleton" aria-hidden="true" />;
}
