// Conjunto de extensões do editor. O schema aqui precisa bater com o que o
// servidor aceita (backend/app/notebook/document.py).
import { Editor, Extension, type AnyExtension } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { Timestamp } from "./nodes/Timestamp";
import { SlashCommands, SlashItem } from "./suggestions";
import type { Variant } from "./env";

export const HIGHLIGHT_COLORS = [
  { id: "yellow", label: "Amarelo" },
  { id: "green", label: "Verde" },
  { id: "blue", label: "Azul" },
  { id: "pink", label: "Rosa" },
  { id: "purple", label: "Roxo" },
  { id: "orange", label: "Laranja" },
  { id: "red", label: "Vermelho" },
  { id: "gray", label: "Cinza" },
];

const ColorHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: "yellow",
        parseHTML: (el) => el.getAttribute("data-color") ?? "yellow",
        renderHTML: (attrs) => ({ "data-color": attrs.color }),
      },
    };
  },
}).configure({ multicolor: true });

const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/))/i;

/** Alt+Shift+↑/↓ move o bloco atual (parágrafo, lista, tabela...) para cima ou para baixo. */
const MoveBlock = Extension.create({
  name: "moveBlock",
  addKeyboardShortcuts() {
    const move = (dir: -1 | 1) => () => {
      const { state, view } = this.editor;
      const { $from } = state.selection;
      if ($from.depth < 1) return false;
      const index = $from.index(0);
      const doc = state.doc;
      const target = index + dir;
      if (target < 0 || target >= doc.childCount) return true;
      const node = doc.child(index);
      const other = doc.child(target);
      let start = 0;
      for (let i = 0; i < Math.min(index, target); i++) start += doc.child(i).nodeSize;
      const first = dir === 1 ? node : other;
      const second = dir === 1 ? other : node;
      const offset = $from.pos - (start + (dir === 1 ? 0 : other.nodeSize));
      const tr = state.tr.replaceWith(start, start + first.nodeSize + second.nodeSize, [second, first]);
      const newStart = dir === 1 ? start + other.nodeSize : start;
      const pos = Math.min(newStart + offset, tr.doc.content.size);
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
      view.dispatch(tr.scrollIntoView());
      return true;
    };
    return { "Alt-Shift-ArrowUp": move(-1), "Alt-Shift-ArrowDown": move(1) };
  },
});

/** Destaca os termos da busca no documento até a pessoa começar a editar. */
export const searchKey = new PluginKey<DecorationSet>("searchHighlight");
const SearchHighlight = Extension.create({
  name: "searchHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: searchKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(searchKey) as DecorationSet | undefined;
            if (meta) return meta;
            return tr.docChanged ? DecorationSet.empty : set;
          },
        },
        props: {
          decorations(state) {
            return searchKey.getState(state);
          },
        },
      }),
    ];
  },
});

function fold(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Seleciona a primeira ocorrência dos termos da busca e marca as demais. */
export function revealSearch(editor: Editor, query: string) {
  const terms = (query.match(/"[^"]+"|\S+/g) ?? []).map((t) => fold(t.replace(/"/g, ""))).filter((t) => t.length > 0);
  if (!terms.length) return;
  const decorations: Decoration[] = [];
  let first: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    // Sem acento e minúsculo; o tamanho do texto não muda ao tirar acentos combinados (NFD → remoção) na maioria dos casos.
    const original = node.text;
    const folded = fold(original);
    if (folded.length !== original.length) return; // caracteres compostos: evita posições erradas
    for (const term of terms) {
      let i = folded.indexOf(term);
      while (i !== -1) {
        const from = pos + i;
        const to = from + term.length;
        decorations.push(Decoration.inline(from, to, { class: "ne-search-hit" }));
        if (!first || from < first.from) first = { from, to };
        i = folded.indexOf(term, i + term.length);
      }
    }
  });
  const tr = editor.state.tr.setMeta(searchKey, DecorationSet.create(editor.state.doc, decorations));
  if (first) {
    const hit = first as { from: number; to: number };
    tr.setSelection(TextSelection.create(tr.doc, hit.from, hit.to));
  }
  editor.view.dispatch(tr);
  if (first) {
    requestAnimationFrame(() => {
      const dom = editor.view.domAtPos((first as { from: number }).from).node as HTMLElement;
      const el = dom.nodeType === 3 ? dom.parentElement : dom;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
}

/** Colar ou soltar arquivos no editor: imagens viram imagem, o resto vira anexo. */
export function FileDrop(onFiles: (files: File[], pos: number | null) => void) {
  return Extension.create({
    name: "fileDrop",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("fileDrop"),
          props: {
            handlePaste(_view, event) {
              const files = Array.from(event.clipboardData?.files ?? []);
              if (!files.length) return false;
              event.preventDefault();
              onFiles(files, null);
              return true;
            },
            handleDrop(view, event) {
              const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
              if (!files.length) return false;
              event.preventDefault();
              const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
              onFiles(files, coords?.pos ?? null);
              return true;
            },
          },
        }),
      ];
    },
  });
}

// Blocos do editor completo (tabelas, fórmulas, código, imagens...). Ficam em
// `full.ts`, carregado só pelo Caderno, para não pesar a página da aula.
type FullFactory = (onFiles?: (files: File[], pos: number | null) => void) => AnyExtension[];
let fullFactory: FullFactory | null = null;
export function registerFullExtensions(factory: FullFactory) {
  fullFactory = factory;
}
export const hasFullExtensions = () => fullFactory !== null;

export interface BuildOptions {
  variant: Variant;
  placeholder: string;
  slash: () => SlashItem[];
  onFiles?: (files: File[], pos: number | null) => void;
}

export function buildExtensions({ variant, placeholder, slash, onFiles }: BuildOptions): AnyExtension[] {
  const full = variant === "full";
  const list: AnyExtension[] = [
    StarterKit.configure({
      heading: { levels: full ? [1, 2, 3, 4] : [2, 3] },
      codeBlock: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        isAllowedUri: (url) => SAFE_URL.test(url),
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
      dropcursor: { color: "var(--accent)", width: 2 },
    }),
    ColorHighlight,
    Timestamp,
    Placeholder.configure({ placeholder, showOnlyCurrent: true, includeChildren: false }),
    CharacterCount,
    SearchHighlight,
    MoveBlock,
    SlashCommands(variant, slash),
  ];
  if (full) {
    if (!fullFactory) throw new Error("Editor completo não carregado: importe notebook/editor/full");
    list.push(...fullFactory(onFiles));
  }
  return list;
}
