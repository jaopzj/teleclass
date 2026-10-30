import { lazy, Suspense } from "react";
import Icon from "./components/Icon";
import CoursePage from "./pages/CoursePage";
import LessonPage from "./pages/LessonPage";
import LibraryPage from "./pages/LibraryPage";
import { Link, matchPath, paths, usePathname, useScrollReset } from "./router";

// A tela de indexação é uma ferramenta de inspeção; carrega só quando usada.
const IndexingPage = lazy(() => import("./indexing/IndexingPage"));

function Page({ path }: { path: string }) {
  let params;
  if ((params = matchPath("/cursos/:id/aulas/:key", path))) return <LessonPage courseId={params.id} lessonKey={params.key} />;
  if ((params = matchPath("/cursos/:id", path))) return <CoursePage courseId={params.id} />;
  if (matchPath("/indexacao", path)) return <IndexingPage />;
  if (path === "/") return <LibraryPage />;
  return (
    <div className="page page-narrow">
      <div className="empty">
        <h2>Página não encontrada</h2>
        <Link className="button" to={paths.library()}>
          Ir para meus cursos
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  const path = usePathname();
  useScrollReset(path);
  const inIndexing = path.startsWith("/indexacao");
  return (
    <>
      <header className="topbar">
        <Link to={paths.library()} className="brand">
          <span className="brand-mark">
            <Icon name="play" size={12} />
          </span>
          Teleaula
        </Link>
        <nav className="topnav">
          <Link to={paths.library()} className={!inIndexing ? "is-active" : ""}>
            Meus cursos
          </Link>
          <Link to={paths.indexing()} className={inIndexing ? "is-active" : ""}>
            Indexação
          </Link>
        </nav>
      </header>
      <main className="app-main">
        <Suspense fallback={<div className="page page-narrow muted">Carregando...</div>}>
          <Page path={path} />
        </Suspense>
      </main>
    </>
  );
}
