import { DragEvent, ReactNode, useEffect, useMemo, useState } from "react";
import ConfirmDialog from "../focus/ConfirmDialog";
import Icon, { IconName } from "../components/Icon";
import { plural } from "../format";
import { notify } from "../notifications/center";
import { Link, navigate, paths } from "../router";
import { notebookApi, Overview, View } from "./api";
import { MoveDialog, NameDialog } from "./dialogs";
import { FOLDER_DRAG, folderTree, FolderNode, NOTE_DRAG, useDismiss } from "./state";

export interface Location {
  view: View | "home" | "search" | "note";
  folder?: string;
  course?: string;
  lesson?: string;
  tag?: string;
  q?: string;
}

const VIEWS: { view: View | "home"; label: string; icon: IconName; param?: string }[] = [
  { view: "home", label: "Início", icon: "home" },
  { view: "recent", label: "Recentes", icon: "history", param: "recentes" },
  { view: "favorites", label: "Favoritas", icon: "star", param: "favoritas" },
  { view: "pinned", label: "Fixadas", icon: "pin", param: "fixadas" },
  { view: "quick", label: "Notas das aulas", icon: "play", param: "aulas" },
  { view: "all", label: "Todas", icon: "files", param: "todas" },
];

export const VIEW_PARAM: Record<string, View> = {
  recentes: "recent",
  favoritas: "favorites",
  fixadas: "pinned",
  aulas: "quick",
  todas: "all",
  "sem-pasta": "unfiled",
  arquivadas: "archived",
  lixeira: "trash",
};
export const PARAM_OF: Record<View, string> = Object.fromEntries(Object.entries(VIEW_PARAM).map(([k, v]) => [v, k])) as Record<View, string>;

async function moveNote(noteId: string, folderId: string | null) {
  try {
    await notebookApi.update(noteId, { folder_id: folderId });
    notify({ title: folderId ? "Anotação movida" : "Anotação movida para fora das pastas", tone: "neutral" });
  } catch (e) {
    notify({ title: "Não foi possível mover", body: (e as Error).message, tone: "neutral" });
  }
}

async function moveFolder(folderId: string, parentId: string | null) {
  if (folderId === parentId) return;
  try {
    await notebookApi.updateFolder(folderId, { parent_id: parentId });
  } catch (e) {
    notify({ title: "Não foi possível mover a pasta", body: (e as Error).message, tone: "neutral" });
  }
}

/** Soltar anotação ou pasta sobre uma pasta (ou sobre "Pastas", para a raiz). */
function dropProps(target: string | null, setOver: (id: string | null | undefined) => void) {
  return {
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes(NOTE_DRAG) || e.dataTransfer.types.includes(FOLDER_DRAG)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(target);
      }
    },
    onDragLeave: () => setOver(undefined),
    onDrop: (e: DragEvent) => {
      setOver(undefined);
      const note = e.dataTransfer.getData(NOTE_DRAG);
      const folder = e.dataTransfer.getData(FOLDER_DRAG);
      if (note) {
        e.preventDefault();
        void moveNote(note, target);
      } else if (folder) {
        e.preventDefault();
        void moveFolder(folder, target);
      }
    },
  };
}

interface RowProps {
  node: FolderNode;
  expanded: Set<string>;
  toggle: (id: string) => void;
  activeFolder?: string;
  over: string | null | undefined;
  setOver: (id: string | null | undefined) => void;
  onAction: (node: FolderNode, action: string) => void;
  go: () => void;
}

function FolderRow(props: RowProps) {
  const { node, expanded, toggle, activeFolder, over, setOver, onAction: folderMenu, go } = props;
  const open = expanded.has(node.id);
  const active = activeFolder === node.id;
  const [menu, setMenu] = useState(false);
  const menuRef = useDismiss(menu, () => setMenu(false));
  return (
    <li>
      <div
        className={`nb-side-row nb-folder ${active ? "is-active" : ""} ${over === node.id ? "is-drop" : ""} ${menu ? "has-menu" : ""}`}
        style={{ paddingLeft: node.depth * 16 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(FOLDER_DRAG, node.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        {...dropProps(node.id, setOver)}
      >
        <button type="button" className={`nb-twisty ${open ? "is-open" : ""} ${node.children.length ? "" : "is-leaf"}`} onClick={() => toggle(node.id)} aria-label={open ? `Recolher ${node.name}` : `Expandir ${node.name}`} aria-expanded={node.children.length ? open : undefined} tabIndex={node.children.length ? 0 : -1}>
          <Icon name="chevron" size={12} />
        </button>
        <Link to={paths.notebook({ pasta: node.id })} className="nb-side-link" onClick={go} aria-current={active ? "page" : undefined}>
          <Icon name="folder" size={18} weight={active ? "fill" : "regular"} />
          <span className="nb-side-label">{node.name}</span>
          {node.notes > 0 && <span className="nb-count">{node.notes}</span>}
        </Link>
        <div className="nb-row-actions" ref={menuRef}>
          <button type="button" className="nb-icon-button" onClick={() => setMenu((m) => !m)} aria-label={`Ações da pasta ${node.name}`} aria-expanded={menu}>
            <Icon name="dots" size={16} />
          </button>
          {menu && (
            <div className="nb-menu" role="menu">
              <button role="menuitem" onClick={() => { setMenu(false); folderMenu(node, "sub"); }}><Icon name="folderPlus" size={16} />Nova subpasta</button>
              <button role="menuitem" onClick={() => { setMenu(false); folderMenu(node, "rename"); }}><Icon name="edit" size={16} />Renomear</button>
              <button role="menuitem" onClick={() => { setMenu(false); folderMenu(node, "move"); }}><Icon name="arrow" size={16} />Mover para…</button>
              <button role="menuitem" className="is-danger" onClick={() => { setMenu(false); folderMenu(node, "delete"); }}><Icon name="trash" size={16} />Excluir</button>
            </div>
          )}
        </div>
      </div>
      {open && node.children.length > 0 && (
        <ul className="nb-tree-children">
          {node.children.map((child) => (
            <FolderRow key={child.id} {...props} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}


export default function Sidebar({ overview, location, onNavigate }: { overview: Overview | null; location: Location; onNavigate?: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("teleaula:notebook:open-folders") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [dialog, setDialog] = useState<ReactNode>(null);
  const [over, setOver] = useState<string | null | undefined>(undefined);
  const [showAllCourses, setShowAllCourses] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("teleaula:notebook:open-folders", JSON.stringify([...expanded]));
    } catch {
      /* ignorado */
    }
  }, [expanded]);

  const tree = useMemo(() => folderTree(overview?.folders ?? []), [overview?.folders]);
  const counts = overview?.counts;

  // Abre as pastas acima da pasta atual.
  useEffect(() => {
    if (!location.folder || !overview) return;
    const map = new Map(overview.folders.map((f) => [f.id, f]));
    let parent = map.get(location.folder)?.parent_id;
    const add: string[] = [];
    while (parent) {
      add.push(parent);
      parent = map.get(parent)?.parent_id ?? null;
    }
    if (add.some((id) => !expanded.has(id))) setExpanded((s) => new Set([...s, ...add]));
  }, [location.folder, overview]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const close = () => setDialog(null);

  function newFolder(parent: string | null) {
    setDialog(
      <NameDialog
        title={parent ? "Nova subpasta" : "Nova pasta"}
        confirmLabel="Criar"
        onClose={close}
        onSubmit={async (name) => {
          const folder = await notebookApi.createFolder(name, parent);
          if (parent) setExpanded((s) => new Set([...s, parent]));
          navigate(paths.notebook({ pasta: folder.id }));
        }}
      />,
    );
  }

  function folderMenu(node: FolderNode, action: string) {
    if (action === "rename") {
      setDialog(<NameDialog title="Renomear pasta" initial={node.name} confirmLabel="Salvar" onClose={close} onSubmit={(name) => notebookApi.updateFolder(node.id, { name })} />);
    } else if (action === "sub") {
      newFolder(node.id);
    } else if (action === "move") {
      setDialog(<MoveDialog title={`Mover “${node.name}”`} folders={overview?.folders ?? []} current={node.parent_id} excludeFolder={node.id} onClose={close} onMove={(parent) => notebookApi.updateFolder(node.id, { parent_id: parent })} />);
    } else if (action === "delete") {
      setDialog(
        <ConfirmDialog
          title={`Excluir a pasta “${node.name}”?`}
          confirmLabel="Excluir pasta"
          danger
          onCancel={close}
          onConfirm={async () => {
            close();
            try {
              const { trashed } = await notebookApi.deleteFolder(node.id);
              notify({ title: "Pasta excluída", body: trashed ? `${trashed} anotação(ões) foram para a lixeira e podem ser restauradas.` : undefined, tone: "neutral" });
              if (location.folder === node.id) navigate(paths.notebook());
            } catch (e) {
              notify({ title: "Não foi possível excluir", body: (e as Error).message, tone: "neutral" });
            }
          }}
        >
          <p>As subpastas também serão excluídas. As anotações de dentro vão para a lixeira, de onde dá para recuperá-las.</p>
        </ConfirmDialog>,
      );
    }
  }

  const go = () => onNavigate?.();
  const isView = (v: Location["view"]) => location.view === v && !location.folder && !location.course && !location.tag;
  const courses = (overview?.courses ?? []).filter((c) => showAllCourses || c.notes > 0);
  const hiddenCourses = (overview?.courses ?? []).filter((c) => c.notes === 0).length;

  const viewLink = (to: string, active: boolean, icon: IconName, label: string, count?: number | null, subtle?: boolean) => (
    <Link to={to} className={`nb-side-row nb-side-link ${active ? "is-active" : ""} ${subtle ? "nb-subtle" : ""}`} onClick={go} aria-current={active ? "page" : undefined}>
      <Icon name={icon} size={18} weight={active && (icon === "star" || icon === "pin" || icon === "folder") ? "fill" : "regular"} />
      <span className="nb-side-label">{label}</span>
      {!!count && <span className="nb-count">{count}</span>}
    </Link>
  );

  return (
    <nav className="nb-side" aria-label="Navegação das anotações">
      <ul className="nb-side-group">
        {VIEWS.map((v) => (
          <li key={v.view}>
            {viewLink(v.view === "home" ? paths.notebook() : paths.notebook({ v: v.param }), isView(v.view), v.icon, v.label, v.view === "home" ? null : counts?.[v.view as View])}
          </li>
        ))}
      </ul>

      <section className="nb-side-section" aria-labelledby="nb-side-folders">
        <div className={`nb-side-title ${over === null ? "is-drop" : ""}`} {...dropProps(null, setOver)}>
          <h2 id="nb-side-folders">Pastas</h2>
          <button type="button" className="nb-icon-button" onClick={() => newFolder(null)} aria-label="Nova pasta" title="Nova pasta">
            <Icon name="plus" size={16} />
          </button>
        </div>
        {tree.length === 0 ? (
          <button type="button" className="nb-side-empty" onClick={() => newFolder(null)}>
            <Icon name="folderPlus" size={18} />
            <span>Criar uma pasta</span>
          </button>
        ) : (
          <ul className="nb-tree">
            {tree.map((node) => (
              <FolderRow key={node.id} node={node} expanded={expanded} toggle={toggle} activeFolder={location.folder} over={over} setOver={setOver} onAction={folderMenu} go={go} />
            ))}
          </ul>
        )}
        {viewLink(paths.notebook({ v: "sem-pasta" }), isView("unfiled"), "file", "Sem pasta", counts?.unfiled, true)}
      </section>

      <section className="nb-side-section" aria-labelledby="nb-side-courses">
        <div className="nb-side-title">
          <h2 id="nb-side-courses">Cursos</h2>
        </div>
        {overview && overview.courses.length === 0 && <p className="nb-side-note">Seus cursos aparecem aqui.</p>}
        <ul className="nb-side-group">
          {courses.map((c) => (
            <li key={c.id}>
              <Link to={paths.notebook({ curso: c.id })} className={`nb-side-row nb-side-link ${location.course === c.id && !location.lesson ? "is-active" : ""} ${c.notes === 0 ? "nb-subtle" : ""}`} onClick={go} title={c.title ?? "Curso removido da biblioteca"}>
                <Icon name="courses" size={18} />
                <span className="nb-side-label">{c.title ?? "Curso removido"}</span>
                {c.notes > 0 && <span className="nb-count">{c.notes}</span>}
              </Link>
            </li>
          ))}
        </ul>
        {hiddenCourses > 0 && (
          <button type="button" className="nb-side-more" onClick={() => setShowAllCourses((s) => !s)}>
            {showAllCourses ? "Mostrar só cursos com anotações" : `Ver mais ${plural(hiddenCourses, "curso", "cursos")} sem anotações`}
          </button>
        )}
      </section>

      {(overview?.tags.length ?? 0) > 0 && (
        <section className="nb-side-section" aria-labelledby="nb-side-tags">
          <div className="nb-side-title">
            <h2 id="nb-side-tags">Etiquetas</h2>
          </div>
          <ul className="nb-tag-cloud">
            {overview!.tags.map((t) => (
              <li key={t.id}>
                <Link to={paths.notebook({ etiqueta: t.id })} className={`nb-tag ${location.tag === t.id ? "is-active" : ""}`} data-color={t.color} onClick={go} aria-current={location.tag === t.id ? "page" : undefined}>
                  {t.name}
                  {!!t.notes && <small>{t.notes}</small>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="nb-side-group nb-side-bottom">
        <li>{viewLink(paths.notebook({ v: "arquivadas" }), isView("archived"), "archive", "Arquivadas", counts?.archived, true)}</li>
        <li>{viewLink(paths.notebook({ v: "lixeira" }), isView("trash"), "trash", "Lixeira", counts?.trash, true)}</li>
      </ul>
      {dialog}
    </nav>
  );
}
