import { lazy, Suspense, useEffect, useState } from "react";
import AccountMenu from "./auth/AccountMenu";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import AuthScreen, { AUTH_PATHS } from "./auth/AuthScreen";
import Icon from "./components/Icon";
import CoursePage from "./pages/CoursePage";
import LessonPage from "./pages/LessonPage";
import LibraryPage from "./pages/LibraryPage";
import DashboardPage from "./dashboard/DashboardPage";
import Sidebar from "./layout/Sidebar";
import CourseSearch from "./layout/CourseSearch";
import Logo, { LogoMark } from "./ui/Logo";
import { resetCourses } from "./learning/coursesStore";
import { Link, matchPath, navigate, paths, usePathname, useScrollReset } from "./router";
import { resetStudyMetrics } from "./study/metricsStore";
import { startStudySync } from "./study/queue";
import FocusPage from "./focus/FocusPage";
import FocusLayer from "./focus/FocusLayer";
import { attachFocus } from "./focus/store";
import { stopAmbient } from "./focus/ambient";

// A tela de indexação é uma ferramenta de inspeção; carrega só quando usada.
const IndexingPage = lazy(() => import("./indexing/IndexingPage"));
// O Caderno traz o editor completo (fórmulas, código...); carrega quando aberto.
const NotebookPage = lazy(() => import("./notebook/NotebookPage"));

function Page({ path }: { path: string }) {
  let params;
  if ((params = matchPath("/cursos/:id/aulas/:key", path))) return <LessonPage courseId={params.id} lessonKey={params.key} />;
  if ((params = matchPath("/cursos/:id", path))) return <CoursePage courseId={params.id} />;
  if (matchPath("/indexacao", path)) return <IndexingPage />;
  if (path === "/caderno") return <NotebookPage />;
  if ((params = matchPath("/caderno/nota/:id", path))) return <NotebookPage noteId={params.id} />;
  if (path === "/foco") return <FocusPage />;
  if ((params = matchPath("/foco/:tab", path))) return <FocusPage tab={params.tab} />;
  if (path === "/cursos") return <LibraryPage />;
  if (path === "/") return <DashboardPage />;
  return (
    <div className="page page-narrow">
      <div className="empty">
        <h2>Página não encontrada</h2>
        <Link className="button" to={paths.home()}>
          Voltar ao início
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
        <span className="boot-mark">
          <LogoMark size={64} />
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
  return <Shell path={path} userId={state.user.id} />;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function Shell({ path, userId }: { path: string; userId: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Envia trechos de estudo pendentes (de visitas anteriores) e troca o cache ao trocar de conta.
  useEffect(() => {
    resetStudyMetrics();
    resetCourses();
    return startStudySync(userId);
  }, [userId]);
  // Temporizador: estado vindo do servidor, independente da página aberta.
  useEffect(() => {
    const detach = attachFocus(userId);
    return () => {
      detach();
      stopAmbient();
    };
  }, [userId]);
  // Gaveta do celular: fecha ao trocar de página e com Esc.
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const fullBleed = path === "/caderno" || path.startsWith("/caderno/");
  return (
    <>
      <div id="app-content" className="shell">
        <Sidebar path={path} open={menuOpen} onNavigate={() => setMenuOpen(false)} />
        {menuOpen && <div className="scrim shell-scrim" onClick={() => setMenuOpen(false)} />}
        <div className="shell-body">
          <header className="mobile-header">
            <button
              type="button"
              className="icon-button"
              onClick={() => setMenuOpen(true)}
              aria-label="Abrir menu"
              aria-expanded={menuOpen}
            >
              <Icon name="menu" size={26} />
            </button>
            <Link to={paths.home()} className="mobile-brand" aria-label="TeleClass, início">
              <Logo />
            </Link>
            <AccountMenu compact />
          </header>
          <header className="topbar">
            <CourseSearch />
            <AccountMenu />
          </header>
          <main className={`app-main ${fullBleed ? "is-notebook" : ""}`}>
            <Suspense fallback={<div className="page page-narrow muted">Carregando...</div>}>
              <Page path={path} />
            </Suspense>
          </main>
        </div>
      </div>
      <FocusLayer onFocusPage={path === "/foco"} contentId="app-content" />
    </>
  );
}
