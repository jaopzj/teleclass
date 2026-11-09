import { ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Icon from "../components/Icon";

/**
 * Painel lateral (desliza da direita; no celular, sobe de baixo). Usado para
 * formulários da rotina, no lugar de modais grandes. Esc fecha e o foco volta
 * para quem abriu.
 */
export default function Sheet({ title, onClose, children, footer, labelledBy }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; labelledBy?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    const prev = opener.current;
    panel.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.rt-sheet-close)")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (prev as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);
  const id = labelledBy ?? "rt-sheet-title";
  return createPortal(
    <div className="rt-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rt-sheet" role="dialog" aria-modal="true" aria-labelledby={id} ref={panel}>
        <header className="rt-sheet-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="icon-button rt-sheet-close" onClick={onClose} aria-label="Fechar">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="rt-sheet-body">{children}</div>
        {footer && <footer className="rt-sheet-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Diálogo pequeno e direto (decisões rápidas). */
export function Dialog({ title, children, actions, onClose, wide = false }: { title: string; children: ReactNode; actions: ReactNode; onClose: () => void; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("[data-autofocus], input, select, textarea, .dialog-actions button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="dialog-backdrop rt-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog rt-dialog ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="rt-dialog-title" ref={box}>
        <h2 id="rt-dialog-title">{title}</h2>
        <div className="rt-dialog-body">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}
