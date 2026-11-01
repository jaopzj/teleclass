import { ButtonHTMLAttributes, forwardRef } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  tipAlign?: "center" | "start" | "end";
}

/** Botão do player com tooltip (rótulo + atalho), que aparece após um breve atraso. */
const ControlButton = forwardRef<HTMLButtonElement, Props>(function ControlButton(
  { label, shortcut, tipAlign = "center", className = "", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`pp-btn ${className}`}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      data-tip={shortcut ? `${label} (${shortcut})` : label}
      data-tip-align={tipAlign}
      {...rest}
    >
      {children}
    </button>
  );
});

export default ControlButton;
