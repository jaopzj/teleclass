import type { CSSProperties } from "react";
import { KeyboardEvent, PointerEvent, RefObject, memo, useRef, useState } from "react";
import { formatClock } from "../format";
import { usePlayhead } from "./usePlayhead";

interface Props {
  video: RefObject<HTMLVideoElement>;
  duration: number;
  currentTime: number;
  buffered: Array<[number, number]>;
  onSeek(seconds: number): void;
  onScrubbing(active: boolean): void;
}

/**
 * Linha do tempo: reproduzido (acento), carregado (claro) e restante.
 * Passar o mouse mostra o tempo do ponto; arrastar move a posição e só pede
 * o novo trecho ao soltar (cada salto é um download no Telegram).
 */
function ProgressBar({ video, duration, currentTime, buffered, onSeek, onScrubbing }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const scrub = useRef<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  usePlayhead(video, root, scrub);

  const fractionAt = (clientX: number) => {
    const rect = root.current!.getBoundingClientRect();
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  };

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!duration || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrub.current = fractionAt(event.clientX);
    setHover(scrub.current);
    setDragging(true);
    onScrubbing(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const fraction = fractionAt(event.clientX);
    if (dragging) scrub.current = fraction;
    if (event.pointerType === "mouse" || dragging) setHover(fraction);
  }

  function finish(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    if (!dragging) return;
    if (commit && scrub.current !== null) onSeek(scrub.current * duration);
    scrub.current = null;
    setDragging(false);
    onScrubbing(false);
    if (event.pointerType !== "mouse") setHover(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Home") onSeek(0);
    else if (event.key === "End") onSeek(duration);
    else return;
    event.preventDefault();
  }

  const pct = (value: number) => `${duration ? (value / duration) * 100 : 0}%`;
  return (
    <div
      ref={root}
      className={`pp-progress ${dragging ? "is-dragging" : ""}`}
      role="slider"
      tabIndex={0}
      aria-label="Posição do vídeo"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={`${formatClock(currentTime)} de ${formatClock(duration)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, true)}
      onPointerCancel={(e) => finish(e, false)}
      onPointerLeave={() => !dragging && setHover(null)}
      onKeyDown={onKeyDown}
    >
      <div className="pp-track">
        {buffered.map(([start, end]) => (
          <span key={start} className="pp-buffered" style={{ left: pct(start), width: pct(end - start) }} />
        ))}
        {hover !== null && <span className="pp-hover" style={{ width: `${hover * 100}%` }} />}
        <span className="pp-played" />
      </div>
      <span className="pp-thumb" />
      {hover !== null && duration > 0 && (
        <span className="pp-time-tip" style={{ "--x": hover } as CSSProperties}>
          {formatClock(hover * duration)}
        </span>
      )}
    </div>
  );
}

export default memo(ProgressBar);
