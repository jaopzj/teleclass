// Editor completo de uma anotação no Caderno.
import type { Editor, JSONContent } from "@tiptap/core";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "../focus/ConfirmDialog";
import Icon from "../components/Icon";
import { formatRelative, formatTime, plural } from "../format";
import { notify } from "../notifications/center";
import { Link, navigate, paths } from "../router";
import { Note, notebookApi, NoteFile, Overview, ResolvedRef, Revision } from "./api";
import { EditorEnv } from "./editor/env";
import { openTarget } from "./editor/navigation";
import NoteEditor from "./editor/NoteEditor";
import { LinkDialog, MoveDialog, TagPicker } from "./dialogs";
import { formatStamp } from "./time";
import { SYNC_LABEL, useNoteSync } from "./useNoteSync";

export default function NoteView({ noteId, query, overview, toolbar }: { noteId: string; query: string | null; overview: Overview | null; toolbar: ReactNode }) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const load = useCallback(() => {
    setError(null);
    notebookApi
      .get(noteId)
      .then(setNote)
      .catch((e: { status?: number; message: string }) => setError({ status: e.status ?? 0, message: e.message }));
  }, [noteId]);
  useEffect(() => {
    setNote(null);
    load();
  }, [load]);

  if (error) {
    return (
      <div className="nb-collection">
        <header className="nb-head">{toolbar}</header>
        <div className="nb-empty">
          <span className="nb-empty-icon"><Icon name="alert" size={22} /></span>
          <h3>{error.status === 404 ? "Anotação não encontrada" : "Não foi possível abrir a anotação"}</h3>
          <p>{error.status === 404 ? "Ela pode ter sido excluída definitivamente." : error.message}</p>
          <div className="nb-empty-actions">
            {error.status !== 404 && <button className="button button-sm" onClick={load}>Tentar de novo</button>}
            <Link to={paths.notebook()} className="button button-sm">Ir para o Caderno</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!note) {
    return (
      <div className="nb-doc-wrap">
        <header className="nb-doc-bar">{toolbar}</header>
        <div className="nb-doc" aria-busy="true">
          <div className="skeleton nb-skel-title" />
          <div className="skeleton nb-skel-line" />
          <div className="skeleton nb-skel-line is-short" />
        </div>
      </div>
    );
  }
  // A chave remonta o editor quando a nota vira anotação completa (schema maior).
  return <Document key={`${note.id}:${note.kind}`} initial={note} query={query} overview={overview} toolbar={toolbar} onReload={load} />;
}

const REASON: Record<Revision["reason"], string> = {
  autosave: "Salvamento automático",
  conflict: "Antes de resolver um conflito",
  before_restore: "Antes de restaurar uma versão",
};

function Document({ initial, query, overview, toolbar, onReload }: { initial: Note; query: string | null; overview: Overview | null; toolbar: ReactNode; onReload: () => void }) {
  const [note, setNote] = useState(initial);
  const [refs, setRefs] = useState<ResolvedRef[]>(initial.refs);
  const [words, setWords] = useState(initial.words);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<ReactNode>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [history, setHistory] = useState(false);
  const editor = useRef<Editor | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const trashed = !!note.deleted_at;
  const quick = note.kind === "quick";

  const sync = useNoteSync({
    initial: { id: note.id, doc: note.doc, title: note.title, revision: note.revision },
    readOnly: trashed,
    onSaved: (ack) => {
      if (ack.refs) setRefs(ack.refs);
    },
    onRemote: (v) => {
      editor.current?.commands.setContent(v.doc, { emitUpdate: false });
      if (titleRef.current) titleRef.current.value = v.title;
      notify({ title: "Anotação atualizada com as alterações de outro dispositivo", tone: "neutral" });
    },
  });

  // Título: foco na anotação nova; altura acompanha o texto.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (!initial.title && !initial.words && !quick) el.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/⌘+S salva na hora.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void sync.saveNow();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sync]);

  const upload = useCallback(async (file: File, kind: "image" | "file"): Promise<NoteFile | null> => {
    try {
      return await notebookApi.upload(file, kind);
    } catch (e) {
      notify({ title: `Não foi possível enviar ${file.name}`, body: (e as Error).message, tone: "neutral" });
      return null;
    }
  }, []);

  const lessonLink = note.course_id && note.lesson_key ? { courseId: note.course_id, lessonKey: note.lesson_key, duration: note.context?.duration ?? null } : null;
  const env: EditorEnv = useMemo(
    () => ({ variant: quick ? "compact" : "full", lesson: lessonLink, refs, upload: quick ? undefined : upload }),
    [quick, lessonLink?.courseId, lessonLink?.lessonKey, lessonLink?.duration, refs, upload], // eslint-disable-line react-hooks/exhaustive-deps
  );

  async function update(input: Parameters<typeof notebookApi.update>[1], done?: string) {
    try {
      const next = await notebookApi.update(note.id, input);
      setNote((n) => ({ ...n, ...next, doc: n.doc }));
      if (done) notify({ title: done, tone: "neutral" });
      return next;
    } catch (e) {
      notify({ title: "Não foi possível concluir", body: (e as Error).message, tone: "neutral" });
      return null;
    }
  }

  async function convert() {
    await sync.saveNow();
    const next = await update({ kind: "page", title: titleRef.current?.value || note.title });
    if (next) onReload();
  }

  const close = () => setDialog(null);
  const status = sync.status;
  const ctx = note.context;
  const linkLabel = ctx
    ? ctx.status === "missing_course"
      ? "Curso removido da biblioteca"
      : ctx.status === "missing_target"
        ? `${ctx.course_title} › conteúdo removido`
        : [ctx.course_title, ctx.section_title ?? (ctx.lesson_title ? `Aula ${ctx.lesson_number} · ${ctx.lesson_title}` : null)].filter(Boolean).join(" › ")
    : null;

  return (
    <div className="nb-doc-wrap">
      <header className="nb-doc-bar">
        {toolbar}
        <nav className="nb-doc-crumbs" aria-label="Local da anotação">
          <Link to={paths.notebook()}>Caderno</Link>
          {note.folder_path.map((f) => (
            <Link key={f.id} to={paths.notebook({ pasta: f.id })}>{f.name}</Link>
          ))}
          {!note.folder_path.length && note.course_id && <Link to={paths.notebook({ curso: note.course_id })}>{ctx?.course_title ?? "Curso"}</Link>}
        </nav>
        <span className={`nb-sync save-${status}`} role="status" aria-live="polite" title={sync.savedAt ? `Salvo às ${formatTime(new Date(sync.savedAt).toISOString())}` : undefined}>
          <span className="save-dot" />
          {trashed ? "Na lixeira" : SYNC_LABEL[status]}
        </span>
        {!trashed && (
          <div className="nb-doc-actions">
            <button type="button" className={`nb-icon-button nb-fav ${note.favorite ? "is-on" : ""}`} onClick={() => void update({ favorite: !note.favorite })} aria-label={note.favorite ? "Tirar dos favoritos" : "Favoritar"} title={note.favorite ? "Tirar dos favoritos" : "Favoritar"} aria-pressed={note.favorite}>
              {note.favorite ? "★" : "☆"}
            </button>
            <button type="button" className={`nb-icon-button ${note.pinned ? "is-on" : ""}`} onClick={() => void update({ pinned: !note.pinned })} aria-label={note.pinned ? "Desafixar" : "Fixar no início"} title={note.pinned ? "Desafixar" : "Fixar no início"} aria-pressed={note.pinned}>
              <Icon name="target" size={15} />
            </button>
            <button type="button" className="nb-icon-button" onClick={() => setHistory((h) => !h)} aria-label="Histórico de versões" title="Histórico de versões" aria-pressed={history}>
              <Icon name="history" size={15} />
            </button>
            <div className="nb-menu-wrap">
              <button type="button" className="nb-icon-button" onClick={() => setMenu((m) => !m)} aria-label="Mais ações" aria-expanded={menu}>⋯</button>
              {menu && (
                <div className="nb-menu is-right" role="menu" onMouseLeave={() => setMenu(false)}>
                  <button role="menuitem" onClick={() => { setMenu(false); setDialog(<MoveDialog title="Mover para…" folders={overview?.folders ?? []} current={note.folder_id} onClose={close} onMove={async (f) => { await update({ folder_id: f }); }} />); }}>Mover para…</button>
                  {!quick && (
                    <button role="menuitem" onClick={() => { setMenu(false); setDialog(<LinkDialog initial={{ course_id: note.course_id, section_id: note.section_id, lesson_key: note.lesson_key, label: linkLabel }} initialSeconds={note.timestamp_seconds} onClose={close} onSave={async (link, seconds) => { const next = await notebookApi.update(note.id, link ? { link, timestamp_seconds: seconds } : { link: null }); setNote((n) => ({ ...n, ...next, doc: n.doc })); }} />); }}>{note.course_id ? "Mudar vínculo com curso" : "Vincular a curso ou aula"}</button>
                  )}
                  {quick && <button role="menuitem" onClick={() => { setMenu(false); void convert(); }}>Transformar em anotação completa</button>}
                  <button role="menuitem" onClick={async () => { setMenu(false); await sync.saveNow(); const copy = await notebookApi.duplicate(note.id); navigate(paths.note(copy.id)); }}>Duplicar</button>
                  <button role="menuitem" onClick={() => { setMenu(false); void update({ archived: !note.archived }, note.archived ? "Anotação desarquivada" : "Anotação arquivada"); }}>{note.archived ? "Desarquivar" : "Arquivar"}</button>
                  <button role="menuitem" className="is-danger" onClick={() => { setMenu(false); setDialog(
                    <ConfirmDialog title="Mover para a lixeira?" confirmLabel="Mover para a lixeira" danger onCancel={close} onConfirm={async () => {
                      close();
                      await sync.saveNow();
                      await notebookApi.trash(note.id);
                      notify({ title: "Anotação movida para a lixeira", tone: "neutral", action: { label: "Desfazer", run: () => void notebookApi.restore(note.id).then(() => navigate(paths.note(note.id))) } });
                      navigate(paths.notebook());
                    }}>
                      <p>Você pode restaurá-la pela Lixeira enquanto não a excluir definitivamente.</p>
                    </ConfirmDialog>); }}>Mover para a lixeira</button>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      <div className={`nb-doc-layout ${history ? "has-panel" : ""}`}>
        <article className="nb-doc">
          {trashed && (
            <div className="nb-banner is-warning">
              Esta anotação está na lixeira.
              <button className="button button-sm" onClick={async () => { await notebookApi.restore(note.id); onReload(); }}>Restaurar</button>
            </div>
          )}
          {note.archived && !trashed && (
            <div className="nb-banner">Arquivada: fora das listas, mas continua aqui. <button className="link-button" onClick={() => void update({ archived: false })}>Desarquivar</button></div>
          )}
          {quick && !trashed && (
            <div className="nb-banner is-quick">
              <span>Nota rápida da aula. Transforme em anotação completa para usar tabelas, fórmulas, código, imagens, anexos e citações com @.</span>
              <button className="button button-sm" onClick={() => void convert()}>Transformar</button>
            </div>
          )}
          {sync.conflict && (
            <div className="nb-banner is-conflict" role="alert">
              <div>
                <strong>Esta anotação foi alterada em outro dispositivo</strong>
                {sync.conflict.content_updated_at && ` ${formatRelative(sync.conflict.content_updated_at)}`}. Qual versão você quer manter?
                <details>
                  <summary>Ver a versão salva no servidor</summary>
                  <div className="nb-conflict-preview">
                    <NoteEditor content={sync.conflict.doc} env={{ ...env, upload: undefined }} editable={false} />
                  </div>
                </details>
              </div>
              <div className="nb-banner-actions">
                <button className="button button-sm button-primary" onClick={() => void sync.resolve("mine")}>Manter a minha</button>
                <button className="button button-sm" onClick={async () => { const v = await sync.resolve("theirs"); if (v) { editor.current?.commands.setContent(v.doc, { emitUpdate: false }); if (titleRef.current) titleRef.current.value = v.title; } }}>Usar a do servidor</button>
                <button className="button button-sm" onClick={async () => { const v = await sync.resolve("copy"); if (v) { editor.current?.commands.setContent(v.doc, { emitUpdate: false }); if (titleRef.current) titleRef.current.value = v.title; notify({ title: "Sua versão foi salva como uma nova anotação", tone: "neutral" }); } }}>Guardar a minha como cópia</button>
              </div>
            </div>
          )}

          {quick ? (
            <h1 className="nb-title is-static">{note.title || "Nota rápida"}</h1>
          ) : (
            <textarea
              ref={titleRef}
              className="nb-title"
              defaultValue={sync.initialTitle}
              placeholder="Sem título"
              rows={1}
              maxLength={200}
              readOnly={trashed}
              aria-label="Título"
              onChange={(e) => {
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
                sync.setTitle(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || (e.key === "ArrowDown" && e.currentTarget.selectionStart === e.currentTarget.value.length)) {
                  e.preventDefault();
                  editor.current?.commands.focus("start");
                }
              }}
            />
          )}

          <div className="nb-meta">
            {linkLabel && note.course_id && (
              <button
                type="button"
                className={`nb-chip ${ctx?.status !== "ok" ? "is-broken" : ""}`}
                onClick={(e) => ctx?.status === "ok" && openTarget({ courseId: note.course_id!, kind: note.lesson_key ? "lesson" : note.section_id ? "section" : "course", lessonKey: note.lesson_key, sectionId: note.section_id, seconds: note.timestamp_seconds }, e.ctrlKey || e.metaKey)}
                title={ctx?.status === "ok" ? "Abrir no curso" : "O conteúdo vinculado não existe mais"}
              >
                <Icon name={note.lesson_key ? "play" : "layers"} size={12} />
                {linkLabel}
                {note.timestamp_seconds != null && <span className="nb-chip-time">{formatStamp(note.timestamp_seconds)}</span>}
              </button>
            )}
            {note.tags.map((t) => (
              <span key={t.id} className="nb-tag" data-color={t.color}>
                {t.name}
                {!trashed && <button type="button" onClick={() => void update({ tag_ids: note.tags.filter((x) => x.id !== t.id).map((x) => x.id) })} aria-label={`Remover etiqueta ${t.name}`}>×</button>}
              </span>
            ))}
            {!trashed && (
              <span className="nb-tag-add-wrap">
                <button type="button" className="nb-chip is-ghost" onClick={() => setTagsOpen((o) => !o)}>
                  <Icon name="plus" size={12} /> Etiqueta
                </button>
                {tagsOpen && <TagPicker all={overview?.tags ?? []} selected={note.tags} onClose={() => setTagsOpen(false)} onChange={async (ids) => { await update({ tag_ids: ids }); }} />}
              </span>
            )}
            {!note.course_id && !quick && !trashed && (
              <button type="button" className="nb-chip is-ghost" onClick={() => setDialog(<LinkDialog initial={{ course_id: null, section_id: null, lesson_key: null }} initialSeconds={null} onClose={close} onSave={async (link, seconds) => { const next = await notebookApi.update(note.id, link ? { link, timestamp_seconds: seconds } : { link: null }); setNote((n) => ({ ...n, ...next, doc: n.doc })); }} />)}>
                <Icon name="link" size={12} /> Vincular a uma aula
              </button>
            )}
          </div>

          <NoteEditor
            content={sync.initialDoc}
            env={env}
            editable={!trashed}
            onChange={(doc: JSONContent, e) => {
              sync.setDoc(doc);
              setWords(e.storage.characterCount?.words?.() ?? words);
            }}
            onReady={(e) => (editor.current = e)}
            searchQuery={query}
            className="nb-editor"
            ariaLabel="Conteúdo da anotação"
          />

          <footer className="nb-doc-foot">
            <span>{plural(words, "palavra", "palavras")}</span>
            <span>Criada {formatRelative(note.created_at)}</span>
            {status === "error" && <button className="link-button" onClick={() => void sync.saveNow()}>Falha ao salvar · tentar de novo</button>}
            {status === "offline" && <span>Sem conexão: as alterações estão guardadas neste aparelho e serão enviadas quando a rede voltar.</span>}
          </footer>
        </article>

        {history && (
          <HistoryPanel
            note={note}
            env={env}
            onClose={() => setHistory(false)}
            onRestore={async (rid) => {
              await sync.saveNow();
              try {
                const restored = await notebookApi.restoreRevision(note.id, rid, sync.revision());
                sync.reset({ doc: restored.doc, title: restored.title, revision: restored.revision });
                editor.current?.commands.setContent(restored.doc, { emitUpdate: false });
                if (titleRef.current) titleRef.current.value = restored.title;
                setRefs(restored.refs);
                notify({ title: "Versão restaurada", body: "A versão anterior ficou guardada no histórico.", tone: "neutral" });
              } catch (e) {
                notify({ title: "Não foi possível restaurar", body: (e as Error).message, tone: "neutral" });
              }
            }}
          />
        )}
      </div>
      {dialog}
    </div>
  );
}

function HistoryPanel({ note, env, onClose, onRestore }: { note: Note; env: EditorEnv; onClose: () => void; onRestore: (id: number) => Promise<void> }) {
  const [items, setItems] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<(Revision & { doc: JSONContent }) | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    notebookApi.revisions(note.id).then(setItems).catch((e: Error) => setError(e.message));
  }, [note.id, note.revision]);

  return (
    <aside className="nb-panel" aria-label="Histórico de versões">
      <header className="nb-panel-head">
        <h2>Histórico</h2>
        <button type="button" className="nb-icon-button" onClick={onClose} aria-label="Fechar histórico"><Icon name="close" size={15} /></button>
      </header>
      <p className="nb-panel-hint">Versões são guardadas automaticamente a cada ~10 minutos de edição e antes de resolver conflitos.</p>
      {error && <div className="alert alert-error">{error}</div>}
      {!items && !error && <div className="skeleton nb-skel-line" />}
      {items?.length === 0 && <p className="muted small">Ainda não há versões anteriores desta anotação.</p>}
      {preview ? (
        <div className="nb-preview">
          <button type="button" className="link-button" onClick={() => setPreview(null)}>← Todas as versões</button>
          <h3>{preview.title || "Sem título"}</h3>
          <p className="muted small">{new Date(preview.created_at).toLocaleString("pt-BR")} · {plural(preview.words, "palavra", "palavras")}</p>
          <div className="nb-preview-doc">
            <NoteEditor content={preview.doc} env={{ ...env, upload: undefined, variant: note.kind === "quick" ? "compact" : "full" }} editable={false} />
          </div>
          <button type="button" className="button button-primary button-block" disabled={busy || !!note.deleted_at} onClick={async () => { setBusy(true); await onRestore(preview.id); setBusy(false); setPreview(null); }}>
            {busy ? "Restaurando…" : "Restaurar esta versão"}
          </button>
        </div>
      ) : (
        <ul className="nb-versions">
          {items?.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => notebookApi.revision(note.id, r.id).then(setPreview).catch((e: Error) => setError(e.message))}>
                <strong>{new Date(r.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</strong>
                <small>{REASON[r.reason]} · {plural(r.words, "palavra", "palavras")}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
