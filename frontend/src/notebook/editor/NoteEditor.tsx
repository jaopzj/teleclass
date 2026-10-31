import type { Editor, JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "../../notifications/center";
import type { NoteFile } from "../api";
import { EditorEnv, EditorEnvContext } from "./env";
import { buildExtensions, HIGHLIGHT_COLORS, revealSearch } from "./extensions";
import { slashItems } from "./suggestions";
import "./editor.css";

export interface NoteEditorProps {
  content: JSONContent;
  env: EditorEnv;
  editable?: boolean;
  placeholder?: string;
  className?: string;
  autofocus?: boolean | "end";
  /** Tempo atual do vídeo, para o botão/comando de timestamp. */
  currentTime?: () => number | null;
  onChange?: (doc: JSONContent, editor: Editor) => void;
  onReady?: (editor: Editor) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  /** Termos da busca a destacar quando a anotação abre. */
  searchQuery?: string | null;
  /** Barra fixa e discreta (notas da aula); no Caderno a formatação aparece ao selecionar. */
  inlineToolbar?: boolean;
  footer?: ReactNode;
  ariaLabel?: string;
}

export default function NoteEditor(props: NoteEditorProps) {
  const { env, editable = true, currentTime } = props;
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const insertPos = useRef<number | null>(null);
  const [uploads, setUploads] = useState<{ id: number; name: string; progress: number }[]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;
  const envRef = useRef(env);
  envRef.current = env;
  const editorRef = useRef<Editor | null>(null);

  async function uploadFiles(files: File[], pos: number | null) {
    const upload = envRef.current.upload;
    const editor = editorRef.current;
    if (!upload || !editor) return;
    for (const file of files) {
      const kind = file.type.startsWith("image/") && file.type !== "image/svg+xml" ? "image" : "file";
      const id = Date.now() + Math.random();
      setUploads((u) => [...u, { id, name: file.name, progress: 0 }]);
      let stored: NoteFile | null = null;
      try {
        stored = await upload(file, kind);
      } finally {
        setUploads((u) => u.filter((x) => x.id !== id));
      }
      if (!stored || editor.isDestroyed) continue;
      const node =
        stored.kind === "image"
          ? { type: "image", attrs: { src: `/api/notebook/files/${stored.id}`, alt: null, width: stored.width && stored.width < 480 ? stored.width : null } }
          : { type: "attachment", attrs: { fileId: stored.id, name: stored.name, size: stored.size, mime: stored.mime } };
      const chain = editor.chain().focus();
      if (pos !== null && pos <= editor.state.doc.content.size) chain.insertContentAt(pos, node);
      else chain.insertContent(node);
      chain.run();
      // O bloco inserido fica selecionado; sem isto, a próxima tecla o substituiria.
      if (editor.state.selection instanceof NodeSelection) editor.commands.createParagraphNear();
    }
  }

  const insertTime = currentTime
    ? (editor: Editor) => {
        const t = currentTime();
        if (t === null) {
          notify({ title: "Abra o vídeo da aula para marcar o tempo", tone: "neutral" });
          return;
        }
        editor.chain().focus().insertTimestamp(t).run();
      }
    : undefined;
  const insertTimeRef = useRef(insertTime);
  insertTimeRef.current = insertTime;

  const extensions = useMemo(
    () =>
      buildExtensions({
        variant: env.variant,
        placeholder: props.placeholder ?? (env.variant === "full" ? "Escreva, ou digite / para inserir blocos e @ para citar uma aula" : "Anote algo sobre este momento da aula…"),
        slash: () =>
          slashItems({
            pickImage: envRef.current.upload ? () => imageInput.current?.click() : undefined,
            pickFile: envRef.current.upload ? () => fileInput.current?.click() : undefined,
            insertTime: insertTimeRef.current ? (e) => insertTimeRef.current?.(e) : undefined,
          }),
        onFiles: (files, pos) => void uploadFiles(files, pos),
      }),
    // O schema é definido na criação; o resto é lido por refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [env.variant],
  );

  const editor = useEditor(
    {
      extensions,
      content: props.content,
      editable,
      autofocus: props.autofocus ?? false,
      editorProps: {
        attributes: {
          class: `ne-content ne-${env.variant}`,
          spellcheck: "true",
          "aria-label": props.ariaLabel ?? "Anotação",
          role: "textbox",
          "aria-multiline": "true",
        },
        handleClickOn(_view, _pos, _node, _nodePos, event) {
          // Links: Ctrl/⌘ + clique abre (clique simples só posiciona o cursor para editar).
          const link = (event.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
          if (link && !link.closest(".ne-ref, .ne-attachment, .ne-image") && (event.ctrlKey || event.metaKey || !editorRef.current?.isEditable)) {
            window.open(link.href, "_blank", "noopener");
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => propsRef.current.onChange?.(editor.getJSON(), editor),
      onBlur: () => propsRef.current.onBlur?.(),
      onFocus: () => propsRef.current.onFocus?.(),
      onCreate: ({ editor }) => {
        editorRef.current = editor;
        propsRef.current.onReady?.(editor);
        if (propsRef.current.searchQuery) requestAnimationFrame(() => revealSearch(editor, propsRef.current.searchQuery ?? ""));
      },
      shouldRerenderOnTransaction: false,
    },
    [extensions],
  );
  editorRef.current = editor;

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  function onPick(kind: "image" | "file", files: FileList | null) {
    if (files?.length) void uploadFiles(Array.from(files), insertPos.current);
    insertPos.current = null;
    if (kind === "image" && imageInput.current) imageInput.current.value = "";
    if (kind === "file" && fileInput.current) fileInput.current.value = "";
  }

  return (
    <EditorEnvContext.Provider value={env}>
      <div className={`ne ${props.className ?? ""} ${editable ? "" : "is-readonly"}`}>
        {editor && editable && <FormatBubble editor={editor} variant={env.variant} />}
        {editor && editable && env.variant === "full" && <TableBubble editor={editor} />}
        <EditorContent editor={editor} />
        {uploads.length > 0 && (
          <div className="ne-uploads" role="status">
            {uploads.map((u) => (
              <span key={u.id} className="ne-upload">
                <span className="ne-spinner" /> Enviando {u.name}…
              </span>
            ))}
          </div>
        )}
        {editor && editable && props.inlineToolbar && <CompactToolbar editor={editor} insertTime={insertTime} />}
        {props.footer}
        {env.upload && (
          <>
            <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => onPick("image", e.target.files)} />
            <input ref={fileInput} type="file" hidden onChange={(e) => onPick("file", e.target.files)} />
          </>
        )}
      </div>
    </EditorEnvContext.Provider>
  );
}

// --- barras de formatação --------------------------------------------------------------

function Btn({ active, onClick, label, children, disabled }: { active?: boolean; onClick: () => void; label: string; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`ne-tool ${active ? "is-active" : ""}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";

function useMarks(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
      highlight: e.isActive("highlight") ? ((e.getAttributes("highlight").color as string) ?? "yellow") : null,
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      sub: e.isActive("subscript"),
      sup: e.isActive("superscript"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
}

function LinkEditor({ editor, initial, onClose }: { editor: Editor; initial: string; onClose: () => void }) {
  const [href, setHref] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  function apply() {
    const value = href.trim();
    if (!value) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      onClose();
      return;
    }
    const normalized = /^(https?:\/\/|mailto:|\/)/i.test(value) ? value : `https://${value}`;
    if (!/^(https?:\/\/[^\s]+|mailto:[^\s]+|\/[^\s]*)$/i.test(normalized)) {
      setError("Link inválido");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
    onClose();
  }
  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      apply();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      editor.commands.focus();
    }
  }
  return (
    <div className="ne-link-editor">
      <input autoFocus value={href} onChange={(e) => { setHref(e.target.value); setError(null); }} onKeyDown={onKeyDown} placeholder="Cole ou digite um link" aria-label="Endereço do link" aria-invalid={!!error} />
      <button type="button" className="ne-tool" onMouseDown={(e) => e.preventDefault()} onClick={apply}>
        OK
      </button>
      {initial && (
        <button type="button" className="ne-tool" onMouseDown={(e) => e.preventDefault()} onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); onClose(); }}>
          Remover
        </button>
      )}
      {error && <span className="ne-link-error">{error}</span>}
    </div>
  );
}

function HighlightPicker({ editor, current, onClose }: { editor: Editor; current: string | null; onClose: () => void }) {
  return (
    <div className="ne-swatches" role="group" aria-label="Cor do destaque">
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`ne-swatch ${current === c.id ? "is-active" : ""}`}
          data-color={c.id}
          title={c.label}
          aria-label={c.label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            editor.chain().focus().setHighlight({ color: c.id }).run();
            onClose();
          }}
        />
      ))}
      <button type="button" className="ne-tool" onMouseDown={(e) => e.preventDefault()} onClick={() => { editor.chain().focus().unsetHighlight().run(); onClose(); }} title="Sem destaque">
        ✕
      </button>
    </div>
  );
}

function FormatButtons({ editor, variant, panel, setPanel }: { editor: Editor; variant: "compact" | "full"; panel: string | null; setPanel: (p: string | null) => void }) {
  const s = useMarks(editor);
  if (panel === "link") return <LinkEditor editor={editor} initial={s.href} onClose={() => setPanel(null)} />;
  if (panel === "color") return <HighlightPicker editor={editor} current={s.highlight} onClose={() => setPanel(null)} />;
  return (
    <>
      <Btn active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()} label={`Negrito (${mod}+B)`}>
        <b>B</b>
      </Btn>
      <Btn active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()} label={`Itálico (${mod}+I)`}>
        <i>I</i>
      </Btn>
      <Btn active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} label={`Sublinhado (${mod}+U)`}>
        <u>U</u>
      </Btn>
      <Btn active={s.strike} onClick={() => editor.chain().focus().toggleStrike().run()} label="Tachado">
        <s>S</s>
      </Btn>
      <Btn active={s.code} onClick={() => editor.chain().focus().toggleCode().run()} label={`Código no texto (${mod}+E)`}>
        <code>{"<>"}</code>
      </Btn>
      {variant === "full" && (
        <>
          <Btn active={s.sup} onClick={() => editor.chain().focus().toggleSuperscript().run()} label="Sobrescrito">
            x²
          </Btn>
          <Btn active={s.sub} onClick={() => editor.chain().focus().toggleSubscript().run()} label="Subscrito">
            x₂
          </Btn>
        </>
      )}
      <span className="ne-sep" />
      <Btn active={!!s.highlight} onClick={() => setPanel("color")} label="Destacar com cor">
        <span className="ne-hl-icon" data-color={s.highlight ?? "yellow"}>A</span>
      </Btn>
      <Btn active={s.link} onClick={() => setPanel("link")} label={`Link (${mod}+K)`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
        </svg>
      </Btn>
      <span className="ne-sep" />
      <Btn active={variant === "full" ? s.h2 : s.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="Subtítulo">
        H2
      </Btn>
      <Btn active={s.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} label="Tópico">
        H3
      </Btn>
    </>
  );
}

function FormatBubble({ editor, variant }: { editor: Editor; variant: "compact" | "full" }) {
  const [panel, setPanel] = useState<string | null>(null);
  useEffect(() => {
    const onKey = () => setPanel(null);
    editor.on("selectionUpdate", onKey);
    // Ctrl/⌘+K abre o campo de link.
    const dom = editor.view.dom;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !editor.state.selection.empty) {
        e.preventDefault();
        setPanel("link");
      }
    };
    dom.addEventListener("keydown", onKeyDown);
    return () => {
      editor.off("selectionUpdate", onKey);
      dom.removeEventListener("keydown", onKeyDown);
    };
  }, [editor]);
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="formatBubble"
      className="ne-bubble"
      options={{ placement: "top", offset: 8, flip: true }}
      shouldShow={({ editor: e, state, from, to }) => {
        if (from === to || !e.isEditable) return false;
        if (e.isActive("codeBlock") || e.isActive("image") || e.isActive("courseRef") || e.isActive("mathBlock") || e.isActive("mathInline") || e.isActive("attachment") || e.isActive("timestamp")) return false;
        return state.doc.textBetween(from, to, " ").trim().length > 0;
      }}
    >
      <FormatButtons editor={editor} variant={variant} panel={panel} setPanel={setPanel} />
    </BubbleMenu>
  );
}

function TableBubble({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubble"
      className="ne-bubble ne-table-bubble"
      options={{ placement: "top-start", offset: 8 }}
      shouldShow={({ editor: e, from, to }) => e.isEditable && e.isActive("table") && from === to}
      getReferencedVirtualElement={() => {
        const { view, state } = editor;
        const dom = view.domAtPos(state.selection.from).node as HTMLElement;
        const table = (dom.nodeType === 3 ? dom.parentElement : dom)?.closest("table");
        return table ? { getBoundingClientRect: () => table.getBoundingClientRect() } : null;
      }}
    >
      <Btn onClick={() => editor.chain().focus().addRowAfter().run()} label="Adicionar linha abaixo">+ Linha</Btn>
      <Btn onClick={() => editor.chain().focus().addColumnAfter().run()} label="Adicionar coluna à direita">+ Coluna</Btn>
      <Btn onClick={() => editor.chain().focus().deleteRow().run()} label="Excluir linha">− Linha</Btn>
      <Btn onClick={() => editor.chain().focus().deleteColumn().run()} label="Excluir coluna">− Coluna</Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeaderRow().run()} label="Linha de cabeçalho">Cabeçalho</Btn>
      <Btn onClick={() => editor.chain().focus().mergeOrSplit().run()} label="Mesclar ou dividir células">Mesclar</Btn>
      <span className="ne-sep" />
      <Btn onClick={() => editor.chain().focus().deleteTable().run()} label="Excluir tabela">Excluir</Btn>
    </BubbleMenu>
  );
}

/** Barra fina das notas da aula: o essencial, sem tirar espaço do vídeo. */
function CompactToolbar({ editor, insertTime }: { editor: Editor; insertTime?: (editor: Editor) => void }) {
  const s = useMarks(editor);
  const [panel, setPanel] = useState<string | null>(null);
  return (
    <div className="ne-toolbar" role="toolbar" aria-label="Formatação">
      {panel === "link" ? (
        <LinkEditor editor={editor} initial={s.href} onClose={() => setPanel(null)} />
      ) : panel === "color" ? (
        <HighlightPicker editor={editor} current={s.highlight} onClose={() => setPanel(null)} />
      ) : (
        <>
          <Btn active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()} label={`Negrito (${mod}+B)`}><b>B</b></Btn>
          <Btn active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()} label={`Itálico (${mod}+I)`}><i>I</i></Btn>
          <Btn active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} label={`Sublinhado (${mod}+U)`}><u>U</u></Btn>
          <Btn active={!!s.highlight} onClick={() => setPanel("color")} label="Destacar com cor"><span className="ne-hl-icon" data-color={s.highlight ?? "yellow"}>A</span></Btn>
          <span className="ne-sep" />
          <Btn active={s.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} label="Título">T</Btn>
          <Btn active={s.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} label="Lista">•</Btn>
          <Btn active={s.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="Lista numerada">1.</Btn>
          <Btn active={s.link} onClick={() => setPanel("link")} label={`Link (${mod}+K)`}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
          </Btn>
          {insertTime && (
            <Btn onClick={() => insertTime(editor)} label="Inserir o tempo atual do vídeo">⏱</Btn>
          )}
        </>
      )}
    </div>
  );
}
