import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import { formatPercent, plural } from "../format";
import { useCourses } from "../learning/coursesStore";
import { navigate, paths } from "../router";

const MAX_RESULTS = 6;

/** Sem acentos e em minúsculas: "Programação" encontra "programacao". */
function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Busca do topo: encontra cursos da biblioteca pelo nome (lista já carregada,
 * sem pedido extra a cada tecla). "/" foca o campo de qualquer tela.
 */
export default function CourseSearch() {
  const { data: courses } = useCourses();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!q || !courses) return [];
    return courses.filter((c) => normalize(c.title).includes(q)).slice(0, MAX_RESULTS);
  }, [courses, query]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      e.preventDefault();
      input.current?.focus();
    };
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  function go(courseId: string) {
    setOpen(false);
    setQuery("");
    input.current?.blur();
    navigate(paths.course(courseId));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (query) setQuery("");
      else input.current?.blur();
      setOpen(false);
    } else if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active].id);
    }
  }

  const showList = open && query.trim().length > 0;
  return (
    <div className="search" ref={root} role="search">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Procurar cursos
      </label>
      <input
        ref={input}
        id={`${listId}-input`}
        className="search-input"
        type="search"
        placeholder="Procurar"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${results[active].id}` : undefined}
      />
      <Icon name="search" size={20} className="search-icon" />
      {showList && (
        <div className="menu search-menu">
          {results.length > 0 ? (
            <ul id={listId} role="listbox" aria-label="Cursos encontrados">
              {results.map((course, i) => (
                <li
                  key={course.id}
                  id={`${listId}-${course.id}`}
                  role="option"
                  aria-selected={i === active}
                  className="menu-item search-result"
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(course.id)}
                >
                  <Icon name="courses" size={20} />
                  <span className="search-result-text">
                    <span className="search-result-title">{course.title}</span>
                    <span className="search-result-meta">
                      {plural(course.stats.lessons, "aula", "aulas")}
                      {course.progress.started && ` · ${formatPercent(course.progress.percent, course.progress.completed)} concluído`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="search-empty" id={listId}>
              {courses ? "Nenhum curso com esse nome." : "Carregando seus cursos..."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
