// Blocos do editor completo: anexo, imagem com tamanhos, código com linguagem
// e botão de copiar, e destaque (callout).
import { mergeAttributes, Node } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import { NodeViewContent, NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import { useState } from "react";
import { formatSize } from "../../../format";
import { fileUrl } from "../../api";

// --- anexo ---------------------------------------------------------------------------

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    attachment: {
      insertAttachment: (attrs: { fileId: string; name: string; size: number; mime: string }) => ReturnType;
    };
    callout: {
      toggleCallout: (tone?: string) => ReturnType;
    };
  }
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "PDF";
  if (["zip", "rar", "7z"].includes(ext)) return "ZIP";
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return "DOC";
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) return "XLS";
  if (["ppt", "pptx", "odp"].includes(ext)) return "PPT";
  if (["mp3", "wav", "ogg", "m4a"].includes(ext)) return "ÁUD";
  return ext.slice(0, 4).toUpperCase() || "ARQ";
}

function AttachmentView({ node, selected, deleteNode, editor }: NodeViewProps) {
  const { fileId, name, size } = node.attrs as { fileId: string; name: string; size: number };
  return (
    <NodeViewWrapper className={`ne-attachment ${selected ? "is-selected" : ""}`} data-drag-handle>
      <span className="ne-attachment-icon" aria-hidden="true">
        {fileIcon(name)}
      </span>
      <span className="ne-attachment-meta">
        <strong>{name}</strong>
        <small>{formatSize(size)}</small>
      </span>
      <a className="ne-attachment-action" href={`${fileUrl(fileId)}?download=true`} download={name} contentEditable={false}>
        Baixar
      </a>
      {editor.isEditable && (
        <button type="button" className="ne-attachment-action is-danger" contentEditable={false} onClick={() => deleteNode()} aria-label={`Remover ${name}`}>
          Remover
        </button>
      )}
    </NodeViewWrapper>
  );
}

export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { fileId: { default: "" }, name: { default: "arquivo" }, size: { default: 0 }, mime: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div[data-attachment]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-attachment": node.attrs.fileId }), node.attrs.name];
  },
  renderText({ node }) {
    return `📎 ${node.attrs.name}`;
  },
  addCommands() {
    return {
      insertAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView);
  },
});

// --- imagem ------------------------------------------------------------------------------

const SIZES = [
  { label: "P", width: 280, title: "Pequena" },
  { label: "M", width: 480, title: "Média" },
  { label: "G", width: null, title: "Largura total" },
];

function ImageView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const { src, alt, width } = node.attrs as { src: string; alt: string | null; width: number | null };
  const [failed, setFailed] = useState(false);
  const [editingAlt, setEditingAlt] = useState(false);
  return (
    <NodeViewWrapper className={`ne-image ${selected ? "is-selected" : ""}`} data-drag-handle>
      <figure style={{ maxWidth: width ? `${width}px` : undefined }}>
        {failed ? (
          <div className="ne-image-missing" contentEditable={false}>
            Imagem indisponível
          </div>
        ) : (
          <a href={src} target="_blank" rel="noreferrer" contentEditable={false} onClick={(e) => editor.isEditable && e.preventDefault()}>
            <img src={src} alt={alt ?? ""} loading="lazy" onError={() => setFailed(true)} draggable={false} />
          </a>
        )}
        {(alt || editingAlt) && (
          <figcaption contentEditable={false}>
            {editingAlt ? (
              <input
                autoFocus
                defaultValue={alt ?? ""}
                placeholder="Legenda"
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
                }}
                onBlur={(e) => {
                  updateAttributes({ alt: e.target.value.trim() || null });
                  setEditingAlt(false);
                }}
              />
            ) : (
              alt
            )}
          </figcaption>
        )}
      </figure>
      {selected && editor.isEditable && (
        <div className="ne-image-tools" contentEditable={false}>
          {SIZES.map((s) => (
            <button key={s.label} type="button" className={width === s.width ? "is-active" : ""} title={s.title} onClick={() => updateAttributes({ width: s.width })}>
              {s.label}
            </button>
          ))}
          <button type="button" onClick={() => setEditingAlt(true)}>
            Legenda
          </button>
          <a href={`${src}?download=true`} download>
            Baixar
          </a>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const NoteImage = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
}).configure({ inline: false, allowBase64: false });

// --- código ------------------------------------------------------------------------------

export const lowlight = createLowlight(common);

export const LANGUAGES: { id: string; label: string }[] = [
  { id: "", label: "Texto" },
  { id: "java", label: "Java" },
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "kotlin", label: "Kotlin" },
  { id: "php", label: "PHP" },
  { id: "ruby", label: "Ruby" },
  { id: "sql", label: "SQL" },
  { id: "bash", label: "Shell" },
  { id: "json", label: "JSON" },
  { id: "yaml", label: "YAML" },
  { id: "xml", label: "HTML/XML" },
  { id: "css", label: "CSS" },
  { id: "markdown", label: "Markdown" },
];

function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const [copied, setCopied] = useState(false);
  const language = (node.attrs.language as string | null) ?? "";
  async function copy() {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sem permissão de área de transferência */
    }
  }
  return (
    <NodeViewWrapper className="ne-code">
      <div className="ne-code-head" contentEditable={false}>
        {editor.isEditable ? (
          <select value={language} onChange={(e) => updateAttributes({ language: e.target.value || null })} aria-label="Linguagem do código">
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        ) : (
          <span>{LANGUAGES.find((l) => l.id === language)?.label ?? language}</span>
        )}
        <button type="button" onClick={copy} className={copied ? "is-done" : ""}>
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre spellCheck={false}>
        <NodeViewContent<"code"> as="code" className={language ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  );
}

export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight, defaultLanguage: null, enableTabIndentation: true } as never);

// --- destaque (callout) ---------------------------------------------------------------------

const TONES = [
  { id: "info", icon: "i", label: "Informação" },
  { id: "tip", icon: "✓", label: "Dica" },
  { id: "warning", icon: "!", label: "Atenção" },
  { id: "important", icon: "★", label: "Importante" },
];

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const tone = TONES.find((t) => t.id === node.attrs.tone) ?? TONES[0];
  function cycle() {
    const next = TONES[(TONES.indexOf(tone) + 1) % TONES.length];
    updateAttributes({ tone: next.id });
  }
  return (
    <NodeViewWrapper className={`ne-callout is-${tone.id}`}>
      <button type="button" className="ne-callout-icon" contentEditable={false} onClick={cycle} disabled={!editor.isEditable} title={`${tone.label} (clique para trocar)`}>
        {tone.icon}
      </button>
      <NodeViewContent className="ne-callout-body" />
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { tone: { default: "info" } };
  },
  parseHTML() {
    return [{ tag: "aside[data-callout]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["aside", mergeAttributes(HTMLAttributes, { "data-callout": node.attrs.tone }), 0];
  },
  addCommands() {
    return {
      toggleCallout:
        (tone = "info") =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { tone }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});
