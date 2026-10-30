import { lazy, Suspense, useEffect } from "react";
import AccountMenu from "./auth/AccountMenu";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import AuthScreen, { AUTH_PATHS } from "./auth/AuthScreen";
import Icon from "./components/Icon";
import CoursePage from "./pages/CoursePage";
import LessonPage from "./pages/LessonPage";
import LibraryPage from "./pages/LibraryPage";
import { Link, matchPath, navigate, paths, usePathname, useScrollReset } from "./router";

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
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

/** Sem login: tela de entrada. Logado sem Telegram: etapa de vínculo. Senão: o app. */
function Gate() {
  const { state, refresh } = useAuth();
  const path = usePathname();
  useScrollReset(path);
  if (state.status === "loading") {
    return (
      <div className="boot" aria-busy="true">
        <span className="brand-mark">
          <Icon name="play" size={12} />
        </span>
      </div>
    );
  }
  if (state.status === "offline") {
    return (
      <div className="boot">
        <div className="empty">
          <Icon name="alert" size={28} />
          <h2>Servidor indisponível</h2>
          <p>{state.message}</p>
          <button type="button" className="button button-primary" onClick={refresh}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }
  if (state.status === "anonymous") return <AuthScreen mode={path === AUTH_PATHS.signup ? "signup" : "login"} />;
  if (!state.telegram.linked) return <AuthScreen mode="signup" />;
  if (path === AUTH_PATHS.login || path === AUTH_PATHS.signup) return <Redirect to="/" />;
  return <Shell path={path} />;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function Shell({ path }: { path: string }) {
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
        <AccountMenu />
      </header>
      <main className="app-main">
        <Suspense fallback={<div className="page page-narrow muted">Carregando...</div>}>
          <Page path={path} />
        </Suspense>
      </main>
    </>
  );
}
