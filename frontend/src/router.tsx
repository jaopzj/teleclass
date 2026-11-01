// Roteador mínimo sobre a History API: troca de página sem recarregar e
// mantém os links funcionando com Ctrl/⌘ + clique (nova aba).
import { AnchorHTMLAttributes, MouseEvent, useEffect, useSyncExternalStore } from "react";

const EVENT = "teleaula:navigate";

export function navigate(to: string, { replace = false } = {}) {
  if (to === location.pathname + location.search + location.hash) return;
  history[replace ? "replaceState" : "pushState"](null, "", to);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(EVENT, callback);
  };
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

/** Parâmetros da URL (`?t=194`); muda junto com a navegação. */
export function useSearchParam(name: string): string | null {
  const search = useSyncExternalStore(subscribe, () => location.search);
  return new URLSearchParams(search).get(name);
}

export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => location.search);
}

/** Compara o caminho com um padrão como `/cursos/:id`; devolve os parâmetros ou null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function Link({ to, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  function handle(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }
  return <a href={to} onClick={handle} {...props} />;
}

/** Volta ao topo ao trocar de página. */
export function useScrollReset(path: string) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
}

export const paths = {
  home: () => "/",
  library: () => "/cursos",
  course: (id: string) => `/cursos/${encodeURIComponent(id)}`,
  lesson: (id: string, key: string, at?: number | null) =>
    `/cursos/${encodeURIComponent(id)}/aulas/${encodeURIComponent(key)}${at != null ? `?t=${Math.floor(at)}` : ""}`,
  module: (id: string, sectionId: string) => `/cursos/${encodeURIComponent(id)}#modulo-${sectionId}`,
  /** Tela "Adicionar curso"; com `snapshot`, abre a inspeção daquele canal. */
  indexing: (snapshot?: string) => (snapshot ? `/indexacao?curso=${encodeURIComponent(snapshot)}` : "/indexacao"),
  focus: (tab?: string) => (tab ? `/foco/${tab}` : "/foco"),
  notebook: (params?: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v) search.set(k, v);
    const s = search.toString();
    return `/caderno${s ? `?${s}` : ""}`;
  },
  note: (id: string, q?: string) => `/caderno/nota/${id}${q ? `?q=${encodeURIComponent(q)}` : ""}`,
};
