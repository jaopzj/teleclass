import { useAuth } from "../auth/AuthProvider";
import Icon from "../components/Icon";
import { Link, paths } from "../router";
import Logo from "../ui/Logo";
import { NavItem, PRIMARY_NAV, SETTINGS_NAV } from "./nav";

/**
 * Navegação principal. Desktop: barra lateral fixa. Telas médias: só ícones
 * (com dica). Celular: gaveta aberta pelo botão de menu (`open`).
 */
export default function Sidebar({ path, open, onNavigate }: { path: string; open: boolean; onNavigate: () => void }) {
  const { logout } = useAuth();
  return (
    <aside className={`sidebar ${open ? "is-open" : ""}`} aria-label="Navegação principal">
      <Link to={paths.home()} className="sidebar-brand" aria-label="TeleClass, início" onClick={onNavigate}>
        <Logo />
      </Link>
      <nav className="sidebar-nav">
        <ul>
          {PRIMARY_NAV.map((item) => (
            <li key={item.key}>
              <NavLink item={item} path={path} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        <ul className="sidebar-foot">
          <li>
            <NavLink item={SETTINGS_NAV} path={path} onNavigate={onNavigate} />
          </li>
          <li>
            <button type="button" className="nav-item" onClick={logout} data-tip="Sair" data-tip-side="right">
              <Icon name="logout" size={22} />
              <span className="nav-label">Sair</span>
            </button>
          </li>
        </ul>
      </nav>
    </aside>
  );
}

function NavLink({ item, path, onNavigate }: { item: NavItem; path: string; onNavigate: () => void }) {
  const active = item.match(path);
  return (
    <Link
      to={item.to}
      className={`nav-item ${active ? "is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      data-tip={item.label}
      data-tip-side="right"
    >
      <Icon name={item.icon} size={22} />
      <span className="nav-label">{item.label}</span>
    </Link>
  );
}
