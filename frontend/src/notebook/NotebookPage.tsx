// Anotações (Caderno Digital).
//
// Cabeçalho da página (título, busca e "Nova anotação") e, abaixo, um único
// caderno: navegação à esquerda (visões, pastas, cursos, etiquetas) e a folha à
// direita, que mostra a lista ou a anotação aberta. A navegação pode ser
// recolhida (Ctrl+\) para escrever sem distrações; em telas estreitas ela vira
// uma gaveta.
import { FormEvent, useEffect, useState } from "react";
import Icon from "../components/Icon";
import { plural } from "../format";
import { navigate, paths, useSearch } from "../router";
import { Collection, createNote, Home, SearchView } from "./NoteList";
import NoteView from "./NoteView";
import Sidebar, { Location, VIEW_PARAM } from "./Sidebar";
import { useOverview } from "./state";
import "./editor/full";
import "./notebook.css";

const COLLAPSE_KEY = "teleaula:notebook:sidebar";
const NARROW = "(max-width: 900px)";

function readLocation(search: string): Location {
  const p = new URLSearchParams(search);
  const q = p.get("q")?.trim();
  const v = p.get("v");
  return {
    view: q ? "search" : v && VIEW_PARAM[v] ? VIEW_PARAM[v] : "home",
    folder: p.get("pasta") ?? undefined,
    course: p.get("curso") ?? undefined,
    lesson: p.get("aula") ?? undefined,
    tag: p.get("etiqueta") ?? undefined,
    q: q || undefined,
  };
}

/** Busca do cabeçalho: procura dentro da pasta, curso ou etiqueta aberta. */
function SearchField({ location }: { location: Location }) {
  const [query, setQuery] = useState(location.q ?? "");
  useEffect(() => setQuery(location.q ?? ""), [location.q]);
  const scoped = !!(location.folder || location.course || location.tag);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(paths.notebook({ q, pasta: location.folder, curso: location.course, etiqueta: location.tag }));
  }

  return (
    <form className="nb-search" onSubmit={submit} role="search">
      <Icon name="search" size={18} />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={scoped ? "Buscar aqui" : "Buscar nas anotações"}
        aria-label="Buscar nas anotações"
        enterKeyHint="search"
      />
    </form>
  );
}

export default function NotebookPage({ noteId }: { noteId?: string }) {
  const search = useSearch();
  // Com uma anotação aberta, nenhuma visão da navegação fica marcada.
  const location: Location = noteId ? { view: "note" } : readLocation(search);
  const query = noteId ? new URLSearchParams(search).get("q") : null;
  const { overview, error } = useOverview();
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignorado */
    }
  }, [collapsed]);
  useEffect(() => setDrawer(false), [noteId, search]);

  // Atalho: Ctrl/⌘+\ recolhe a navegação.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        if (narrow) setDrawer((d) => !d);
        else setCollapsed((c) => !c);
      }
      if (e.key === "Escape" && narrow) setDrawer(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [narrow]);

  const sideHidden = narrow ? !drawer : collapsed;
  const toolbar = (
    <button
      type="button"
      className="icon-button icon-button-sm nb-side-toggle"
      onClick={() => (narrow ? setDrawer((d) => !d) : setCollapsed((c) => !c))}
      aria-label={sideHidden ? "Mostrar navegação das anotações" : "Ocultar navegação das anotações"}
      aria-expanded={!sideHidden}
      title={`${sideHidden ? "Mostrar" : "Ocultar"} navegação (Ctrl+\\)`}
    >
      <Icon name="sidebar" size={20} />
    </button>
  );

  const total = overview?.counts.all ?? 0;
  const folders = overview?.folders.length ?? 0;
  const summary = !overview
    ? " "
    : total === 0
      ? "Seu espaço para registrar o que aprende"
      : folders
        ? `${plural(total, "anotação", "anotações")} em ${plural(folders, "pasta", "pastas")}`
        : plural(total, "anotação", "anotações");

  // A folha anima ao trocar de conteúdo (lista, pasta, anotação).
  const paneKey = noteId ?? search;

  return (
    <div className={`nb ${narrow ? "is-narrow" : ""}`}>
      <header className="page-head nb-head">
        <div>
          <h1>Anotações</h1>
          <p className="muted">{summary}</p>
        </div>
        <div className="nb-head-actions">
          <SearchField location={location} />
          <button type="button" className="button button-primary nb-new" onClick={() => void createNote(location, overview)}>
            <Icon name="plus" size={18} weight="bold" />
            <span>Nova anotação</span>
          </button>
        </div>
      </header>

      <div className={`nb-book ${sideHidden ? "is-side-hidden" : ""}`}>
        {narrow && drawer && <div className="nb-scrim" onClick={() => setDrawer(false)} />}
        <div className="nb-side-wrap" aria-hidden={sideHidden}>
          {error && !overview ? (
            <div className="nb-side nb-side-error">
              <Icon name="alert" size={20} />
              <p>Não foi possível carregar a navegação.</p>
            </div>
          ) : (
            <Sidebar overview={overview} location={location} onNavigate={() => narrow && setDrawer(false)} />
          )}
        </div>
        <main className={`nb-main ${noteId ? "is-doc" : ""}`} key={paneKey}>
          {noteId ? (
            <NoteView noteId={noteId} query={query} overview={overview} toolbar={toolbar} />
          ) : location.view === "search" ? (
            <SearchView location={location} overview={overview} toolbar={toolbar} />
          ) : location.view === "home" && !location.folder && !location.course && !location.tag ? (
            <Home overview={overview} toolbar={toolbar} />
          ) : (
            <Collection location={location} overview={overview} toolbar={toolbar} />
          )}
        </main>
      </div>
    </div>
  );
}
