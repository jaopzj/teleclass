// Listas do Caderno: início, coleções (visão, pasta, curso, etiqueta) e busca.
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import ConfirmDialog from "../focus/ConfirmDialog";
import Icon from "../components/Icon";
import { formatRelative, plural } from "../format";
import { notify } from "../notifications/center";
import { Link, navigate, paths } from "../router";
import { ListParams, notebookApi, NOTEBOOK_EVENT, NoteSummary, Overview, SearchResult, View } from "./api";
import { MoveDialog, NameDialog } from "./dialogs";
import type { Location } from "./Sidebar";
import { folderPath, NOTE_DRAG } from "./state";
import { formatStamp } from "./time";

const VIEW_TITLE: Record<View, string> = {
  all: "Todas as anotações",
  recent: "Recentes",
  favorites: "Favoritas",
  pinned: "Fixadas",
  quick: "Notas das aulas",
  unfiled: "Sem pasta",
  archived: "Arquivadas",
  trash: "Lixeira",
};

const VIEW_EMPTY: Record<View, string> = {
  all: "Nenhuma anotação ainda. Crie a primeira ou escreva durante uma aula.",
  recent: "As anotações que você abrir ou editar aparecem aqui.",
  favorites: "Marque anotações com a estrela para encontrá-las aqui.",
  pinned: "Fixe as anotações mais importantes para mantê-las em destaque.",
  quick: "As notas que você escreve enquanto assiste às aulas aparecem aqui.",
  unfiled: "Toda anotação está organizada em uma pasta ou curso.",
  archived: "Anotações arquivadas saem das listas, mas continuam na busca de arquivadas e podem voltar quando quiser.",
  trash: "A lixeira está vazia.",
};

function useNotes(params: ListParams | null) {
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(params);
  const load = useCallback(() => {
    if (!params) return;
    notebookApi
      .list(params)
      .then((n) => {
        setNotes(n);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setNotes(null);
    load();
    window.addEventListener(NOTEBOOK_EVENT, load);
    return () => window.removeEventListener(NOTEBOOK_EVENT, load);
  }, [load]);
  return { notes, error, reload: load };
}

export async function createNote(location: Location, overview: Overview | null) {
  try {
    const note = await notebookApi.create({
      kind: "page",
      folder_id: location.folder && overview?.folders.some((f) => f.id === location.folder) ? location.folder : null,
      link: location.course ? { course_id: location.course, lesson_key: location.lesson ?? null } : null,
      tag_ids: location.tag ? [location.tag] : [],
    });
    navigate(paths.note(note.id));
  } catch (e) {
    notify({ title: "Não foi possível criar a anotação", body: (e as Error).message, tone: "neutral" });
  }
}

// --- linha de anotação ------------------------------------------------------------------

function locationLabel(n: NoteSummary) {
  const parts: string[] = [];
  if (n.folder_path.length) parts.push(n.folder_path.map((f) => f.name).join(" / "));
  if (n.context?.status === "ok") {
    const target = n.context.lesson_title ?? n.context.section_title;
    parts.push(target ? `${n.context.course_title} › ${target}` : n.context.course_title ?? "");
  } else if (n.course_id && n.context?.status === "missing_course") {
    parts.push("Curso removido");
  }
  return parts.filter(Boolean).join(" · ");
}

export function NoteRow({ note, folders, highlightTitle, snippet, query, showLesson = true }: { note: NoteSummary; folders: Overview["folders"]; highlightTitle?: string; snippet?: string; query?: string; showLesson?: boolean }) {
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<ReactNode>(null);
  const trashed = !!note.deleted_at;
  const title = note.title || (note.kind === "quick" ? note.excerpt.slice(0, 80) || "Nota rápida" : "Sem título");

  async function act(fn: () => Promise<unknown>, done?: string, undo?: () => Promise<unknown>) {
    setMenu(false);
    try {
      await fn();
      if (done) notify({ title: done, tone: "neutral", action: undo ? { label: "Desfazer", run: () => void undo() } : undefined });
    } catch (e) {
      notify({ title: "Não foi possível concluir", body: (e as Error).message, tone: "neutral" });
    }
  }

  const close = () => setDialog(null);
  return (
    <li
      className={`nb-row ${trashed ? "is-trashed" : ""}`}
      draggable={!trashed}
      onDragStart={(e) => {
        e.dataTransfer.setData(NOTE_DRAG, note.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <Link to={trashed ? "#" : paths.note(note.id, query)} className="nb-row-main" onClick={(e) => trashed && e.preventDefault()}>
        <span className={`nb-row-kind ${note.kind === "quick" ? "is-quick" : ""}`} aria-hidden="true">
          {note.kind === "quick" ? (note.timestamp_seconds != null ? formatStamp(note.timestamp_seconds) : "▶") : <Icon name="file" size={15} />}
        </span>
        <span className="nb-row-text">
          <span className="nb-row-title">
            {highlightTitle ? <Highlighted text={highlightTitle} /> : title}
            {note.pinned && <span className="nb-flag" title="Fixada">●</span>}
            {note.favorite && <span className="nb-star" title="Favorita">★</span>}
          </span>
          {snippet ? (
            <span className="nb-row-excerpt"><Highlighted text={snippet} /></span>
          ) : (
            note.excerpt && note.title && <span className="nb-row-excerpt">{note.excerpt}</span>
          )}
          <span className="nb-row-meta">
            {showLesson && locationLabel(note) && <span className="nb-row-where">{locationLabel(note)}</span>}
            {note.tags.map((t) => (
              <span key={t.id} className="nb-tag is-small" data-color={t.color}>{t.name}</span>
            ))}
            <span className="nb-row-date">{trashed ? `Excluída ${formatRelative(note.deleted_at!)}` : formatRelative(note.content_updated_at)}</span>
          </span>
        </span>
      </Link>
      <div className="nb-row-actions">
        {!trashed && (
          <button type="button" className={`nb-icon-button nb-fav ${note.favorite ? "is-on" : ""}`} onClick={() => void act(() => notebookApi.update(note.id, { favorite: !note.favorite }))} aria-label={note.favorite ? "Tirar dos favoritos" : "Favoritar"} title={note.favorite ? "Tirar dos favoritos" : "Favoritar"}>
            {note.favorite ? "★" : "☆"}
          </button>
        )}
        <button type="button" className="nb-icon-button" onClick={() => setMenu((m) => !m)} aria-label="Mais ações" aria-expanded={menu}>⋯</button>
        {menu && (
          <div className="nb-menu" role="menu" onMouseLeave={() => setMenu(false)}>
            {trashed ? (
              <>
                <button role="menuitem" onClick={() => void act(() => notebookApi.restore(note.id), "Anotação restaurada")}>Restaurar</button>
                <button role="menuitem" className="is-danger" onClick={() => { setMenu(false); setDialog(
                  <ConfirmDialog title="Excluir de vez?" confirmLabel="Excluir definitivamente" danger onCancel={close} onConfirm={() => { close(); void act(() => notebookApi.destroy(note.id), "Anotação excluída definitivamente"); }}>
                    <p>“{title}” e as imagens e anexos que só ela usa serão apagados. Isso não pode ser desfeito.</p>
                  </ConfirmDialog>); }}>Excluir de vez</button>
              </>
            ) : (
              <>
                <button role="menuitem" onClick={() => void act(() => notebookApi.update(note.id, { pinned: !note.pinned }))}>{note.pinned ? "Desafixar" : "Fixar no início"}</button>
                <button role="menuitem" onClick={() => { setMenu(false); setDialog(<MoveDialog title="Mover para…" folders={folders} current={note.folder_id} onClose={close} onMove={async (f) => { await notebookApi.update(note.id, { folder_id: f }); }} />); }}>Mover para…</button>
                {note.kind === "page" && (
                  <button role="menuitem" onClick={() => { setMenu(false); setDialog(<NameDialog title="Renomear" initial={note.title} confirmLabel="Salvar" onClose={close} onSubmit={async (name) => { await notebookApi.update(note.id, { title: name }); }} />); }}>Renomear</button>
                )}
                <button role="menuitem" onClick={() => void act(async () => { const copy = await notebookApi.duplicate(note.id); navigate(paths.note(copy.id)); })}>Duplicar</button>
                <button role="menuitem" onClick={() => void act(() => notebookApi.update(note.id, { archived: !note.archived }), note.archived ? "Anotação desarquivada" : "Anotação arquivada", () => notebookApi.update(note.id, { archived: note.archived }))}>{note.archived ? "Desarquivar" : "Arquivar"}</button>
                <button role="menuitem" className="is-danger" onClick={() => void act(() => notebookApi.trash(note.id), "Movida para a lixeira", () => notebookApi.restore(note.id))}>Mover para a lixeira</button>
              </>
            )}
          </div>
        )}
      </div>
      {dialog}
    </li>
  );
}

/** Texto com os trechos encontrados marcados pelo servidor (\u0002…\u0003). */
export function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith("\u0002") ? <mark key={i} className="nb-hit">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

function Empty({ icon, title, children }: { icon: React.ComponentProps<typeof Icon>["name"]; title: string; children?: ReactNode }) {
  return (
    <div className="nb-empty">
      <span className="nb-empty-icon"><Icon name={icon} size={22} /></span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="nb-rows" aria-busy="true">
      {[0, 1, 2, 3].map((i) => <li key={i} className="nb-row is-skeleton"><span className="skeleton" /></li>)}
    </ul>
  );
}

// --- coleção --------------------------------------------------------------------------------

export function Collection({ location, overview, toolbar }: { location: Location; overview: Overview | null; toolbar: ReactNode }) {
  const [sort, setSort] = useState<ListParams["sort"]>("updated");
  const view = location.view === "home" || location.view === "search" ? "all" : location.view;
  const params: ListParams = {
    view: location.folder || location.course || location.tag ? "all" : view,
    folder: location.folder,
    course: location.course,
    lesson: location.lesson,
    tag: location.tag,
    sort: location.course && sort === "updated" ? "updated" : sort,
  };
  const { notes, error, reload } = useNotes(params);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const folders = overview?.folders ?? [];

  const folder = location.folder ? folders.find((f) => f.id === location.folder) : null;
  const course = location.course ? overview?.courses.find((c) => c.id === location.course) : null;
  const tag = location.tag ? overview?.tags.find((t) => t.id === location.tag) : null;
  const subfolders = folder ? folders.filter((f) => f.parent_id === folder.id) : [];

  let title = VIEW_TITLE[params.view ?? "all"];
  let crumbs: ReactNode = null;
  if (folder) {
    title = folder.name;
    const path = folderPath(folders, folder.id).slice(0, -1);
    crumbs = path.length ? (
      <nav className="nb-crumbs">
        {path.map((f) => (
          <Link key={f.id} to={paths.notebook({ pasta: f.id })}>{f.name}</Link>
        ))}
      </nav>
    ) : null;
  } else if (location.course) {
    title = course?.title ?? "Curso removido";
    crumbs = <nav className="nb-crumbs"><span>Curso</span>{location.lesson && <Link to={paths.notebook({ curso: location.course })}>todas as aulas</Link>}</nav>;
  } else if (tag) {
    title = tag.name;
    crumbs = <nav className="nb-crumbs"><span>Etiqueta</span></nav>;
  } else if (location.folder || location.tag) {
    title = "Não encontrada";
  }

  // No curso, agrupa por aula de origem.
  const groups = useMemo(() => {
    if (!location.course || !notes) return null;
    const map = new Map<string, { label: string; order: number; notes: NoteSummary[] }>();
    for (const n of notes) {
      const own = n.course_id === location.course;
      const key = own && n.lesson_key ? `l:${n.lesson_key}` : own && n.section_id ? `s:${n.section_id}` : own ? "course" : "cites";
      const label = key.startsWith("l:")
        ? n.context?.lesson_title ? `Aula ${n.context.lesson_number} · ${n.context.lesson_title}` : "Aula removida do curso"
        : key.startsWith("s:")
          ? n.context?.section_title ?? "Módulo"
          : key === "course" ? "Sobre o curso" : "Citam este curso";
      const order = key.startsWith("l:") ? (n.context?.lesson_number ?? 9999) : key.startsWith("s:") ? -1 : key === "course" ? -2 : 99999;
      const g = map.get(key) ?? { label, order, notes: [] };
      g.notes.push(n);
      map.set(key, g);
    }
    for (const g of map.values()) g.notes.sort((a, b) => (a.timestamp_seconds ?? 1e9) - (b.timestamp_seconds ?? 1e9) || a.created_at.localeCompare(b.created_at));
    return [...map.entries()].sort((a, b) => a[1].order - b[1].order);
  }, [notes, location.course]);

  const missing = (location.folder && overview && !folder) || (location.tag && overview && !tag);

  return (
    <div className="nb-collection">
      <header className="nb-head">
        {toolbar}
        <div className="nb-head-text">
          {crumbs}
          <h1>{title}</h1>
          {notes && <p className="nb-head-sub">{plural(notes.length, "anotação", "anotações")}</p>}
        </div>
        <div className="nb-head-actions">
          {params.view === "trash" ? (
            notes && notes.length > 0 && <button className="button button-sm" onClick={() => setConfirmEmpty(true)}>Esvaziar lixeira</button>
          ) : (
            <>
              <select className="nb-sort" value={sort} onChange={(e) => setSort(e.target.value as ListParams["sort"])} aria-label="Ordenar">
                <option value="updated">Editadas recentemente</option>
                <option value="created">Criadas recentemente</option>
                <option value="title">Título (A–Z)</option>
              </select>
              {!missing && params.view !== "archived" && (
                <button className="button button-sm button-primary" onClick={() => void createNote(location, overview)}>
                  <Icon name="plus" size={14} /> Nova anotação
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {subfolders.length > 0 && (
        <ul className="nb-subfolders">
          {subfolders.map((f) => (
            <li key={f.id}>
              <Link to={paths.notebook({ pasta: f.id })} className="nb-subfolder">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" /></svg>
                {f.name}
                {f.notes > 0 && <small>{f.notes}</small>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {missing ? (
        <Empty icon="alert" title="Esta pasta ou etiqueta não existe mais">
          <Link to={paths.notebook()} className="button button-sm">Ir para o início</Link>
        </Empty>
      ) : error ? (
        <div className="alert alert-error">Não foi possível carregar: {error} <button className="link-button" onClick={reload}>Tentar de novo</button></div>
      ) : !notes ? (
        <ListSkeleton />
      ) : notes.length === 0 ? (
        <Empty icon={params.view === "trash" ? "trash" : "notes"} title={folder ? "Pasta vazia" : course ? "Nenhuma anotação deste curso" : VIEW_TITLE[params.view ?? "all"]}>
          <p>{folder ? "Crie uma anotação aqui ou arraste anotações para esta pasta." : course ? "Escreva notas durante as aulas ou crie uma anotação vinculada a este curso." : VIEW_EMPTY[params.view ?? "all"]}</p>
        </Empty>
      ) : groups ? (
        groups.map(([key, g]) => (
          <section key={key} className="nb-group">
            <h2 className="nb-group-title">{g.label}</h2>
            <ul className="nb-rows">
              {g.notes.map((n) => <NoteRow key={n.id} note={n} folders={folders} showLesson={false} />)}
            </ul>
          </section>
        ))
      ) : (
        <ul className="nb-rows">
          {notes.map((n) => <NoteRow key={n.id} note={n} folders={folders} />)}
        </ul>
      )}

      {confirmEmpty && (
        <ConfirmDialog title="Esvaziar a lixeira?" confirmLabel="Excluir tudo" danger onCancel={() => setConfirmEmpty(false)} onConfirm={async () => {
          setConfirmEmpty(false);
          const { deleted } = await notebookApi.emptyTrash();
          notify({ title: `${plural(deleted, "anotação excluída", "anotações excluídas")} definitivamente`, tone: "neutral" });
        }}>
          <p>Todas as anotações da lixeira e os arquivos que só elas usam serão apagados. Isso não pode ser desfeito.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

// --- início ------------------------------------------------------------------------------------

export function Home({ overview, toolbar }: { overview: Overview | null; toolbar: ReactNode }) {
  const pinned = useNotes({ view: "pinned" });
  const recent = useNotes({ view: "recent" });
  const favorites = useNotes({ view: "favorites" });
  const folders = overview?.folders ?? [];
  const total = overview?.counts.all ?? 0;
  const loading = !overview || !recent.notes;

  return (
    <div className="nb-collection nb-home">
      <header className="nb-head">
        {toolbar}
        <div className="nb-head-text">
          <h1>Caderno</h1>
          <p className="nb-head-sub">{overview ? (total ? plural(total, "anotação", "anotações") : "Seu espaço de conhecimento") : " "}</p>
        </div>
        <div className="nb-head-actions">
          <button className="button button-sm button-primary" onClick={() => void createNote({ view: "home" }, overview)}>
            <Icon name="plus" size={14} /> Nova anotação
          </button>
        </div>
      </header>

      {loading ? (
        <ListSkeleton />
      ) : total === 0 && overview.counts.archived === 0 ? (
        <div className="nb-welcome">
          <h2>Comece seu caderno</h2>
          <p>Tudo o que você anota nas aulas chega aqui organizado por curso. Crie também anotações livres, organize em pastas e conecte ideias de cursos diferentes.</p>
          <ul className="nb-tips">
            <li><kbd>/</kbd> insere títulos, listas, tabelas, código, fórmulas, imagens e anexos</li>
            <li><kbd>@</kbd> cita um curso, módulo ou aula, inclusive um momento do vídeo</li>
            <li><kbd>$x^2$</kbd> vira fórmula; selecione um trecho para formatar</li>
          </ul>
          <button className="button button-primary" onClick={() => void createNote({ view: "home" }, overview)}>Criar a primeira anotação</button>
        </div>
      ) : (
        <>
          {pinned.notes && pinned.notes.length > 0 && (
            <section className="nb-section">
              <h2 className="nb-section-title">Fixadas</h2>
              <ul className="nb-cards">
                {pinned.notes.map((n) => (
                  <li key={n.id}>
                    <Link to={paths.note(n.id)} className="nb-card" draggable onDragStart={(e) => e.dataTransfer.setData(NOTE_DRAG, n.id)}>
                      <strong>{n.title || n.excerpt.slice(0, 60) || "Sem título"}</strong>
                      <p>{n.title ? n.excerpt : ""}</p>
                      <small>{locationLabel(n) || formatRelative(n.content_updated_at)}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="nb-section">
            <h2 className="nb-section-title">Recentes</h2>
            {recent.notes && recent.notes.length > 0 ? (
              <ul className="nb-rows">{recent.notes.slice(0, 8).map((n) => <NoteRow key={n.id} note={n} folders={folders} />)}</ul>
            ) : (
              <p className="muted small">Nada recente.</p>
            )}
            {(recent.notes?.length ?? 0) > 8 && <Link to={paths.notebook({ v: "recentes" })} className="nb-more">Ver todas as recentes</Link>}
          </section>
          {favorites.notes && favorites.notes.length > 0 && (
            <section className="nb-section">
              <h2 className="nb-section-title">Favoritas</h2>
              <ul className="nb-rows">{favorites.notes.slice(0, 6).map((n) => <NoteRow key={n.id} note={n} folders={folders} />)}</ul>
              {favorites.notes.length > 6 && <Link to={paths.notebook({ v: "favoritas" })} className="nb-more">Ver todas as favoritas</Link>}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// --- busca -------------------------------------------------------------------------------------

export function SearchView({ location, overview, toolbar }: { location: Location; overview: Overview | null; toolbar: ReactNode }) {
  const q = location.q ?? "";
  const [archived, setArchived] = useState(false);
  const [result, setResult] = useState<{ results: SearchResult[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folders = overview?.folders ?? [];
  const folder = location.folder ? folders.find((f) => f.id === location.folder) : null;
  const course = location.course ? overview?.courses.find((c) => c.id === location.course) : null;
  const tag = location.tag ? overview?.tags.find((t) => t.id === location.tag) : null;

  useEffect(() => {
    let active = true;
    setResult(null);
    setError(null);
    notebookApi
      .search(q, { folder: location.folder, course: location.course, tag: location.tag, archived })
      .then((r) => active && setResult(r))
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [q, location.folder, location.course, location.tag, archived]);

  const scope = (params: Record<string, string | undefined>) => paths.notebook({ q, ...params });
  return (
    <div className="nb-collection">
      <header className="nb-head">
        {toolbar}
        <div className="nb-head-text">
          <nav className="nb-crumbs"><span>Busca</span></nav>
          <h1>“{q}”</h1>
          <p className="nb-head-sub">{result ? plural(result.total, "resultado", "resultados") : " "}</p>
        </div>
      </header>
      <div className="nb-scopes" role="group" aria-label="Onde buscar">
        <Link to={scope({})} className={`nb-scope ${!folder && !course && !tag ? "is-active" : ""}`}>Todas as anotações</Link>
        {folder && <span className="nb-scope is-active">Em “{folder.name}” e subpastas <Link to={scope({})} aria-label="Remover filtro">✕</Link></span>}
        {course && <span className="nb-scope is-active">No curso “{course.title ?? "removido"}” <Link to={scope({ pasta: location.folder, etiqueta: location.tag })} aria-label="Remover filtro">✕</Link></span>}
        {tag && <span className="nb-scope is-active">Etiqueta “{tag.name}” <Link to={scope({ pasta: location.folder, curso: location.course })} aria-label="Remover filtro">✕</Link></span>}
        <label className="nb-scope-check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Incluir arquivadas
        </label>
      </div>
      {error ? (
        <div className="alert alert-error">{error}</div>
      ) : !result ? (
        <ListSkeleton />
      ) : result.results.length === 0 ? (
        <Empty icon="eye2" title="Nada encontrado">
          <p>Tente outras palavras{folder || course || tag ? " ou busque em todas as anotações" : ""}. Use aspas para buscar uma frase exata.</p>
        </Empty>
      ) : (
        <ul className="nb-rows">
          {result.results.map((r) => (
            <NoteRow key={r.id} note={r} folders={folders} highlightTitle={r.title ? r.title_highlight : undefined} snippet={r.snippet} query={q} />
          ))}
        </ul>
      )}
    </div>
  );
}
