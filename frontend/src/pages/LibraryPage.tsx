import { useCallback, useLayoutEffect, useRef, useState } from "react";
import CourseCard, { CourseCardSkeleton } from "../components/CourseCard";
import Icon from "../components/Icon";
import ConfirmDialog from "../focus/ConfirmDialog";
import { plural } from "../format";
import { CourseCard as Course, learningApi } from "../learning/api";
import { forgetCourse, useCourses } from "../learning/coursesStore";
import { Link, paths } from "../router";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** "Meus cursos": a biblioteca inteira, com o mesmo cartão da tela inicial. */
export default function LibraryPage() {
  const { data: courses, error } = useCourses();
  const [pending, setPending] = useState<Course | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);

  // Os outros cartões deslizam para o lugar do excluído (FLIP).
  const slots = useRef(new Map<string, HTMLDivElement>());
  const before = useRef<Map<string, DOMRect> | null>(null);
  const focusAfter = useRef<string | null>(null);

  const slotRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) slots.current.set(id, el);
      else slots.current.delete(id);
    },
    [],
  );

  useLayoutEffect(() => {
    const rects = before.current;
    before.current = null;
    if (rects) {
      for (const [id, el] of slots.current) {
        const old = rects.get(id);
        if (!old) continue;
        const now = el.getBoundingClientRect();
        const dx = old.left - now.left;
        const dy = old.top - now.top;
        if (dx || dy) {
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
            duration: 360,
            easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          });
        }
      }
    }
    if (focusAfter.current !== null) {
      const next = focusAfter.current ? slots.current.get(focusAfter.current)?.querySelector<HTMLElement>(".ccard") : null;
      (next ?? document.querySelector<HTMLElement>(".library-head h1"))?.focus({ preventScroll: true });
      focusAfter.current = null;
    }
  }, [courses]);

  const finish = (id: string) => {
    const list = courses ?? [];
    const index = list.findIndex((c) => c.id === id);
    focusAfter.current = (list[index + 1] ?? list[index - 1])?.id ?? "";
    if (!reducedMotion()) {
      before.current = new Map([...slots.current].filter(([key]) => key !== id).map(([key, el]) => [key, el.getBoundingClientRect()]));
    }
    setLeaving(null);
    forgetCourse(id);
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setFailure(null);
    try {
      await learningApi.removeCourse(pending.id);
    } catch (e) {
      setFailure((e as Error).message || "Tente de novo em instantes.");
      setBusy(false);
      return;
    }
    const id = pending.id;
    setBusy(false);
    setPending(null);
    if (reducedMotion()) finish(id);
    else setLeaving(id);
  };

  const cancel = useCallback(() => {
    setPending(null);
    setFailure(null);
  }, []);

  return (
    <div className="page library">
      <header className="library-head">
        <div>
          <h1 className="section-title" tabIndex={-1}>
            Meus cursos
          </h1>
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
            <div
              key={course.id}
              ref={slotRef(course.id)}
              className={`ccard-slot${leaving === course.id ? " is-leaving" : ""}${pending?.id === course.id ? " is-pending" : ""}`}
              onAnimationEnd={(e) => e.target === e.currentTarget && leaving === course.id && finish(course.id)}
            >
              <CourseCard course={course} />
              <button
                type="button"
                className="ccard-remove"
                aria-label={`Excluir ${course.title}`}
                data-tip="Excluir curso"
                onClick={() => setPending(course)}
              >
                <Icon name="close" size={14} weight="bold" />
              </button>
            </div>
          ))}
        </div>
      )}

      {pending && (
        <ConfirmDialog
          title={`Excluir “${pending.title}”?`}
          confirmLabel="Excluir curso"
          danger
          busy={busy}
          onCancel={cancel}
          onConfirm={confirm}
        >
          <p>O curso sai da sua biblioteca e o progresso das aulas é apagado. Suas anotações continuam no Caderno.</p>
          <p className="muted">Para estudar de novo, é só adicionar o canal outra vez.</p>
          {failure && <p className="alert alert-error">Não foi possível excluir: {failure}</p>}
        </ConfirmDialog>
      )}
    </div>
  );
}
