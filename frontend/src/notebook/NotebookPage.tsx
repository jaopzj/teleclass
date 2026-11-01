// Caderno Digital: navegação (pastas, cursos, etiquetas) + lista ou editor.
// Duas áreas, não três: a lista e o editor ocupam o mesmo espaço, e a barra
// lateral pode ser recolhida para escrever sem distrações.
import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { useSearch } from "../router";
import { Collection, Home, SearchView } from "./NoteList";
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

export default function NotebookPage({ noteId }: { noteId?: string }) {
  const search = useSearch();
  const location = readLocation(noteId ? "" : search);
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

  // Atalho: Ctrl/⌘+\ recolhe a barra lateral.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        if (narrow) setDrawer((d) => !d);
        else setCollapsed((c) => !c);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [narrow]);

  const sideHidden = narrow ? !drawer : collapsed;
  const toolbar = (
    <button
      type="button"
      className="nb-icon-button nb-side-toggle"
      onClick={() => (narrow ? setDrawer((d) => !d) : setCollapsed((c) => !c))}
      aria-label={sideHidden ? "Mostrar navegação do Caderno" : "Ocultar navegação do Caderno"}
      aria-expanded={!sideHidden}
      title={`${sideHidden ? "Mostrar" : "Ocultar"} navegação (Ctrl+\\)`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <path d="M9 4v16" />
      </svg>
    </button>
  );

  return (
    <div className={`nb ${sideHidden ? "is-side-hidden" : ""} ${narrow ? "is-narrow" : ""}`}>
      {narrow && drawer && <div className="nb-scrim" onClick={() => setDrawer(false)} />}
      <div className="nb-side-wrap" aria-hidden={sideHidden}>
        {error && !overview ? (
          <div className="nb-side nb-side-error">
            <Icon name="alert" size={18} />
            <p>Não foi possível carregar o Caderno.</p>
          </div>
        ) : (
          <Sidebar overview={overview} location={location} onNavigate={() => narrow && setDrawer(false)} />
        )}
      </div>
      <main className="nb-main">
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
  );
}
