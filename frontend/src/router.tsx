// Roteador mínimo sobre a History API: troca de página sem recarregar e
// mantém os links funcionando com Ctrl/⌘ + clique (nova aba).
import { AnchorHTMLAttributes, MouseEvent, useEffect, useSyncExternalStore } from "react";

const EVENT = "teleaula:navigate";

export function navigate(to: string, { replace = false } = {}) {
  if (to === location.pathname + location.search) return;
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
  library: () => "/",
  course: (id: string) => `/cursos/${encodeURIComponent(id)}`,
  lesson: (id: string, key: string) => `/cursos/${encodeURIComponent(id)}/aulas/${encodeURIComponent(key)}`,
  indexing: () => "/indexacao",
};
