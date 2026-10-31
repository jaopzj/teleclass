// Itens da navegação principal. A barra lateral (desktop), o trilho de ícones
// (telas médias) e a gaveta (celular) usam esta mesma lista.
import type { IconName } from "../components/Icon";
import { paths } from "../router";

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  to: string;
  /** O item fica ativo para estes caminhos. */
  match: (path: string) => boolean;
}

const under = (base: string) => (path: string) => path === base || path.startsWith(`${base}/`);

export const PRIMARY_NAV: NavItem[] = [
  { key: "home", label: "Início", icon: "home", to: paths.home(), match: (p) => p === "/" },
  { key: "courses", label: "Meus cursos", icon: "courses", to: paths.library(), match: under("/cursos") },
  { key: "focus", label: "Foco", icon: "hourglass", to: paths.focus(), match: (p) => under("/foco")(p) && p !== paths.focus("ajustes") },
  { key: "notebook", label: "Anotações", icon: "note", to: paths.notebook(), match: under("/caderno") },
  { key: "add", label: "Adicionar curso", icon: "folderPlus", to: paths.indexing(), match: under("/indexacao") },
];

// Provisório: enquanto não há uma página de configurações gerais, o item leva
// aos ajustes do temporizador (notificações, sons e avisos), os únicos que existem.
export const SETTINGS_NAV: NavItem = {
  key: "settings",
  label: "Configurações",
  icon: "settings",
  to: paths.focus("ajustes"),
  match: (p) => p === paths.focus("ajustes"),
};
