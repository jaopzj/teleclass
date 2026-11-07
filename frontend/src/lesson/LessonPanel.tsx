// Painel ao lado do vídeo: o sumário do curso e as anotações da aula, em abas.
// As duas abas ficam montadas: trocar de aba não perde uma nota sendo escrita.
import { KeyboardEvent, lazy, Suspense, useCallback, useState } from "react";
import { CourseDetail } from "../learning/api";
import CourseOutline from "./CourseOutline";

// O editor das anotações carrega à parte, sem atrasar o vídeo.
const LessonNotes = lazy(() => import("../notebook/LessonNotes"));

export type PanelTab = "outline" | "notes";
const TAB_KEY = "teleclass:lesson-panel";

function loadTab(): PanelTab {
  try {
    return localStorage.getItem(TAB_KEY) === "notes" ? "notes" : "outline";
  } catch {
    return "outline";
  }
}

interface Props {
  course: CourseDetail | null;
  courseId: string;
  lessonKey: string;
  lessonTitle: string;
  duration: number | null;
  completed: boolean;
  playing: boolean;
}

export default function LessonPanel({ course, courseId, lessonKey, lessonTitle, duration, completed, playing }: Props) {
  const [tab, setTabState] = useState<PanelTab>(loadTab);
  const [count, setCount] = useState(0);
  const setTab = useCallback((next: PanelTab) => {
    setTabState(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* só uma preferência */
    }
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tab === "outline" ? "notes" : "outline";
    setTab(next);
    document.getElementById(`lv-tab-${next}`)?.focus();
  }

  return (
    <aside className="lv-panel" aria-label="Conteúdo do curso e anotações">
      <div className="lv-tabs" role="tablist" aria-label="Painel da aula" data-active={tab} onKeyDown={onKeyDown}>
        <span className="lv-tabs-thumb" aria-hidden="true" />
        <button
          type="button"
          role="tab"
          id="lv-tab-outline"
          aria-selected={tab === "outline"}
          aria-controls="lv-tabpanel-outline"
          tabIndex={tab === "outline" ? 0 : -1}
          onClick={() => setTab("outline")}
        >
          Aulas
        </button>
        <button
          type="button"
          role="tab"
          id="lv-tab-notes"
          aria-selected={tab === "notes"}
          aria-controls="lv-tabpanel-notes"
          tabIndex={tab === "notes" ? 0 : -1}
          onClick={() => setTab("notes")}
        >
          Anotações
          {count > 0 && <span className="lv-tab-count">{count}</span>}
        </button>
      </div>

      <div className="lv-tabpanel" role="tabpanel" id="lv-tabpanel-outline" aria-labelledby="lv-tab-outline" hidden={tab !== "outline"}>
        <CourseOutline course={course} currentKey={lessonKey} currentCompleted={completed} playing={playing} visible={tab === "outline"} />
      </div>
      <div className="lv-tabpanel" role="tabpanel" id="lv-tabpanel-notes" aria-labelledby="lv-tab-notes" hidden={tab !== "notes"}>
        <Suspense fallback={<div className="lv-notes-loading skeleton" />}>
          <LessonNotes courseId={courseId} lessonKey={lessonKey} lessonTitle={lessonTitle} duration={duration} onCount={setCount} />
        </Suspense>
      </div>
    </aside>
  );
}
