// Seletores da Minha Rotina: ícone (biblioteca pesquisável), cor (paleta
// controlada), dias da semana, duração e vínculo com curso, módulo ou aula.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../components/Icon";
import { useResource } from "../hooks/useResource";
import { CourseSection, learningApi } from "../learning/api";
import { useCourses } from "../learning/coursesStore";
import type { ContentLink, LinkInput, LinkType } from "./api";
import { WEEKDAY_INITIAL, WEEKDAY_LONG } from "./dates";
import { ICON_CATEGORIES, ICONS } from "./icons";
import { COLORS, RoutineIcon, tone } from "./parts";

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// --- ícone -----------------------------------------------------------------------------

export function IconPicker({ value, color, onChange }: { value: string | null; color: string | null; onChange: (key: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rt-iconpick">
      <button type="button" className="rt-iconpick-trigger" style={tone(color)} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="rt-tile">{value ? <RoutineIcon name={value} size={20} /> : <Icon name="plus" size={16} />}</span>
        <span>{value ? ICONS.get(value)?.label ?? "Ícone" : "Escolher ícone"}</span>
      </button>
      {open && (
        <IconDialog
          value={value}
          color={color}
          onClose={() => setOpen(false)}
          onPick={(key) => {
            onChange(key);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Biblioteca de ícones em modal: busca, categorias sempre visíveis e grade com nome. */
function IconDialog({ value, color, onPick, onClose }: { value: string | null; color: string | null; onPick: (key: string | null) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(() => ICON_CATEGORIES.find((c) => c.icons.some((i) => i.key === value))?.key ?? ICON_CATEGORIES[0].key);
  const search = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    search.current?.focus();
    // Captura na janela: o Esc fecha só este modal, não o painel que está por baixo.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return ICON_CATEGORIES.find((c) => c.key === category)!.icons;
    return ICON_CATEGORIES.flatMap((c) => c.icons).filter((i) => normalize(`${i.label} ${i.terms} ${i.key}`).includes(q));
  }, [query, category]);

  return createPortal(
    <div className="dialog-backdrop rt-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog rt-dialog rt-icondialog" role="dialog" aria-modal="true" aria-labelledby={titleId} style={tone(color)}>
        <div className="rt-icondialog-head">
          <h2 id={titleId}>Escolher ícone</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="rt-search">
          <Icon name="search" size={16} />
          <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar: academia, leitura, sono..." aria-label="Buscar ícone" />
        </div>
        <div className="rt-icondialog-main">
          <div className="rt-icondialog-cats" role="tablist" aria-label="Categorias" aria-orientation="vertical">
            {ICON_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={!query && c.key === category}
                className="rt-icondialog-cat"
                onClick={() => {
                  setQuery("");
                  setCategory(c.key);
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="rt-icongrid" role="listbox" aria-label={query ? "Resultados" : ICON_CATEGORIES.find((c) => c.key === category)!.label}>
            {results.map((i) => (
              <button
                key={i.key}
                type="button"
                role="option"
                className={`rt-iconcell ${i.key === value ? "is-selected" : ""}`}
                onClick={() => onPick(i.key)}
                aria-selected={i.key === value}
              >
                <RoutineIcon name={i.key} size={22} />
                <span>{i.label}</span>
              </button>
            ))}
            {!results.length && <p className="rt-muted rt-icongrid-empty">Nenhum ícone para “{query}”.</p>}
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" className="button button-ghost" onClick={() => onPick(null)}>
            Sem ícone
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// --- cor ---------------------------------------------------------------------------------

export function ColorPicker({ value, onChange, allowNone = true }: { value: string | null; onChange: (key: string | null) => void; allowNone?: boolean }) {
  return (
    <div className="rt-colors" role="radiogroup" aria-label="Cor">
      {allowNone && (
        <button type="button" role="radio" aria-checked={value === null} className="rt-swatch is-none" onClick={() => onChange(null)} data-tip="Padrão">
          <span className="sr-only">Cor padrão</span>
        </button>
      )}
      {COLORS.map((c) => (
        <button
          key={c.key}
          type="button"
          role="radio"
          aria-checked={value === c.key}
          className="rt-swatch"
          style={tone(c.key)}
          onClick={() => onChange(c.key)}
          data-tip={c.label}
        >
          <span className="sr-only">{c.label}</span>
        </button>
      ))}
    </div>
  );
}

// --- dias da semana ----------------------------------------------------------------------

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <div className="rt-weekdays" role="group" aria-label="Dias da semana">
      {WEEKDAY_INITIAL.map((initial, d) => (
        <button key={d} type="button" className="rt-weekday" aria-pressed={value.includes(d)} aria-label={WEEKDAY_LONG[d]} onClick={() => toggle(d)} data-tip={WEEKDAY_LONG[d]}>
          {initial}
        </button>
      ))}
    </div>
  );
}

// --- duração --------------------------------------------------------------------------------

const DURATIONS = [15, 30, 45, 60, 90];

export function DurationField({ value, onChange, id }: { value: number | null; onChange: (minutes: number | null) => void; id?: string }) {
  return (
    <div className="rt-duration">
      <div className="rt-chips" role="group" aria-label="Duração rápida">
        {DURATIONS.map((m) => (
          <button key={m} type="button" className="rt-chip" aria-pressed={value === m} onClick={() => onChange(value === m ? null : m)}>
            {m < 60 ? `${m} min` : m === 60 ? "1 h" : "1 h 30"}
          </button>
        ))}
      </div>
      <label className="rt-duration-custom">
        <input
          id={id}
          className="rt-input rt-input-num"
          type="number"
          inputMode="numeric"
          min={1}
          max={960}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value ? Math.max(1, Math.min(960, Number(e.target.value))) : null)}
          placeholder="—"
        />
        <span>min</span>
      </label>
    </div>
  );
}

// --- vínculo com curso, módulo ou aula --------------------------------------------------------

const LINK_TYPES: { key: LinkType; label: string }[] = [
  { key: "course", label: "Curso" },
  { key: "module", label: "Módulo" },
  { key: "lesson", label: "Aula" },
];

function flatten(sections: CourseSection[], depth = 0): { section: CourseSection; depth: number }[] {
  return sections.flatMap((s) => [{ section: s, depth }, ...flatten(s.children, depth + 1)]);
}

export function linkSummary(link: ContentLink | LinkInput | null, fallback?: string) {
  if (!link) return fallback ?? "";
  const l = link as ContentLink;
  if (l.available === false) return "Conteúdo indisponível";
  return [l.course_title, l.type !== "course" ? l.lesson_title ?? l.module_title : null].filter(Boolean).join(" › ");
}

/**
 * "Vincular conteúdo do Teleclass": tipo, curso, módulo e aula, com os dados
 * reais da biblioteca. Guarda só os identificadores; os títulos vêm do catálogo.
 */
export function ContentLinkPicker({ value, onChange }: { value: ContentLink | LinkInput | null; onChange: (link: LinkInput | null, label: ContentLink | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<LinkType>(value?.type ?? "lesson");
  const [courseId, setCourseId] = useState<string>(value?.course_id ?? "");
  const [sectionId, setSectionId] = useState<string>(value?.section_id ?? "");
  const [lessonKey, setLessonKey] = useState<string>(value?.lesson_key ?? "");
  const [query, setQuery] = useState("");
  const { data: courses, error } = useCourses();
  const course = useResource(`rt-course:${courseId}`, () => (courseId ? learningApi.course(courseId) : Promise.resolve(null)));
  const ids = useId();

  const sections = course.data ? flatten(course.data.sections) : [];
  const lessons = course.data
    ? sections.flatMap(({ section }) => section.lessons.map((l) => ({ lesson: l, section })))
    : [];
  const visibleLessons = lessons.filter(({ lesson }) => !query || normalize(lesson.title).includes(normalize(query)));
  const ready = !!courseId && (type === "course" || (type === "module" && !!sectionId) || (type === "lesson" && !!lessonKey));

  const confirm = () => {
    if (!ready || !course.data) return;
    const section = sections.find((s) => s.section.id === sectionId)?.section;
    const lesson = lessons.find((l) => l.lesson.key === lessonKey);
    const link: LinkInput = {
      type,
      course_id: courseId,
      section_id: type === "module" ? sectionId : type === "lesson" ? lesson?.section.id ?? null : null,
      lesson_key: type === "lesson" ? lessonKey : null,
    };
    onChange(link, {
      ...link,
      available: true,
      course_title: course.data.title,
      module_title: type === "module" ? section?.title ?? null : lesson?.section.title ?? null,
      lesson_title: type === "lesson" ? lesson?.lesson.title ?? null : null,
    });
    setEditing(false);
  };

  if (!editing) {
    return value ? (
      <div className={`rt-linkbox ${(value as ContentLink).available === false ? "is-off" : ""}`}>
        <Icon name={(value as ContentLink).available === false ? "alert" : "book"} size={18} />
        <span className="rt-linkbox-text">
          <small>{LINK_TYPES.find((t) => t.key === value.type)?.label}</small>
          {linkSummary(value, "Conteúdo vinculado")}
        </span>
        <button type="button" className="button button-sm button-ghost" onClick={() => setEditing(true)}>
          Trocar
        </button>
        <button type="button" className="icon-button icon-button-sm" aria-label="Remover vínculo" onClick={() => onChange(null, null)}>
          <Icon name="close" size={14} />
        </button>
      </div>
    ) : (
      <button type="button" className="button button-sm button-soft rt-linkbtn" onClick={() => setEditing(true)}>
        <Icon name="link" size={16} />
        Vincular conteúdo do Teleclass
      </button>
    );
  }

  return (
    <div className="rt-linkpick">
      <div className="rt-seg" role="radiogroup" aria-label="Tipo de vínculo">
        {LINK_TYPES.map((t) => (
          <button key={t.key} type="button" role="radio" aria-checked={type === t.key} onClick={() => setType(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <label className="rt-field">
        <span>Curso</span>
        <select
          className="rt-input"
          value={courseId}
          onChange={(e) => {
            setCourseId(e.target.value);
            setSectionId("");
            setLessonKey("");
          }}
        >
          <option value="">{courses ? (courses.length ? "Escolha um curso" : "Nenhum curso na biblioteca") : error ? "Não foi possível carregar" : "Carregando..."}</option>
          {courses?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      {courseId && type === "module" && (
        <label className="rt-field">
          <span>Módulo</span>
          <select className="rt-input" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!course.data}>
            <option value="">{course.data ? "Escolha um módulo" : "Carregando..."}</option>
            {sections.map(({ section, depth }) => (
              <option key={section.id} value={section.id}>
                {" ".repeat(depth)}
                {section.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {courseId && type === "lesson" && (
        <div className="rt-field">
          <label htmlFor={`${ids}-q`}>Aula</label>
          <div className="rt-search">
            <Icon name="search" size={16} />
            <input id={`${ids}-q`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar aula" />
          </div>
          <ul className="rt-lessonlist" role="listbox" aria-label="Aulas">
            {!course.data && <li className="rt-muted">Carregando aulas...</li>}
            {visibleLessons.slice(0, 200).map(({ lesson, section }) => (
              <li key={lesson.key}>
                <button type="button" role="option" aria-selected={lessonKey === lesson.key} onClick={() => setLessonKey(lesson.key)}>
                  <span className="tabular">{lesson.number}</span>
                  <span>
                    {lesson.title}
                    <small>{section.title}</small>
                  </span>
                </button>
              </li>
            ))}
            {course.data && !visibleLessons.length && <li className="rt-muted">Nenhuma aula encontrada.</li>}
          </ul>
        </div>
      )}
      {course.error && <p className="alert alert-error">Não foi possível abrir o curso.</p>}
      <div className="rt-linkpick-actions">
        <button type="button" className="button button-sm button-ghost" onClick={() => setEditing(false)}>
          Cancelar
        </button>
        <button type="button" className="button button-sm button-primary" onClick={confirm} disabled={!ready || !course.data}>
          Confirmar vínculo
        </button>
      </div>
    </div>
  );
}
