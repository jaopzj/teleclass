// Sumário do curso dentro da página da aula: progresso geral, módulos e aulas,
// com a aula atual destacada. Troca de aula sem voltar à página do curso.
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import LessonStatusIcon, { lessonStatus, watchedPercent } from "../components/LessonStatus";
import ProgressBar from "../components/ProgressBar";
import { formatClock } from "../format";
import { CourseDetail, CourseSection, LessonSummary } from "../learning/api";
import { Link, paths } from "../router";

function contains(section: CourseSection, key: string): boolean {
  return section.lessons.some((l) => l.key === key) || section.children.some((c) => contains(c, key));
}

/** Aplica a conclusão marcada agora na aula atual, antes de o servidor responder. */
function withCompletion(sections: CourseSection[], key: string, completed: boolean): CourseSection[] {
  return sections.map((s) => {
    if (!contains(s, key)) return s;
    const lessons = s.lessons.map((l) =>
      l.key === key && !!l.progress?.completed !== completed
        ? { ...l, progress: { position_seconds: 0, duration_seconds: null, completed_at: null, last_watched_at: null, ...l.progress, completed } }
        : l,
    );
    const children = withCompletion(s.children, key, completed);
    const done = lessons.filter((l) => l.progress?.completed).length + children.reduce((n, c) => n + c.completed, 0);
    return { ...s, lessons, children, completed: done };
  });
}

interface Props {
  course: CourseDetail | null;
  currentKey: string;
  currentCompleted: boolean;
  playing: boolean;
  /** A aba está visível: só então dá para rolar até a aula atual. */
  visible: boolean;
}

export default function CourseOutline({ course, currentKey, currentCompleted, playing, visible }: Props) {
  const sections = useMemo(
    () => (course ? withCompletion(course.sections, currentKey, currentCompleted) : []),
    [course, currentKey, currentCompleted],
  );
  const total = course?.progress.total ?? 0;
  const completed = sections.reduce((n, s) => n + s.completed, 0);
  const percent = total ? (completed / total) * 100 : 0;

  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !sections.length) return;
    seeded.current = true;
    const current = sections.find((s) => contains(s, currentKey));
    setOpen(new Set(current ? [current.id] : [sections[0].id]));
  }, [sections, currentKey]);

  // Leva a aula atual para o meio da lista (só dentro do painel, sem rolar a página).
  const scroller = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!visible || scrolled.current || !open.size) return;
    const box = scroller.current;
    const row = box?.querySelector<HTMLElement>(".lv-row.is-current");
    if (!box || !row) return;
    scrolled.current = true;
    // Espera o módulo terminar de abrir para a lista ter a altura final.
    const id = window.setTimeout(() => {
      const offset = row.getBoundingClientRect().top - box.getBoundingClientRect().top;
      box.scrollTop += offset - box.clientHeight / 2 + row.offsetHeight / 2;
    }, 220);
    return () => window.clearTimeout(id);
  }, [visible, open]);

  if (!course) {
    return (
      <div className="lv-outline">
        <div className="lv-outline-loading">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </div>
    );
  }

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="lv-outline">
      <div className="lv-course">
        <div className="lv-course-row">
          <span className="lv-course-count">
            <strong>{completed}</strong> de {total} aulas concluídas
          </span>
          <span className="lv-course-percent">{Math.round(percent)}%</span>
        </div>
        <ProgressBar value={percent} size="xs" label="Progresso do curso" />
      </div>

      <div className="lv-modules" ref={scroller}>
        {sections.map((section) => {
          const isOpen = open.has(section.id);
          const done = section.total > 0 && section.completed === section.total;
          const here = contains(section, currentKey);
          return (
            <section key={section.id} className={`lv-module ${isOpen ? "is-open" : ""} ${here ? "is-here" : ""}`}>
              <button type="button" className="lv-module-head" onClick={() => toggle(section.id)} aria-expanded={isOpen}>
                <span className="lv-module-text">
                  <span className="lv-module-title">{section.title}</span>
                  <span className="lv-module-meta">
                    {done ? (
                      <span className="lv-module-done">
                        <Icon name="check" size={13} weight="bold" /> Concluído
                      </span>
                    ) : (
                      `${section.completed} de ${section.total}`
                    )}
                  </span>
                </span>
                <Icon name="down" size={16} className="lv-module-chevron" />
              </button>
              <div className="lv-module-body">
                <div className="lv-module-inner">
                  <Lessons section={section} courseId={course.id} currentKey={currentKey} playing={playing} />
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Lessons({ section, courseId, currentKey, playing }: { section: CourseSection; courseId: string; currentKey: string; playing: boolean }) {
  return (
    <>
      {section.lessons.length > 0 && (
        <ol className="lv-rows">
          {section.lessons.map((lesson) => (
            <li key={lesson.key}>
              <Row lesson={lesson} courseId={courseId} current={lesson.key === currentKey} playing={playing} />
            </li>
          ))}
        </ol>
      )}
      {section.children.map((child) => (
        <div key={child.id} className="lv-sub">
          <p className="lv-sub-title">{child.title}</p>
          <Lessons section={child} courseId={courseId} currentKey={currentKey} playing={playing} />
        </div>
      ))}
    </>
  );
}

const KIND_META: Record<LessonSummary["kind"], string> = {
  video: "",
  file: "Arquivo",
  text: "Texto",
  unavailable: "Indisponível",
};

function Row({ lesson, courseId, current, playing }: { lesson: LessonSummary; courseId: string; current: boolean; playing: boolean }) {
  const status = lessonStatus(lesson.progress);
  const meta = lesson.kind === "video" ? (lesson.duration ? formatClock(lesson.duration) : "") : KIND_META[lesson.kind];
  return (
    <Link
      to={paths.lesson(courseId, lesson.key)}
      className={`lv-row ${current ? "is-current" : ""} is-${status} ${lesson.kind === "unavailable" ? "is-unavailable" : ""}`}
      aria-current={current ? "page" : undefined}
    >
      <span className="lv-row-status">
        {current ? (
          <span className={`lv-eq ${playing ? "is-playing" : ""}`} aria-label={playing ? "Tocando agora" : "Aula atual"}>
            <i />
            <i />
            <i />
          </span>
        ) : (
          <LessonStatusIcon status={status} percent={watchedPercent(lesson.progress, lesson.duration)} />
        )}
      </span>
      <span className="lv-row-title">{lesson.title}</span>
      {meta && <span className="lv-row-meta">{meta}</span>}
    </Link>
  );
}
