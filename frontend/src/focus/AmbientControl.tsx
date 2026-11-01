import { CSSProperties, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import { pauseAmbient, playAmbient, resumeAmbient, setAmbientVolume, SOUNDS, stopAmbient, useAmbient } from "./ambient";

/** Seletor de som ambiente: escolher, tocar/pausar, parar e volume. */
export default function AmbientControl({ inline = false }: { inline?: boolean }) {
  const ambient = useAmbient();
  const [open, setOpen] = useState(inline);
  const root = useRef<HTMLDivElement>(null);
  const playing = ambient.status === "playing";
  const active = SOUNDS.find((s) => s.id === ambient.sound);

  useEffect(() => {
    if (!open || inline) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        e.preventDefault(); // Esc fecha o painel, não sai do Focus Mode
        setOpen(false);
      } else if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open, inline]);

  if (!ambient.supported) return inline ? <p className="muted small">Este navegador não reproduz sons ambientes.</p> : null;

  const panel = (
    <div className={`ambient-panel ${inline ? "is-inline" : ""}`} role={inline ? undefined : "dialog"} aria-label="Sons ambientes">
      {!inline && <p className="ambient-title">Som ambiente</p>}
      <div className="ambient-grid" role="radiogroup" aria-label="Escolha um som">
        {SOUNDS.map((s) => {
          const selected = ambient.sound === s.id && ambient.status !== "stopped";
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`ambient-chip ${selected ? "is-on" : ""}`}
              onClick={() => (selected && playing ? pauseAmbient() : selected ? resumeAmbient() : playAmbient(s.id))}
            >
              <Icon name={s.icon} size={18} />
              <span>{s.name}</span>
              {selected && <span className={`ambient-eq ${playing ? "" : "is-paused"}`} aria-hidden="true"><i /><i /><i /></span>}
            </button>
          );
        })}
      </div>
      <div className="ambient-row">
        <button
          type="button"
          className="ambient-icon"
          onClick={() => (playing ? pauseAmbient() : ambient.status === "paused" ? resumeAmbient() : playAmbient(ambient.sound ?? "rain"))}
          aria-label={playing ? "Pausar som" : "Tocar som"}
        >
          <Icon name={playing ? "pause" : "play"} size={14} />
        </button>
        <label className="ambient-volume">
          <Icon name={ambient.volume === 0 ? "mute" : "volume"} size={15} />
          <span className="sr-only">Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={ambient.volume}
            onChange={(e) => setAmbientVolume(Number(e.target.value))}
            style={{ "--v": `${ambient.volume * 100}%` } as CSSProperties}
          />
        </label>
        <button type="button" className="ambient-icon" onClick={stopAmbient} disabled={ambient.status === "stopped"} aria-label="Parar som">
          <Icon name="stop" size={13} />
        </button>
      </div>
      <p className="ambient-note">Sons gerados no próprio navegador, sem download.</p>
    </div>
  );

  if (inline) return panel;
  return (
    <div className="ambient" ref={root}>
      <button type="button" className={`fbar-btn ${playing ? "is-on" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name={active?.icon ?? "volume"} size={16} />
        <span className="fbar-btn-label">{playing && active ? active.name : "Som ambiente"}</span>
      </button>
      {open && panel}
    </div>
  );
}
