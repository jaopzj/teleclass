import type { CSSProperties } from "react";
import { KeyboardEvent, PointerEvent, memo, useRef, useState } from "react";
import ControlButton from "./ControlButton";
import { VolumeIcon } from "./icons";

interface Props {
  volume: number;
  muted: boolean;
  onToggleMute(): void;
  onVolume(volume: number): void;
}

/** Botão de mudo + controle deslizante que se abre ao passar o mouse ou focar. */
function VolumeControl({ volume, muted, onToggleMute, onVolume }: Props) {
  const slider = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const level = muted ? 0 : volume;

  const at = (clientX: number) => {
    const rect = slider.current!.getBoundingClientRect();
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  };

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    onVolume(at(event.clientX));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    onVolume(Math.min(Math.max(level + step, 0), 1));
  }

  return (
    <div className={`pp-volume ${dragging ? "is-dragging" : ""}`}>
      <ControlButton label={muted || volume === 0 ? "Ativar som" : "Silenciar"} shortcut="M" onClick={onToggleMute}>
        <VolumeIcon level={volume} muted={muted} />
      </ControlButton>
      <div
        ref={slider}
        className="pp-volume-slider"
        role="slider"
        tabIndex={0}
        data-own-keys="true"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => dragging && onVolume(at(e.clientX))}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={onKeyDown}
        style={{ "--level": level } as CSSProperties}
      >
        <span className="pp-volume-track">
          <span className="pp-volume-fill" />
        </span>
        <span className="pp-volume-thumb" />
      </div>
    </div>
  );
}

export default memo(VolumeControl);
