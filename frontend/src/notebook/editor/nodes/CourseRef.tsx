import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { useState } from "react";
import { formatStamp } from "../../time";
import { refKey, useEditorEnv } from "../env";
import { openTarget, targetHref } from "../navigation";
import { StampInput } from "./Timestamp";

export interface CourseRefAttrs {
  courseId: string;
  kind: "course" | "section" | "lesson";
  sectionId: string | null;
  lessonKey: string | null;
  seconds: number | null;
  label: string;
  /** Duração da aula quando a referência foi criada (só para validar o tempo no editor). */
  duration?: number | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    courseRef: {
      insertCourseRef: (attrs: CourseRefAttrs) => ReturnType;
    };
  }
}

const KIND_LABEL = { course: "Curso", section: "Módulo", lesson: "Aula" } as const;

/** Referência "@" a um curso, módulo ou aula, opcionalmente com um instante do vídeo. */
export const CourseRef = Node.create({
  name: "courseRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      courseId: { default: "" },
      kind: { default: "lesson" },
      sectionId: { default: null },
      lessonKey: { default: null },
      seconds: { default: null },
      label: { default: "" },
      duration: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "a[data-course-ref]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as CourseRefAttrs;
    return ["a", mergeAttributes(HTMLAttributes, { "data-course-ref": "", href: targetHref(a) }), `@${a.label}${a.seconds != null ? ` ${formatStamp(a.seconds)}` : ""}`];
  },
  renderText({ node }) {
    const a = node.attrs as CourseRefAttrs;
    return `@${a.label}${a.seconds != null ? ` [${formatStamp(a.seconds)}]` : ""}`;
  },
  addCommands() {
    return {
      insertCourseRef:
        (attrs) =>
        ({ chain }) =>
          chain().insertContent([{ type: this.name, attrs }, { type: "text", text: " " }]).run(),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CourseRefView, { as: "span", className: "ne-inline-host" });
  },
});

function RefIcon({ kind }: { kind: CourseRefAttrs["kind"] }) {
  const d =
    kind === "course"
      ? "M4 5h4v14H4zM10 5h4v14h-4zM16.5 5.5l3.6.9-3.3 13.6-3.6-.9z"
      : kind === "section"
        ? "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"
        : "M7 4.5v15l12-7.5z";
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill={kind === "lesson" ? "currentColor" : "none"} stroke={kind === "lesson" ? "none" : "currentColor"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function CourseRefView({ node, updateAttributes, deleteNode, selected, editor }: NodeViewProps) {
  const env = useEditorEnv();
  const a = node.attrs as CourseRefAttrs;
  const resolved = env.refs.find((r) => refKey(r) === refKey(a));
  const status = resolved?.status ?? "ok";
  const duration = resolved?.duration ?? a.duration ?? null;
  const [editingTime, setEditingTime] = useState(false);
  const broken = status === "missing_course" || status === "missing_target";
  const problem =
    status === "missing_course"
      ? "Este curso não está mais na sua biblioteca"
      : status === "missing_target"
        ? `${KIND_LABEL[a.kind]} não encontrada no curso`
        : status === "out_of_range"
          ? "O tempo passa da duração do vídeo"
          : null;
  // Título atual da aula (se foi renomeada na reindexação) com o rótulo salvo como reserva.
  const current = resolved?.lesson_title ?? resolved?.section_title ?? (a.kind === "course" ? resolved?.course_title : null);
  const label = current && a.kind !== "course" && resolved?.course_title ? `${resolved.course_title} › ${current}` : current ?? a.label;

  function open(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (broken) return;
    openTarget(a, event.ctrlKey || event.metaKey);
  }

  const editable = editor.isEditable;
  return (
    <NodeViewWrapper as="span" className={`ne-ref is-${a.kind} ${selected ? "is-selected" : ""} ${problem ? "has-problem" : ""} ${broken ? "is-broken" : ""}`} data-drag-handle>
      <a href={broken ? undefined : targetHref(a)} className="ne-ref-link" onClick={open} contentEditable={false} title={problem ?? `Abrir ${KIND_LABEL[a.kind].toLowerCase()}${a.seconds != null ? ` em ${formatStamp(a.seconds)}` : ""}`}>
        <RefIcon kind={a.kind} />
        <span className="ne-ref-label">{label}</span>
        {a.seconds != null && !editingTime && <span className="ne-ref-time">{formatStamp(a.seconds)}</span>}
      </a>
      {editingTime && (
        <StampInput
          initial={a.seconds}
          duration={duration}
          onDone={(value) => {
            setEditingTime(false);
            if (value !== null) updateAttributes({ seconds: value });
            editor.commands.focus();
          }}
          onRemove={() => {
            setEditingTime(false);
            updateAttributes({ seconds: null });
          }}
        />
      )}
      {selected && editable && !editingTime && (
        <span className="ne-ref-tools" contentEditable={false}>
          {problem && <span className="ne-ref-problem">{problem}</span>}
          {a.kind === "lesson" && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setEditingTime(true)}>
              {a.seconds != null ? "Editar tempo" : "Adicionar tempo"}
            </button>
          )}
          {a.kind === "lesson" && a.seconds != null && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => updateAttributes({ seconds: null })}>
              Tirar tempo
            </button>
          )}
          <button type="button" className="is-danger" onMouseDown={(e) => e.preventDefault()} onClick={() => deleteNode()}>
            Remover
          </button>
        </span>
      )}
    </NodeViewWrapper>
  );
}
