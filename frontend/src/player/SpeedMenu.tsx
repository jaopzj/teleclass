import { memo, useEffect, useRef, useState } from "react";
import ControlButton from "./ControlButton";
import { CheckIcon } from "./icons";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export const formatRate = (rate: number) => `${rate.toLocaleString("pt-BR")}×`;

interface Props {
  rate: number;
  onRate(rate: number): void;
  onOpenChange(open: boolean): void;
}

/** Menu de velocidade (abre para cima; fecha com clique fora, Esc ou escolha). */
function SpeedMenu({ rate, onRate, onOpenChange }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => onOpenChange(open), [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLButtonElement>("[aria-checked='true']")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="pp-menu-root" ref={root}>
      <ControlButton
        label="Velocidade"
        className="pp-btn-text"
        tipAlign="end"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip-hidden={open || undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {formatRate(rate)}
      </ControlButton>
      <div className={`pp-menu ${open ? "is-open" : ""}`} role="menu" aria-label="Velocidade de reprodução" hidden={!open}>
        <p className="pp-menu-title">Velocidade</p>
        {RATES.map((value) => (
          <button
            key={value}
            type="button"
            role="menuitemradio"
            aria-checked={value === rate}
            className="pp-menu-item"
            onClick={() => {
              onRate(value);
              setOpen(false);
            }}
          >
            <span>{value === 1 ? "Normal" : formatRate(value)}</span>
            {value === rate && <CheckIcon size={16} />}
          </button>
        ))}
      </div>
    </div>
  );
}

export default memo(SpeedMenu);
