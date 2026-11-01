import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import { useResource } from "../hooks/useResource";
import { notify } from "../notifications/center";
import { Link, paths } from "../router";
import { focusApi, StartInput } from "./api";
import { duration, stageLabel } from "./derive";
import { FocusActionError, startSession, useFocus } from "./store";

/** Começar uma sessão vinculada à aula sem sair dela. */
export default function QuickStart({ courseId, lessonKey }: { courseId: string; lessonKey: string }) {
  const { session, busy } = useFocus();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { data } = useResource(open ? "focus-catalog" : "focus-catalog:idle", () => (open ? focusApi.catalog() : Promise.resolve(null)));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (session) {
    const here = session.course?.id === courseId && session.lesson?.key === lessonKey;
    return (
      <Link to={paths.focus()} className="quick-chip">
        <span className="quick-dot" /> {here ? "Sessão desta aula em andamento" : `Sessão em andamento · ${stageLabel(session.stage, session.paused)}`}
      </Link>
    );
  }

  async function go(input: Omit<StartInput, "course_id" | "lesson_key">) {
    try {
      await startSession({ ...input, course_id: courseId, lesson_key: lessonKey });
      setOpen(false);
      notify({ title: "Sessão iniciada", body: "O temporizador acompanha você no canto da tela.", tone: "focus" });
    } catch (e) {
      notify({ title: "Não foi possível iniciar", body: (e as FocusActionError).message, essential: true });
    }
  }

  const options: { key: string; label: string; detail: string; input: Omit<StartInput, "course_id" | "lesson_key"> }[] = data
    ? [
        ...data.presets
          .filter((p) => p.technique !== "custom")
          .map((p) => ({
            key: p.technique,
            label: p.technique === "deep_work" ? "Deep Work · 60 min" : p.name,
            detail: p.plan.focus_seconds == null ? "Sem duração definida" : `${duration(p.technique === "deep_work" ? 3600 : p.plan.focus_seconds)} de foco${p.plan.short_break_seconds ? ` · ${duration(p.plan.short_break_seconds)} de pausa` : ""}`,
            input: { technique: p.technique, focus_minutes: p.technique === "deep_work" ? 60 : null },
          })),
        ...data.methods.map((m) => ({
          key: m.id,
          label: m.name,
          detail: `${m.focus_minutes} min de foco · ${m.short_break_minutes} de pausa`,
          input: { technique: "custom" as const, method_id: m.id },
        })),
      ]
    : [];

  return (
    <div className="quick" ref={root}>
      <button type="button" className="button button-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="timer" size={15} /> Estudar com temporizador
      </button>
      {open && (
        <div className="quick-panel" role="dialog" aria-label="Iniciar sessão nesta aula">
          <p className="quick-title">Sessão vinculada a esta aula</p>
          {!data && <div className="skeleton" style={{ height: 120, borderRadius: 10 }} />}
          {options.map((o) => (
            <button key={o.key} type="button" className="quick-option" onClick={() => go(o.input)} disabled={busy === "start"}>
              <strong>{o.label}</strong>
              <span>{o.detail}</span>
            </button>
          ))}
          <Link to={`${paths.focus()}?curso=${encodeURIComponent(courseId)}&aula=${encodeURIComponent(lessonKey)}`} className="quick-more">
            Mais opções <Icon name="arrow" size={13} />
          </Link>
        </div>
      )}
    </div>
  );
}
