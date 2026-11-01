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
  { key: "focus", label: "Foco", icon: "hourglass", to: paths.focus(), match: under("/foco") },
  { key: "notebook", label: "Anotações", icon: "note", to: paths.notebook(), match: under("/caderno") },
  { key: "add", label: "Adicionar curso", icon: "folderPlus", to: paths.indexing(), match: under("/indexacao") },
];

// Configurações da conta (hoje: os avisos do temporizador).
export const SETTINGS_NAV: NavItem = {
  key: "settings",
  label: "Configurações",
  icon: "settings",
  to: paths.settings(),
  match: (p) => p === paths.settings(),
};
