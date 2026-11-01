import { useEffect, useMemo, useState } from "react";
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
export default function TargetPicker({ value, onChange, idPrefix = "target" }: { value: TargetValue; onChange: (v: TargetValue) => void; idPrefix?: string }) {
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

  if (error) return <p className="muted small">Não foi possível carregar seus cursos ({error}). Você pode começar sem vincular.</p>;
  if (courses && courses.length === 0) return <p className="muted small">Colete um curso para vincular as sessões a ele.</p>;

  return (
    <div className="target-picker">
      <label className="sr-only" htmlFor={`${idPrefix}-course`}>
        Curso
      </label>
      <select
        id={`${idPrefix}-course`}
        className="select"
        value={value.courseId ?? ""}
        onChange={(e) => onChange({ courseId: e.target.value || null, lessonKey: null })}
        disabled={!courses}
      >
        <option value="">{courses ? "Sem curso vinculado" : "Carregando cursos..."}</option>
        {courses?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
      {value.courseId && (
        <>
          <label className="sr-only" htmlFor={`${idPrefix}-lesson`}>
            Aula
          </label>
          <select
            id={`${idPrefix}-lesson`}
            className="select"
            value={value.lessonKey ?? ""}
            onChange={(e) => onChange({ ...value, lessonKey: e.target.value || null })}
            disabled={!detail}
          >
            <option value="">{detail ? "Curso inteiro (sem aula específica)" : "Carregando aulas..."}</option>
            {groups.map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
