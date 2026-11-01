import { ReactNode, useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import { CourseCard, CourseDetail, CourseSection, learningApi } from "../learning/api";

export interface TargetValue {
  courseId: string | null;
  lessonKey: string | null;
}

function flatten(sections: CourseSection[], path: string[] = []): { key: string; title: string; group: string }[] {
  return sections.flatMap((s) => [
    ...s.lessons.filter((l) => l.kind !== "unavailable").map((l) => ({ key: l.key, title: `${l.number}. ${l.title}`, group: [...path, s.title].join(" › ") })),
    ...flatten(s.children, [...path, s.title]),
  ]);
}

const courseCache = new Map<string, Promise<CourseDetail>>();

/** Vincula a sessão a um curso e, opcionalmente, a uma aula da biblioteca do usuário. */
export default function TargetPicker({
  value,
  onChange,
  idPrefix = "target",
  labelledBy,
}: {
  value: TargetValue;
  onChange: (v: TargetValue) => void;
  idPrefix?: string;
  labelledBy?: string;
}) {
  const [courses, setCourses] = useState<CourseCard[] | null>(null);
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    learningApi
      .courses()
      .then(setCourses)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    setDetail(null);
    if (!value.courseId) return;
    let active = true;
    let load = courseCache.get(value.courseId);
    if (!load) {
      load = learningApi.course(value.courseId);
      courseCache.set(value.courseId, load);
      load.catch(() => courseCache.delete(value.courseId as string));
    }
    load.then((d) => active && setDetail(d)).catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [value.courseId]);

  const lessons = useMemo(() => (detail ? flatten(detail.sections) : []), [detail]);
  const groups = useMemo(() => {
    const map = new Map<string, typeof lessons>();
    for (const l of lessons) map.set(l.group, [...(map.get(l.group) ?? []), l]);
    return [...map.entries()];
  }, [lessons]);

  if (error) return <p className="fx-hint">Não foi possível carregar seus cursos ({error}). Dá para começar sem vincular.</p>;
  if (courses && courses.length === 0) return <p className="fx-hint">Adicione um curso para vincular suas sessões a ele.</p>;

  return (
    <div className={`fx-target ${value.courseId ? "has-lesson" : ""}`} role="group" aria-labelledby={labelledBy}>
      <Select
        id={`${idPrefix}-course`}
        label="Curso"
        value={value.courseId ?? ""}
        onChange={(v) => onChange({ courseId: v || null, lessonKey: null })}
        disabled={!courses}
      >
        <option value="">{courses ? "Nenhum curso" : "Carregando cursos..."}</option>
        {courses?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </Select>
      {value.courseId && (
        <Select id={`${idPrefix}-lesson`} label="Aula" value={value.lessonKey ?? ""} onChange={(v) => onChange({ ...value, lessonKey: v || null })} disabled={!detail}>
          <option value="">{detail ? "Curso inteiro" : "Carregando aulas..."}</option>
          {groups.map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.title}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      )}
    </div>
  );
}

/** Seleção nativa (acessível e com a lista do sistema) no visual dos campos da plataforma. */
export function Select({
  id,
  label,
  value,
  onChange,
  disabled,
  children,
  hideLabel = true,
  small = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: ReactNode;
  hideLabel?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`fx-select ${small ? "is-small" : ""}`}>
      <label className={hideLabel ? "sr-only" : "fx-label"} htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input fx-input" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {children}
      </select>
      <Icon name="down" size={14} />
    </div>
  );
}
