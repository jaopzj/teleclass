// Diálogos do Caderno: nome de pasta, mover, vincular a curso/aula e etiquetas.
import { FormEvent, KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../components/Icon";
import { Folder, LinkInput, notebookApi, Tag, Target } from "./api";
import { folderTree, FolderNode, subtreeIds } from "./state";
import { formatStamp, parseStamp, stampProblem } from "./time";

function Dialog({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="dialog-backdrop nb-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog nb-dialog ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="nb-dialog-head">
          <h2>{title}</h2>
          <button type="button" className="nb-icon-button" onClick={onClose} aria-label="Fechar">
            <Icon name="close" size={16} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function NameDialog({ title, initial = "", confirmLabel, onSubmit, onClose }: { title: string; initial?: string; confirmLabel: string; onSubmit: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Dê um nome.");
    setBusy(true);
    try {
      await onSubmit(name.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="nb-dialog-body">
        <input className="nb-input" autoFocus value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setError(null); }} onFocus={(e) => e.target.select()} aria-label="Nome" aria-invalid={!!error} />
        {error && <p className="nb-field-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Salvando…" : confirmLabel}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Escolher pasta de destino (para anotação ou pasta). */
export function MoveDialog({ title, folders, current, excludeFolder, onMove, onClose }: { title: string; folders: Folder[]; current: string | null; excludeFolder?: string; onMove: (folderId: string | null) => Promise<void>; onClose: () => void }) {
  const [selected, setSelected] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = useMemo(() => (excludeFolder ? subtreeIds(folders, excludeFolder) : new Set<string>()), [folders, excludeFolder]);
  const tree = useMemo(() => folderTree(folders), [folders]);
  async function confirm() {
    setBusy(true);
    try {
      await onMove(selected);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const row = (node: FolderNode): ReactNode => (
    <li key={node.id}>
      <button type="button" className={`nb-pick ${selected === node.id ? "is-selected" : ""}`} style={{ paddingLeft: 12 + node.depth * 16 }} disabled={blocked.has(node.id)} onClick={() => setSelected(node.id)} onDoubleClick={confirm}>
        <FolderGlyph /> {node.name}
      </button>
      {node.children.length > 0 && <ul>{node.children.map(row)}</ul>}
    </li>
  );
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="nb-dialog-body">
        <ul className="nb-pick-list">
          <li>
            <button type="button" className={`nb-pick ${selected === null ? "is-selected" : ""}`} onClick={() => setSelected(null)}>
              <Icon name="library" size={15} /> {excludeFolder ? "Raiz do Caderno" : "Sem pasta"}
            </button>
          </li>
          {tree.map(row)}
        </ul>
        {error && <p className="nb-field-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>Cancelar</button>
          <button type="button" className="button button-primary" onClick={confirm} disabled={busy || selected === current}>{busy ? "Movendo…" : "Mover"}</button>
        </div>
      </div>
    </Dialog>
  );
}

export function FolderGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
    </svg>
  );
}

/** Vincular a anotação a um curso, módulo ou aula (com tempo opcional). */
export function LinkDialog({ initial, initialSeconds, onSave, onClose }: { initial: { course_id: string | null; section_id: string | null; lesson_key: string | null; label?: string | null }; initialSeconds: number | null; onSave: (link: LinkInput | null, seconds: number | null) => Promise<void>; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Target[] | null>(null);
  const [picked, setPicked] = useState<Target | null>(null);
  const [time, setTime] = useState(initialSeconds != null ? formatStamp(initialSeconds) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let active = true;
    const t = window.setTimeout(() => {
      notebookApi.targets(query).then((r) => active && (setItems(r), setIndex(0))).catch(() => active && setItems([]));
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(t);
    };
  }, [query]);

  const seconds = time.trim() ? parseStamp(time) : null;
  const problem = picked?.kind === "lesson" && time.trim() ? stampProblem(seconds, picked.duration) : null;

  async function save(link: LinkInput | null) {
    setBusy(true);
    try {
      await onSave(link, link?.lesson_key ? seconds : null);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  function onKeyDown(e: KeyboardEvent) {
    if (!items?.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => (i + 1) % items.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => (i - 1 + items.length) % items.length); }
    if (e.key === "Enter") { e.preventDefault(); setPicked(items[index]); }
  }

  return (
    <Dialog title="Vincular a um conteúdo" onClose={onClose} wide>
      <div className="nb-dialog-body">
        {initial.course_id && !picked && (
          <p className="nb-link-current">
            Vinculada a <strong>{initial.label ?? initial.course_id}</strong>
            <button type="button" className="link-button" onClick={() => void save(null)} disabled={busy}>Remover vínculo</button>
          </p>
        )}
        {picked ? (
          <div className="nb-link-picked">
            <span className="nb-kind">{picked.kind === "lesson" ? "Aula" : picked.kind === "section" ? "Módulo" : "Curso"}</span>
            <div>
              <strong>{picked.title}</strong>
              <small>{[picked.kind !== "course" ? picked.course_title : null, ...picked.path].filter(Boolean).join(" › ")}</small>
            </div>
            <button type="button" className="link-button" onClick={() => setPicked(null)}>Trocar</button>
          </div>
        ) : (
          <>
            <input className="nb-input" autoFocus placeholder="Busque um curso, módulo ou aula" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} aria-label="Buscar conteúdo" />
            <ul className="nb-pick-list nb-target-list">
              {items === null && <li className="muted small">Carregando…</li>}
              {items?.length === 0 && <li className="muted small">Nada encontrado.</li>}
              {items?.map((t, i) => (
                <li key={`${t.kind}:${t.course_id}:${t.section_id ?? ""}:${t.lesson_key ?? ""}`}>
                  <button type="button" className={`nb-pick nb-target ${i === index ? "is-selected" : ""}`} onClick={() => setPicked(t)} onMouseEnter={() => setIndex(i)}>
                    <span className="nb-kind">{t.kind === "lesson" ? "Aula" : t.kind === "section" ? "Módulo" : "Curso"}</span>
                    <span>
                      <strong>{t.title}</strong>
                      <small>{[t.kind !== "course" ? t.course_title : null, ...t.path].filter(Boolean).join(" › ")}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {picked?.kind === "lesson" && (
          <label className="nb-time-field">
            <span>Momento do vídeo (opcional)</span>
            <input className="nb-input" value={time} onChange={(e) => setTime(e.target.value)} placeholder="mm:ss" aria-invalid={!!problem} />
            {problem && <span className="nb-field-error">{problem}</span>}
          </label>
        )}
        {error && <p className="nb-field-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="button button-primary"
            disabled={!picked || busy || !!problem}
            onClick={() => picked && void save({ course_id: picked.course_id, section_id: picked.section_id ?? null, lesson_key: picked.lesson_key ?? null })}
          >
            {busy ? "Salvando…" : "Vincular"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Escolher etiquetas da anotação (ou criar uma nova digitando). */
export function TagPicker({ all, selected, onChange, onClose }: { all: Tag[]; selected: Tag[]; onChange: (ids: string[]) => Promise<void>; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const ids = new Set(selected.map((t) => t.id));
  const q = query.trim().toLowerCase();
  const matches = all.filter((t) => !q || t.name.toLowerCase().includes(q));
  const exact = all.some((t) => t.name.toLowerCase() === q);

  useEffect(() => {
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && onClose();
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  async function toggle(tag: Tag) {
    const next = ids.has(tag.id) ? [...ids].filter((i) => i !== tag.id) : [...ids, tag.id];
    setBusy(true);
    await onChange(next).finally(() => setBusy(false));
  }
  async function createTag() {
    if (!q) return;
    setBusy(true);
    try {
      const tag = await notebookApi.createTag(query.trim());
      await onChange([...ids, tag.id]);
      setQuery("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="nb-popover nb-tag-picker" ref={box} role="dialog" aria-label="Etiquetas">
      <input
        className="nb-input"
        autoFocus
        placeholder="Buscar ou criar etiqueta"
        value={query}
        maxLength={40}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter") {
            e.preventDefault();
            if (matches.length === 1 && q) void toggle(matches[0]);
            else if (!exact) void createTag();
          }
        }}
      />
      <ul>
        {matches.map((t) => (
          <li key={t.id}>
            <button type="button" className="nb-tag-option" onClick={() => void toggle(t)} disabled={busy}>
              <span className={`nb-check ${ids.has(t.id) ? "is-on" : ""}`}>{ids.has(t.id) && <Icon name="check" size={11} />}</span>
              <span className="nb-tag-dot" data-color={t.color} />
              {t.name}
            </button>
          </li>
        ))}
        {q && !exact && (
          <li>
            <button type="button" className="nb-tag-option is-create" onClick={() => void createTag()} disabled={busy}>
              <Icon name="plus" size={13} /> Criar “{query.trim()}”
            </button>
          </li>
        )}
        {!q && all.length === 0 && <li className="muted small nb-tag-hint">Digite para criar sua primeira etiqueta.</li>}
      </ul>
    </div>
  );
}
