import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import { NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    math: {
      insertMath: (display: boolean, latex?: string) => ReturnType;
    };
  }
}

function render(latex: string, display: boolean) {
  try {
    return { html: katex.renderToString(latex || "\\square", { displayMode: display, throwOnError: true, strict: "ignore", trust: false, maxSize: 50, maxExpand: 500 }), error: null };
  } catch (e) {
    return { html: "", error: (e as Error).message.replace(/^KaTeX parse error: /, "") };
  }
}

function MathView({ node, updateAttributes, deleteNode, selected, editor, getPos }: NodeViewProps) {
  const display = node.type.name === "mathBlock";
  const latex = node.attrs.latex as string;
  const [editing, setEditing] = useState(!latex && editor.isEditable);
  const [draft, setDraft] = useState(latex);
  const field = useRef<HTMLTextAreaElement>(null);
  const preview = useMemo(() => render(editing ? draft : latex, display), [editing, draft, latex, display]);

  useEffect(() => {
    if (editing) {
      done.current = false;
      setDraft(latex);
      requestAnimationFrame(() => field.current?.focus());
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = useRef(false);
  function commit() {
    // Enter e o blur que vem logo depois chamariam duas vezes.
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (!draft.trim()) {
      deleteNode();
      return;
    }
    updateAttributes({ latex: draft.trim() });
    // Cursor logo depois da fórmula, para continuar escrevendo.
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") return;
    const after = Math.min(pos + node.nodeSize, editor.state.doc.content.size);
    if (display) editor.chain().focus().setNodeSelection(pos).createParagraphNear().run();
    else editor.chain().focus().setTextSelection(after).run();
  }

  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (!latex) deleteNode();
      else setEditing(false);
      editor.commands.focus();
    } else if (e.key === "Enter" && (!display || e.ctrlKey || e.metaKey)) {
      // Na fórmula do texto, Enter conclui; na fórmula em destaque, Enter quebra a linha.
      e.preventDefault();
      commit();
    }
  }

  const Tag = display ? "div" : "span";
  return (
    <NodeViewWrapper as={Tag} className={`ne-math ${display ? "is-block" : "is-inline"} ${selected ? "is-selected" : ""} ${preview.error && !editing ? "has-error" : ""}`}>
      <Tag
        className="ne-math-render"
        contentEditable={false}
        onDoubleClick={() => editor.isEditable && setEditing(true)}
        onClick={() => display && editor.isEditable && selected && setEditing(true)}
        title={editor.isEditable ? "Duplo clique para editar a fórmula" : latex}
        dangerouslySetInnerHTML={preview.error ? undefined : { __html: preview.html }}
      >
        {preview.error ? <code>{(editing ? draft : latex) || "fórmula vazia"}</code> : undefined}
      </Tag>
      {editing && (
        <Tag className="ne-math-editor" contentEditable={false}>
          <textarea
            ref={field}
            value={draft}
            rows={display ? Math.min(8, Math.max(2, draft.split("\n").length)) : 1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
            spellCheck={false}
            placeholder={display ? "\\int_0^1 x^2\\,dx" : "x^2 + y^2 = r^2"}
            aria-label="Fórmula em LaTeX"
          />
          <span className="ne-math-hint">
            {preview.error ? <span className="is-error">{preview.error}</span> : display ? "LaTeX · Ctrl+Enter para concluir" : "LaTeX · Enter para concluir"}
          </span>
        </Tag>
      )}
    </NodeViewWrapper>
  );
}

const common = {
  atom: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: "" } };
  },
};

/** Fórmula no meio do texto: digite $x^2$. */
export const MathInline = Node.create({
  ...common,
  name: "mathInline",
  group: "inline",
  inline: true,
  parseHTML() {
    return [{ tag: "span[data-math-inline]", getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute("data-latex") ?? "" }) }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-math-inline": "", "data-latex": node.attrs.latex }), node.attrs.latex];
  },
  renderText({ node }) {
    return `$${node.attrs.latex}$`;
  },
  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|\s)\$([^$\s][^$]*?)\$$/,
        handler: ({ state, range, match }) => {
          const start = range.from + (match[0].startsWith("$") ? 0 : 1);
          state.tr.replaceWith(start, range.to, this.type.create({ latex: match[1] }));
        },
      }),
    ];
  },
  addCommands() {
    return {
      insertMath:
        (display, latex = "") =>
        ({ commands }) =>
          commands.insertContent({ type: display ? "mathBlock" : "mathInline", attrs: { latex } }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathView, { as: "span", className: "ne-inline-host" });
  },
});

/** Fórmula em destaque, centralizada: digite $$ e espaço no começo da linha. */
export const MathBlock = Node.create({
  ...common,
  name: "mathBlock",
  group: "block",
  draggable: true,
  parseHTML() {
    return [{ tag: "div[data-math-block]", getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute("data-latex") ?? "" }) }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-math-block": "", "data-latex": node.attrs.latex }), node.attrs.latex];
  },
  renderText({ node }) {
    return `$$${node.attrs.latex}$$`;
  },
  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          state.tr.replaceRangeWith($from.before(), $from.after(), this.type.create({ latex: "" }));
        },
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathView);
  },
});
