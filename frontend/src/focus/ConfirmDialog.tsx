import { ReactNode, useEffect, useRef } from "react";

/** Confirmação com foco no botão seguro e Esc para cancelar. */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancelar",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  tone,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  tone?: "rest";
}) {
  const safe = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    safe.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);
  return (
    <div className={`dialog-backdrop focus-dialog-backdrop ${tone ? `is-${tone}` : ""}`} onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="dialog focus-dialog" role="alertdialog" aria-modal="true" aria-labelledby="focus-confirm-title">
        <h2 id="focus-confirm-title">{title}</h2>
        <div className="focus-dialog-body">{children}</div>
        <div className="dialog-actions">
          <button ref={safe} type="button" className="button" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={`button ${danger ? "button-danger" : "button-primary"}`} onClick={onConfirm} disabled={busy}>
            {busy ? "Aguarde..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
