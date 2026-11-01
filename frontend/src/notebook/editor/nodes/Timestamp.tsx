import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { formatStamp, parseStamp, stampProblem } from "../../time";
import { useEditorEnv } from "../env";
import { openTarget } from "../navigation";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    timestamp: {
      insertTimestamp: (seconds: number) => ReturnType;
    };
  }
}

/** Instante do vídeo dentro do texto. Clicar leva o player até ele. */
export const Timestamp = Node.create({
  name: "timestamp",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { seconds: { default: 0, parseHTML: (el) => Number(el.getAttribute("data-seconds")) || 0 } };
  },
  parseHTML() {
    return [{ tag: "span[data-timestamp]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-timestamp": "", "data-seconds": node.attrs.seconds }), formatStamp(node.attrs.seconds)];
  },
  renderText({ node }) {
    return formatStamp(node.attrs.seconds);
  },
  addCommands() {
    return {
      insertTimestamp:
        (seconds) =>
        ({ chain }) =>
          chain().insertContent([{ type: this.name, attrs: { seconds: Math.floor(seconds) } }, { type: "text", text: " " }]).run(),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(TimestampView, { as: "span", className: "ne-inline-host" });
  },
});

function TimestampView({ node, updateAttributes, deleteNode, selected, editor }: NodeViewProps) {
  const env = useEditorEnv();
  const seconds = node.attrs.seconds as number;
  const [editing, setEditing] = useState(false);
  const lesson = env.lesson;
  const outOfRange = !!(lesson?.duration && seconds > lesson.duration + 2);

  function go(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!lesson) return;
    openTarget({ courseId: lesson.courseId, kind: "lesson", lessonKey: lesson.lessonKey, seconds }, event.ctrlKey || event.metaKey);
  }

  const title = !lesson
    ? "Ligue a anotação a uma aula para este tempo levar ao vídeo"
    : outOfRange
      ? "Este tempo passa da duração do vídeo"
      : `Ir para ${formatStamp(seconds)} no vídeo (duplo clique para editar)`;

  return (
    <NodeViewWrapper as="span" className={`ne-stamp ${selected ? "is-selected" : ""} ${!lesson || outOfRange ? "is-muted" : ""}`}>
      {editing ? (
        <StampInput
          initial={seconds}
          duration={lesson?.duration}
          onDone={(value) => {
            setEditing(false);
            if (value !== null) updateAttributes({ seconds: value });
            editor.commands.focus();
          }}
          onRemove={() => deleteNode()}
        />
      ) : (
        <button
          type="button"
          className="ne-stamp-button"
          contentEditable={false}
          onClick={go}
          onDoubleClick={(e) => {
            e.preventDefault();
            if (editor.isEditable) setEditing(true);
          }}
          title={title}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
          </svg>
          {formatStamp(seconds)}
        </button>
      )}
    </NodeViewWrapper>
  );
}

/** Campo pequeno de tempo (mm:ss) com validação contra a duração. */
export function StampInput({
  initial,
  duration,
  onDone,
  onRemove,
  autoFocus = true,
}: {
  initial: number | null;
  duration?: number | null;
  onDone: (value: number | null) => void;
  onRemove?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(initial !== null ? formatStamp(initial) : "");
  const input = useRef<HTMLInputElement>(null);
  const parsed = parseStamp(text);
  const problem = text ? stampProblem(parsed, duration) : null;
  useEffect(() => {
    if (autoFocus) input.current?.select();
  }, [autoFocus]);

  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      if (!problem && parsed !== null) onDone(parsed);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDone(null);
    } else if ((e.key === "Backspace" || e.key === "Delete") && !text && onRemove) {
      e.preventDefault();
      onRemove();
    }
  }

  return (
    <span className="ne-stamp-edit" contentEditable={false}>
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => onDone(!problem && parsed !== null ? parsed : null)}
        aria-label="Tempo do vídeo (mm:ss)"
        aria-invalid={!!problem}
        placeholder="mm:ss"
        size={7}
      />
      {problem && <span className="ne-stamp-problem">{problem}</span>}
    </span>
  );
}
