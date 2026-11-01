import { useEffect, useMemo, useState } from "react";
import CourseCover, { coverStyle } from "../components/CourseCover";
import Icon from "../components/Icon";
import LessonStatusIcon, { lessonStatus, watchedPercent } from "../components/LessonStatus";
import LessonThumb from "../components/LessonThumb";
import ProgressBar from "../components/ProgressBar";
import { formatClock, formatDuration, formatPercent, formatRelative, plural } from "../format";
import { useResource } from "../hooks/useResource";
import { CourseDetail, CourseSection, LessonSummary, learningApi } from "../learning/api";
import { Link, paths } from "../router";

function containsLesson(section: CourseSection, key: string): boolean {
  return section.lessons.some((l) => l.key === key) || section.children.some((c) => containsLesson(c, key));
}

export default function CoursePage({ courseId }: { courseId: string }) {
  const { data: course, error } = useResource(`course:${courseId}`, () => learningApi.course(courseId));

  if (error) {
    return (
      <div className="page page-narrow">
        <div className="alert alert-error">
          {error.message === "Curso não encontrado" ? "Este curso não existe mais." : `Erro ao carregar o curso: ${error.message}`}
        </div>
        <Link to={paths.library()} className="button">
          <Icon name="back" size={16} /> Voltar para meus cursos
        </Link>
      </div>
    );
  }
  if (!course || course.id !== courseId) return <CourseSkeleton />;
  return <CourseView course={course} />;
}

function CourseSkeleton() {
  return (
    <div className="page page-narrow">
      <div className="course-hero skeleton" style={{ minHeight: 220 }} />
      <div className="skeleton" style={{ height: 64, marginTop: 24, borderRadius: 12 }} />
      <div className="skeleton" style={{ height: 64, marginTop: 12, borderRadius: 12 }} />
    </div>
  );
}

function CourseView({ course }: { course: CourseDetail }) {
  const { progress, stats } = course;
  const resume = progress.resume;
  const done = progress.total > 0 && progress.completed === progress.total;

  // `#modulo-2.1`: veio de uma referência do Caderno; abre o módulo e rola até ele.
  const anchor = typeof location !== "undefined" && location.hash.startsWith("#modulo-") ? decodeURIComponent(location.hash.slice(8)) : null;
  const initialOpen = useMemo(() => {
    if (anchor) return new Set([anchor.split(".")[0]]);
    const target = resume ? course.sections.find((s) => containsLesson(s, resume.key)) : course.sections[0];
    return new Set(target ? [target.id] : []);
  }, [course, resume, anchor]);
  useEffect(() => {
    if (!anchor) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(`modulo-${anchor}`);
      if (!el) return;
      el.scrollIntoView({ block: "start", behavior: "smooth" });
      el.classList.add("is-target");
      window.setTimeout(() => el.classList.remove("is-target"), 2200);
    }, 60);
    return () => window.clearTimeout(t);
  }, [anchor]);
  const [open, setOpen] = useState<Set<string>>(initialOpen);
  useEffect(() => {
    setOpen(initialOpen);
  }, [initialOpen]);

  const allOpen = open.size === course.sections.length;
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const cta = !progress.started ? "Começar o curso" : done ? "Rever a última aula" : "Continuar de onde parei";

  return (
    <div className="page page-narrow">
      <nav className="breadcrumb">
        <Link to={paths.library()}>Meus cursos</Link>
      </nav>

      <section className="course-hero" style={coverStyle(course.id)}>
        <div className="course-hero-main">
          <CourseCover id={course.id} className="cover-hero" />
          <div>
            <p className="eyebrow">Curso</p>
            <h1>{course.title}</h1>
            <p className="course-hero-meta">
              <span><Icon name="layers" size={15} /> {plural(stats.modules, "módulo", "módulos")}</span>
              <span><Icon name="play" size={13} /> {plural(stats.lessons, "aula", "aulas")}</span>
              {stats.duration > 0 && <span><Icon name="clock" size={15} /> {formatDuration(stats.duration)}</span>}
            </p>
          </div>
        </div>

        <aside className="learning-card" aria-label="Seu progresso">
          <div className="learning-card-top">
            <span className="learning-percent">{formatPercent(progress.percent, progress.completed)}</span>
            <span className="muted">
              {progress.completed} de {plural(progress.total, "aula concluída", "aulas concluídas")}
            </span>
          </div>
          <ProgressBar value={progress.percent} label="Progresso do curso" />
          {progress.last_watched ? (
            <div className="learning-last">
              <span className="muted small">Última aula assistida · {formatRelative(progress.last_watched.watched_at)}</span>
              <Link to={paths.lesson(course.id, progress.last_watched.key)} className="learning-last-title">
                {progress.last_watched.number}. {progress.last_watched.title}
              </Link>
              <span className="muted small">{progress.last_watched.path.join(" › ")}</span>
            </div>
          ) : (
            <p className="muted small learning-last">Você ainda não assistiu nenhuma aula deste curso.</p>
          )}
          {resume && (
            <Link to={paths.lesson(course.id, resume.key)} className="button button-primary button-block">
              <Icon name="play" size={14} />
              <span>
                {cta}
                {resume.position_seconds > 0 && !done && (
                  <span className="button-sub"> · {formatClock(resume.position_seconds)}</span>
                )}
              </span>
            </Link>
          )}
          {resume && progress.started && !done && resume.key !== progress.last_watched?.key && (
            <p className="muted small center">Próxima: {resume.number}. {resume.title}</p>
          )}
        </aside>
      </section>

      <section className="curriculum">
        <div className="curriculum-head">
          <h2>Conteúdo do curso</h2>
          <button
            className="button button-ghost button-sm"
            onClick={() => setOpen(allOpen ? new Set() : new Set(course.sections.map((s) => s.id)))}
          >
            {allOpen ? "Recolher tudo" : "Expandir tudo"}
          </button>
        </div>
        {course.sections.map((section, i) => (
          <ModuleView
            key={section.id}
            courseId={course.id}
            section={section}
            index={i + 1}
            open={open.has(section.id)}
            onToggle={() => toggle(section.id)}
            resumeKey={progress.started ? resume?.key : undefined}
            resumeIsLast={resume?.key === progress.last_watched?.key}
          />
        ))}
      </section>
    </div>
  );
}

function ModuleView({
  courseId,
  section,
  index,
  open,
  onToggle,
  resumeKey,
  resumeIsLast,
}: {
  courseId: string;
  section: CourseSection;
  index: number;
  open: boolean;
  onToggle: () => void;
  resumeKey?: string;
  resumeIsLast: boolean;
}) {
  const percent = section.total ? (section.completed / section.total) * 100 : 0;
  const complete = section.total > 0 && section.completed === section.total;
  return (
    <div className={`module ${open ? "is-open" : ""}`} id={`modulo-${section.id}`}>
      <button className="module-head" onClick={onToggle} aria-expanded={open}>
        <span className={`module-index ${complete ? "is-complete" : ""}`}>
          {complete ? <Icon name="check" size={16} /> : String(index).padStart(2, "0")}
        </span>
        <span className="module-title">
          <strong>{section.title}</strong>
          <span className="muted small">
            {section.completed}/{plural(section.total, "aula", "aulas")}
            {section.children.length > 0 && ` · ${plural(section.children.length, "subtópico", "subtópicos")}`}
          </span>
        </span>
        <span className="module-progress">
          <ProgressBar value={percent} size="sm" label={`Progresso de ${section.title}`} />
        </span>
        <Icon name="chevron" className="module-chevron" />
      </button>
      {open && (
        <div className="module-body">
          <SectionContent courseId={courseId} section={section} resumeKey={resumeKey} resumeIsLast={resumeIsLast} />
        </div>
      )}
    </div>
  );
}

function SectionContent({
  courseId,
  section,
  resumeKey,
  resumeIsLast,
}: {
  courseId: string;
  section: CourseSection;
  resumeKey?: string;
  resumeIsLast: boolean;
}) {
  return (
    <>
      {section.lessons.length > 0 && (
        <ol className="lesson-list">
          {section.lessons.map((lesson) => (
            <LessonRow
              key={lesson.key}
              courseId={courseId}
              lesson={lesson}
              resumeLabel={lesson.key !== resumeKey ? undefined : resumeIsLast ? "Você parou aqui" : "Próxima aula"}
            />
          ))}
        </ol>
      )}
      {section.children.map((child) => (
        <div key={child.id} className={`subtopic level-${Math.min(child.level, 4)}`} id={`modulo-${child.id}`}>
          <h3 className="subtopic-title">
            <span>{child.title}</span>
            <span className="muted small">
              {child.completed}/{child.total}
            </span>
          </h3>
          <SectionContent courseId={courseId} section={child} resumeKey={resumeKey} resumeIsLast={resumeIsLast} />
        </div>
      ))}
      {section.lessons.length === 0 && section.children.length === 0 && (
        <p className="muted small module-empty">Nenhuma aula neste módulo.</p>
      )}
    </>
  );
}

const KIND_LABEL: Record<LessonSummary["kind"], string> = {
  video: "Vídeo",
  file: "Arquivo",
  text: "Texto",
  unavailable: "Indisponível",
};

function LessonRow({ courseId, lesson, resumeLabel }: { courseId: string; lesson: LessonSummary; resumeLabel?: string }) {
  const status = lessonStatus(lesson.progress);
  const watched = watchedPercent(lesson.progress, lesson.duration);
  return (
    <li>
      <Link
        to={paths.lesson(courseId, lesson.key)}
        className={`lesson-row is-${status} ${resumeLabel ? "is-resume" : ""} ${lesson.kind === "unavailable" ? "is-unavailable" : ""}`}
      >
        <LessonThumb courseId={courseId} lesson={lesson} watched={status === "completed" ? 0 : watched} />
        <span className="lesson-row-text">
          <span className="lesson-row-title">
            <span className="lesson-number">{lesson.number}.</span> {lesson.title}
          </span>
          <span className="lesson-row-meta">
            {resumeLabel && <span className="pill pill-accent">{resumeLabel}</span>}
            {lesson.kind !== "video" && <span className="pill">{KIND_LABEL[lesson.kind]}</span>}
            {status === "in-progress" && lesson.progress && (
              <span>{formatClock(lesson.progress.position_seconds)} assistidos</span>
            )}
          </span>
        </span>
        <LessonStatusIcon status={status} percent={watched} />
      </Link>
    </li>
  );
}
