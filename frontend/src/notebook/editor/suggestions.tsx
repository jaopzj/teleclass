// Menus que aparecem enquanto se digita: "/" (inserir blocos) e "@" (citar
// curso, módulo ou aula, com tempo opcional).
import { Editor, Extension, Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { forwardRef, ReactNode, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { getPlayer } from "../../player/controller";
import { notebookApi, Target } from "../api";
import { formatStamp } from "../time";
import { StampInput } from "./nodes/Timestamp";
import type { Variant } from "./env";

export interface MenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

/** Posiciona o menu junto ao cursor e o mantém dentro da tela. */
function placePopup(el: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return;
  const margin = 8;
  const { innerWidth: w, innerHeight: h } = window;
  const width = el.offsetWidth || 320;
  const height = el.offsetHeight || 300;
  let left = Math.min(rect.left, w - width - margin);
  left = Math.max(margin, left);
  let top = rect.bottom + 6;
  if (top + height > h - margin && rect.top - height - 6 > margin) top = rect.top - height - 6;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function popupRenderer<P extends object>(Component: React.ForwardRefExoticComponent<P & React.RefAttributes<MenuHandle>>) {
  return () => {
    let renderer: ReactRenderer<MenuHandle, P> | null = null;
    let host: HTMLDivElement | null = null;
    let lastRect: (() => DOMRect | null) | null | undefined = null;
    const reposition = () => host && placePopup(host, lastRect?.());
    return {
      onStart: (props: SuggestionProps) => {
        host = document.createElement("div");
        host.className = "ne-popup";
        document.body.appendChild(host);
        renderer = new ReactRenderer(Component, { props: props as unknown as P, editor: props.editor });
        host.appendChild(renderer.element);
        lastRect = props.clientRect;
        requestAnimationFrame(reposition);
        window.addEventListener("scroll", reposition, true);
      },
      onUpdate: (props: SuggestionProps) => {
        renderer?.updateProps(props as unknown as P);
        lastRect = props.clientRect;
        requestAnimationFrame(reposition);
      },
      onKeyDown: (props: SuggestionKeyDownProps) => {
        if (props.event.key === "Escape" && !renderer?.ref) return false;
        return renderer?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => {
        window.removeEventListener("scroll", reposition, true);
        renderer?.destroy();
        host?.remove();
        renderer = null;
        host = null;
      },
    };
  };
}

function useMenuKeys(count: number, select: (index: number) => void, ref: React.Ref<MenuHandle>, extra?: (p: SuggestionKeyDownProps, index: number) => boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [count]);
  useImperativeHandle(ref, () => ({
    onKeyDown: (p) => {
      if (extra?.(p, index)) return true;
      if (p.event.key === "ArrowDown") {
        setIndex((i) => (count ? (i + 1) % count : 0));
        return true;
      }
      if (p.event.key === "ArrowUp") {
        setIndex((i) => (count ? (i - 1 + count) % count : 0));
        return true;
      }
      if (p.event.key === "Enter") {
        if (!count) return false;
        select(index);
        return true;
      }
      return false;
    },
  }));
  return [index, setIndex] as const;
}

function ScrollIntoView({ active, children, className, onSelect, onHover }: { active: boolean; children: ReactNode; className?: string; onSelect: () => void; onHover: () => void }) {
  const el = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (active) el.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <button ref={el} type="button" className={`ne-menu-item ${active ? "is-active" : ""} ${className ?? ""}`} onMouseDown={(e) => e.preventDefault()} onClick={onSelect} onMouseEnter={onHover}>
      {children}
    </button>
  );
}

// --- "/" ------------------------------------------------------------------------------------

export interface SlashItem {
  id: string;
  label: string;
  hint: string;
  icon: string;
  keywords: string;
  full?: boolean;
  run: (editor: Editor, range: Range) => void;
}

/** Itens do "/" ; `extra` recebe as ações que dependem da página (upload, tempo). */
export function slashItems(extra: { pickImage?: () => void; pickFile?: () => void; insertTime?: (editor: Editor) => void }): SlashItem[] {
  const items: SlashItem[] = [
    { id: "p", label: "Texto", hint: "Parágrafo simples", icon: "¶", keywords: "texto paragrafo", run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
    { id: "h1", label: "Título", hint: "Seção grande", icon: "H1", keywords: "titulo heading h1", full: true, run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
    { id: "h2", label: "Subtítulo", hint: "Seção média", icon: "H2", keywords: "subtitulo heading h2 titulo", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
    { id: "h3", label: "Tópico", hint: "Seção pequena", icon: "H3", keywords: "topico heading h3 titulo", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
    { id: "ul", label: "Lista", hint: "Lista com marcadores", icon: "•", keywords: "lista marcadores bullet", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
    { id: "ol", label: "Lista numerada", hint: "1, 2, 3…", icon: "1.", keywords: "lista numerada ordenada", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
    { id: "todo", label: "Checklist", hint: "Tarefas para marcar", icon: "☑", keywords: "checklist tarefas todo", full: true, run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
    { id: "quote", label: "Citação", hint: "Trecho em destaque", icon: "❝", keywords: "citacao quote", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
    { id: "callout", label: "Destaque", hint: "Caixa de informação, dica ou atenção", icon: "!", keywords: "destaque callout aviso dica", full: true, run: (e, r) => e.chain().focus().deleteRange(r).toggleCallout().run() },
    { id: "code", label: "Código", hint: "Bloco com destaque de sintaxe", icon: "</>", keywords: "codigo code programacao", full: true, run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
    { id: "math", label: "Fórmula", hint: "Equação em destaque (LaTeX)", icon: "∑", keywords: "formula matematica equacao latex", full: true, run: (e, r) => e.chain().focus().deleteRange(r).insertMath(true).run() },
    { id: "imath", label: "Fórmula no texto", hint: "Também com $x^2$", icon: "x²", keywords: "formula inline matematica latex", full: true, run: (e, r) => e.chain().focus().deleteRange(r).insertMath(false).run() },
    { id: "table", label: "Tabela", hint: "3 × 3 com cabeçalho", icon: "▦", keywords: "tabela table", full: true, run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: "hr", label: "Divisor", hint: "Linha horizontal", icon: "—", keywords: "divisor linha separador", run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  ];
  if (extra.insertTime) {
    const insert = extra.insertTime;
    items.push({ id: "time", label: "Tempo do vídeo", hint: "Instante atual da aula", icon: "⏱", keywords: "tempo timestamp minuto video", run: (e, r) => { e.chain().focus().deleteRange(r).run(); insert(e); } });
  }
  if (extra.pickImage) {
    const pick = extra.pickImage;
    items.push({ id: "image", label: "Imagem", hint: "PNG, JPEG, GIF ou WebP · até 10 MB", icon: "▣", keywords: "imagem foto figura", full: true, run: (e, r) => { e.chain().focus().deleteRange(r).run(); pick(); } });
  }
  if (extra.pickFile) {
    const pick = extra.pickFile;
    items.push({ id: "file", label: "Anexo", hint: "PDF, documentos, código · até 25 MB", icon: "📎", keywords: "anexo arquivo pdf upload", full: true, run: (e, r) => { e.chain().focus().deleteRange(r).run(); pick(); } });
  }
  items.push({ id: "ref", label: "Citar aula", hint: "Também digitando @", icon: "@", keywords: "citar referencia aula curso modulo mencao", full: true, run: (e, r) => e.chain().focus().deleteRange(r).insertContent("@").run() });
  return items;
}

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

type SlashProps = SuggestionProps<SlashItem>;

const SlashMenu = forwardRef<MenuHandle, SlashProps>(function SlashMenu({ items, command }, ref) {
  const [index, setIndex] = useMenuKeys(items.length, (i) => command(items[i]), ref);
  if (!items.length) return <div className="ne-menu ne-menu-empty">Nenhum bloco encontrado</div>;
  return (
    <div className="ne-menu" role="listbox" aria-label="Inserir bloco">
      {items.map((item, i) => (
        <ScrollIntoView key={item.id} active={i === index} onSelect={() => command(item)} onHover={() => setIndex(i)}>
          <span className="ne-menu-icon">{item.icon}</span>
          <span className="ne-menu-text">
            <strong>{item.label}</strong>
            <small>{item.hint}</small>
          </span>
        </ScrollIntoView>
      ))}
    </div>
  );
});

export function SlashCommands(variant: Variant, getItems: () => SlashItem[]) {
  return Extension.create({
    name: "slashCommands",
    addProseMirrorPlugins() {
      const options: Omit<SuggestionOptions<SlashItem>, "editor"> = {
        char: "/",
        pluginKey: new PluginKey("slash"),
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          return !$from.parent.type.spec.code;
        },
        items: ({ query }) => {
          const q = normalize(query);
          return getItems()
            .filter((i) => variant === "full" || !i.full)
            .filter((i) => !q || normalize(`${i.label} ${i.keywords}`).includes(q))
            .slice(0, 20);
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        render: popupRenderer(SlashMenu),
      };
      return [Suggestion({ editor: this.editor, ...options })];
    },
  });
}

// --- "@" --------------------------------------------------------------------------------------

const KIND = { course: "Curso", section: "Módulo", lesson: "Aula" } as const;

type MentionProps = SuggestionProps<Target>;

let targetsCache: { key: string; at: number; value: Promise<Target[]> } | null = null;
function fetchTargets(query: string): Promise<Target[]> {
  const key = query.trim().toLowerCase();
  if (targetsCache && targetsCache.key === key && Date.now() - targetsCache.at < 15_000) return targetsCache.value;
  const value = notebookApi.targets(key).catch(() => []);
  targetsCache = { key, at: Date.now(), value };
  return value;
}

const MentionMenu = forwardRef<MenuHandle, MentionProps>(function MentionMenu({ items, command, query }, ref) {
  const [timeFor, setTimeFor] = useState<Target | null>(null);
  const choose = (t: Target) => command(t);
  const [index, setIndex] = useMenuKeys(items.length, (i) => choose(items[i]), ref, (p, i) => {
    if (timeFor) {
      if (p.event.key === "Escape") {
        setTimeFor(null);
        return true;
      }
      return true; // o campo de tempo cuida das teclas
    }
    if (p.event.key === "Tab" && items[i]?.kind === "lesson") {
      setTimeFor(items[i]);
      return true;
    }
    return false;
  });

  if (timeFor) {
    const player = timeFor.lesson_key ? getPlayer(timeFor.course_id, timeFor.lesson_key) : null;
    const current = player ? Math.floor(player.currentTime()) : null;
    return (
      <div className="ne-menu ne-menu-time">
        <p className="ne-menu-title">
          Momento em <strong>{timeFor.title}</strong>
        </p>
        <StampTimeStep
          duration={timeFor.duration}
          suggestion={current}
          onDone={(value) => (value === undefined ? setTimeFor(null) : command({ ...timeFor, seconds: value } as never))}
        />
      </div>
    );
  }

  if (!items.length) {
    return <div className="ne-menu ne-menu-empty">{query ? `Nada encontrado para “${query}”` : "Nenhum curso na sua biblioteca"}</div>;
  }
  return (
    <div className="ne-menu ne-menu-wide" role="listbox" aria-label="Citar curso, módulo ou aula">
      {items.map((t, i) => (
        <ScrollIntoView key={`${t.kind}:${t.course_id}:${t.section_id ?? ""}:${t.lesson_key ?? ""}`} active={i === index} onSelect={() => choose(t)} onHover={() => setIndex(i)} className={`is-${t.kind}`}>
          <span className="ne-menu-kind">{KIND[t.kind]}</span>
          <span className="ne-menu-text">
            <strong>{t.title}</strong>
            <small>{[t.kind !== "course" ? t.course_title : null, ...t.path].filter(Boolean).join(" › ") || "Curso"}</small>
          </span>
          {t.kind === "lesson" && t.has_video && (
            <span
              role="button"
              tabIndex={-1}
              className="ne-menu-time-button"
              title="Citar um momento do vídeo (Tab)"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTimeFor(t);
              }}
            >
              ⏱
            </span>
          )}
        </ScrollIntoView>
      ))}
      <p className="ne-menu-foot">↑↓ escolher · Enter citar · Tab citar com tempo</p>
    </div>
  );
});

function StampTimeStep({ duration, suggestion, onDone }: { duration?: number | null; suggestion: number | null; onDone: (v: number | null | undefined) => void }) {
  return (
    <div className="ne-time-step">
      <StampInput initial={suggestion} duration={duration} onDone={(v) => onDone(v === null ? undefined : v)} />
      <div className="ne-time-step-actions">
        {suggestion !== null && (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onDone(suggestion)}>
            Agora no vídeo · {formatStamp(suggestion)}
          </button>
        )}
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onDone(null)}>
          Sem tempo
        </button>
      </div>
      <small>Enter confirma · Esc volta{duration ? ` · vídeo de ${formatStamp(duration)}` : ""}</small>
    </div>
  );
}

export const CourseMentions = Extension.create({
  name: "courseMentions",
  addProseMirrorPlugins() {
    const options: Omit<SuggestionOptions<Target>, "editor"> = {
      char: "@",
      pluginKey: new PluginKey("courseMention"),
      allowSpaces: true,
      allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
      items: ({ query }) => fetchTargets(query),
      command: ({ editor, range, props }) => {
        const t = props as Target & { seconds?: number | null };
        const label = t.kind === "course" ? t.title : `${t.course_title} › ${t.title}`;
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertCourseRef({
            courseId: t.course_id,
            kind: t.kind,
            sectionId: t.section_id ?? null,
            lessonKey: t.lesson_key ?? null,
            seconds: typeof t.seconds === "number" ? t.seconds : null,
            label,
            duration: t.duration ?? null,
          })
          .run();
      },
      render: popupRenderer(MentionMenu),
    };
    return [Suggestion({ editor: this.editor, ...options })];
  },
});
