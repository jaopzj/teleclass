import { ReactNode, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";

export interface MenuAction {
  label: string;
  icon?: Parameters<typeof Icon>[0]["name"];
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
  separatorBefore?: boolean;
}

/** Menu de ações (⋯): abre por clique ou teclado, fecha com Esc ou clique fora. */
export default function Menu({ label, actions, children }: { label: string; actions: MenuAction[]; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const visible = actions.filter((a) => !a.hidden);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>(".rt-menu-trigger")?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...(list.current?.querySelectorAll<HTMLButtonElement>(".menu-item") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    list.current?.querySelector<HTMLButtonElement>(".menu-item")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="rt-menu" ref={root}>
      <button
        type="button"
        className="icon-button icon-button-sm rt-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {children ?? <Icon name="dots" size={18} />}
      </button>
      {open && (
        <div className="menu rt-menu-list" role="menu" ref={list}>
          {visible.map((a) => (
            <div key={a.label}>
              {a.separatorBefore && <div className="menu-sep" />}
              <button
                type="button"
                role="menuitem"
                className={`menu-item ${a.danger ? "menu-item-danger" : ""}`}
                onClick={() => {
                  setOpen(false);
                  a.onSelect();
                }}
              >
                {a.icon && <Icon name={a.icon} size={16} />}
                {a.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
