// Notas rápidas da aula: escritas durante o vídeo, com o instante capturado
// automaticamente, salvamento automático e acesso pelo Caderno.
import type { JSONContent } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "../focus/ConfirmDialog";
import Icon from "../components/Icon";
import { formatRelative } from "../format";
import { notify } from "../notifications/center";
import { usePlayer } from "../player/controller";
import { Link, navigate, paths } from "../router";
import { LessonNotes as LessonNotesData, notebookApi, NOTEBOOK_EVENT, QuickNote } from "./api";
import { EditorEnv } from "./editor/env";
import NoteEditor from "./editor/NoteEditor";
import { StampInput } from "./editor/nodes/Timestamp";
import { formatStamp } from "./time";
import { SYNC_LABEL, useNoteSync } from "./useNoteSync";
import "./notebook.css";

const EMPTY: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

const isEmpty = (doc: JSONContent) => !JSON.stringify(doc).includes('"text"') && !JSON.stringify(doc).includes('"timestamp"');

interface Props {
  courseId: string;
  lessonKey: string;
  lessonTitle: string;
  duration: number | null;
  /** Quantas notas e páginas a aula tem (a aba "Anotações" mostra o número). */
  onCount?: (count: number) => void;
}

/** Conteúdo da aba "Anotações" no painel da aula. */
export default function LessonNotes({ courseId, lessonKey, lessonTitle, duration, onCount }: Props) {
  const [data, setData] = useState<LessonNotesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [composerId, setComposerId] = useState<string | null>(null);

  const load = useCallback(() => {
    notebookApi
      .lesson(courseId, lessonKey)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [courseId, lessonKey]);

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener(NOTEBOOK_EVENT, onChange);
    return () => window.removeEventListener(NOTEBOOK_EVENT, onChange);
  }, [load]);

  const finishComposer = useCallback(() => {
    setComposerId(null);
    setComposerKey((k) => k + 1);
    load();
  }, [load]);

  const quick = (data?.quick ?? []).filter((n) => n.id !== composerId);
  const count = (data?.quick.length ?? 0) + (data?.pages.length ?? 0);
  useEffect(() => onCount?.(count), [count, onCount]);

  return (
    <div className="ln">
      <div className="ln-body">
          <QuickNoteCard
            key={`composer-${composerKey}`}
            note={null}
            courseId={courseId}
            lessonKey={lessonKey}
            duration={duration}
            onCreated={(id) => setComposerId(id)}
            onFinish={finishComposer}
          />

          {error && (
            <div className="alert alert-error ln-error">
              Não foi possível carregar suas anotações. <button className="link-button" onClick={load}>Tentar de novo</button>
            </div>
          )}
          {!data && !error && <div className="ln-loading skeleton" />}

          {data && quick.length === 0 && !composerId && (
            <p className="ln-empty">
              Escreva acima enquanto assiste. O instante do vídeo é guardado junto e cada nota aparece no seu Caderno.
            </p>
          )}

          {quick.length > 0 && (
            <ol className="ln-list">
              {quick.map((note) => (
                <li key={note.id}>
                  <QuickNoteCard note={note} courseId={courseId} lessonKey={lessonKey} duration={duration} onDeleted={load} />
                </li>
              ))}
            </ol>
          )}

          {data && (data.pages.length > 0 || data.citing.length > 0) && (
            <section className="ln-related">
              <h3>No Caderno</h3>
              <ul>
                {data.pages.map((p) => (
                  <li key={p.id}>
                    <Link to={paths.note(p.id)} className="ln-related-item">
                      <Icon name="file" size={14} />
                      <span>{p.title || "Sem título"}</span>
                      {p.timestamp_seconds != null && <small>{formatStamp(p.timestamp_seconds)}</small>}
                    </Link>
                  </li>
                ))}
                {data.citing.map((p) => (
                  <li key={p.id}>
                    <Link to={paths.note(p.id)} className="ln-related-item" title={`“${p.title || "Sem título"}” cita ${lessonTitle}`}>
                      <Icon name="link" size={14} />
                      <span>{p.title || "Sem título"}</span>
                      {p.moments.length > 0 && <small>{p.moments.map(formatStamp).join(" · ")}</small>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
      </div>
      <footer className="ln-foot">
        <Link to={paths.notebook({ curso: courseId, aula: lessonKey })} className="ln-open">
          <Icon name="book" size={15} /> Abrir no Caderno
        </Link>
      </footer>
    </div>
  );
}

// --- uma nota rápida ------------------------------------------------------------------------

function QuickNoteCard({
  note,
  courseId,
  lessonKey,
  duration,
  onCreated,
  onFinish,
  onDeleted,
}: {
  note: QuickNote | null;
  courseId: string;
  lessonKey: string;
  duration: number | null;
  onCreated?: (id: string) => void;
  onFinish?: () => void;
  onDeleted?: () => void;
}) {
  const player = usePlayer(courseId, lessonKey);
  const isDraft = note === null;
  const [timestamp, setTimestamp] = useState<number | null>(note?.timestamp_seconds ?? null);
  const [captured, setCaptured] = useState(!isDraft);
  const [liveTime, setLiveTime] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [editingTime, setEditingTime] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hasText, setHasText] = useState(!!note && !isEmpty(note.doc));
  const timestampRef = useRef(timestamp);
  timestampRef.current = timestamp;
  const editorApi = useRef<import("@tiptap/core").Editor | null>(null);
  const card = useRef<HTMLDivElement>(null);

  // Enquanto a nova nota está vazia, o tempo acompanha o vídeo; ao começar a escrever, congela.
  useEffect(() => {
    if (!isDraft || captured || !player) return;
    const tick = () => setLiveTime(Math.floor(player.currentTime()));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [isDraft, captured, player]);

  const sync = useNoteSync({
    initial: { id: note?.id ?? null, doc: note?.doc ?? EMPTY, title: note?.title ?? "", revision: note?.revision ?? 0 },
    draftKey: isDraft ? `teleaula:quick-draft:${courseId}:${lessonKey}` : undefined,
    create: async (doc) => {
      const created = await notebookApi.create({
        kind: "quick",
        doc,
        link: { course_id: courseId, lesson_key: lessonKey },
        timestamp_seconds: timestampRef.current,
      });
      onCreated?.(created.id);
      return { id: created.id, revision: created.revision };
    },
    onRemote: (v) => editorApi.current?.commands.setContent(v.doc, { emitUpdate: false }),
  });

  function onChange(doc: JSONContent) {
    const empty = isEmpty(doc);
    setHasText(!empty);
    if (isDraft && !captured && !empty) {
      setCaptured(true);
      setTimestamp(player ? Math.floor(player.currentTime()) : null);
    }
    if (isDraft && !sync.noteId && empty) return; // nada para criar ainda
    sync.setDoc(doc);
  }

  async function saveTimestamp(value: number | null) {
    setEditingTime(false);
    const previous = timestamp;
    setTimestamp(value);
    setCaptured(true);
    if (!sync.noteId) return; // ainda não existe: vai junto na criação
    try {
      await notebookApi.update(sync.noteId, { timestamp_seconds: value });
    } catch (e) {
      setTimestamp(previous);
      notify({ title: "Não foi possível mudar o tempo", body: (e as Error).message, tone: "neutral" });
    }
  }

  async function remove() {
    setConfirmDelete(false);
    if (!sync.noteId) return;
    const id = sync.noteId;
    try {
      await notebookApi.trash(id);
      onDeleted?.();
      notify({
        title: "Nota movida para a lixeira",
        tone: "neutral",
        action: { label: "Desfazer", run: () => void notebookApi.restore(id) },
      });
      if (isDraft) onFinish?.();
    } catch (e) {
      notify({ title: "Não foi possível excluir", body: (e as Error).message, tone: "neutral" });
    }
  }

  async function convert() {
    if (!sync.noteId) return;
    await sync.saveNow();
    try {
      const page = await notebookApi.update(sync.noteId, { kind: "page", title: note?.title || "" });
      navigate(paths.note(page.id));
    } catch (e) {
      notify({ title: "Não foi possível transformar a nota", body: (e as Error).message, tone: "neutral" });
    }
  }

  const env: EditorEnv = useMemo(() => ({ variant: "compact", lesson: { courseId, lessonKey, duration }, refs: [] }), [courseId, lessonKey, duration]);
  const shownTime = isDraft && !captured ? liveTime : timestamp;
  const status = sync.status;
  const showStatus = status !== "saved" || (sync.savedAt && Date.now() - sync.savedAt < 2500);

  return (
    <div
      ref={card}
      className={`qn ${isDraft ? "is-draft" : ""} ${focused ? "is-focused" : ""} qn-${status}`}
      onKeyDown={(e) => {
        // Ctrl/⌘+Enter: conclui esta nota e começa outra.
        if (isDraft && sync.noteId && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          void sync.saveNow().then(() => onFinish?.());
        }
      }}
    >
      <div className="qn-head">
        {editingTime ? (
          <StampInput initial={timestamp ?? liveTime ?? 0} duration={duration} onDone={(v) => (v === null ? setEditingTime(false) : void saveTimestamp(v))} onRemove={() => void saveTimestamp(null)} />
        ) : shownTime != null ? (
          <button
            type="button"
            className={`qn-time ${isDraft && !captured ? "is-live" : ""}`}
            onClick={() => (isDraft && !captured ? setEditingTime(true) : player?.seek(shownTime, { play: true }))}
            title={isDraft && !captured ? "O tempo do vídeo é guardado quando você começa a escrever. Clique para digitar outro." : "Ir para este momento do vídeo"}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>
            {formatStamp(shownTime)}
          </button>
        ) : (
          <button type="button" className="qn-time is-empty" onClick={() => setEditingTime(true)} title="Marcar um tempo do vídeo">
            + tempo
          </button>
        )}
        {!isDraft && note && <span className="qn-date">{formatRelative(note.content_updated_at)}</span>}
        {isDraft && !hasText && <span className="qn-date">Nova nota</span>}
        <span className="qn-spacer" />
        {showStatus && sync.noteId !== null && (
          <span className={`qn-status save-${status}`} role="status" aria-live="polite">
            <span className="save-dot" />
            {SYNC_LABEL[status]}
          </span>
        )}
        {sync.noteId && (
          <div className="qn-menu-wrap">
            <button type="button" className="qn-icon" onClick={() => setMenu((m) => !m)} aria-label="Mais ações" aria-expanded={menu}>
              ⋯
            </button>
            {menu && (
              <div className="nb-menu qn-menu" role="menu" onMouseLeave={() => setMenu(false)}>
                <button role="menuitem" onClick={() => { setMenu(false); setEditingTime(true); }}>{timestamp != null ? "Editar tempo" : "Marcar tempo"}</button>
                {timestamp != null && <button role="menuitem" onClick={() => { setMenu(false); void saveTimestamp(null); }}>Tirar tempo</button>}
                <button role="menuitem" onClick={() => { setMenu(false); void convert(); }}>Transformar em anotação completa</button>
                <button role="menuitem" onClick={() => { setMenu(false); navigate(paths.notebook({ curso: courseId, aula: lessonKey })); }}>Ver no Caderno</button>
                <button role="menuitem" className="is-danger" onClick={() => { setMenu(false); setConfirmDelete(true); }}>Excluir</button>
              </div>
            )}
          </div>
        )}
      </div>

      {sync.conflict && (
        <div className="qn-conflict" role="alert">
          Esta nota mudou em outro dispositivo.
          <button className="link-button" onClick={async () => { const v = await sync.resolve("theirs"); if (v) editorApi.current?.commands.setContent(v.doc, { emitUpdate: false }); }}>Usar a versão salva</button>
          <button className="link-button" onClick={() => void sync.resolve("mine")}>Manter a minha</button>
        </div>
      )}

      <NoteEditor
        content={sync.initialDoc}
        env={env}
        onChange={onChange}
        onReady={(e) => (editorApi.current = e)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          void sync.saveNow();
          // A nova nota já criada vai para a lista ao sair dela; o campo fica livre para a próxima.
          if (isDraft && sync.noteId) {
            window.setTimeout(() => {
              if (!card.current?.contains(document.activeElement)) void sync.saveNow().then(() => onFinish?.());
            }, 250);
          }
        }}
        currentTime={() => (player ? player.currentTime() : null)}
        inlineToolbar={focused}
        placeholder={isDraft ? "Anote algo sobre este momento da aula…" : "Nota vazia"}
        ariaLabel={isDraft ? "Nova nota da aula" : "Nota da aula"}
      />

      {isDraft && sync.noteId && (
        <div className="qn-actions">
          <span className="muted small">Salva automaticamente · {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter para outra</span>
          <button type="button" className="button button-sm" onMouseDown={(e) => e.preventDefault()} onClick={onFinish}>
            Nova nota
          </button>
        </div>
      )}
      {status === "error" && (
        <div className="qn-error">
          Falha ao salvar. Seu texto está guardado neste aparelho. <button className="link-button" onClick={() => void sync.saveNow()}>Tentar de novo</button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog title="Excluir esta nota?" confirmLabel="Mover para a lixeira" danger onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)}>
          <p>A nota vai para a lixeira do Caderno, de onde dá para recuperá-la.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
