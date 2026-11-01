import { RefObject, useEffect } from "react";

/**
 * Escreve a posição do vídeo (0..1) na variável CSS `--played` do elemento,
 * quadro a quadro, sem renderizar o React. Durante o arraste, `override`
 * manda no valor.
 */
export function usePlayhead(
  video: RefObject<HTMLVideoElement>,
  target: RefObject<HTMLElement>,
  override: RefObject<number | null>,
) {
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const v = video.current;
      const el = target.current;
      if (v && el) {
        const forced = override.current;
        const fraction = forced ?? (v.duration > 0 && Number.isFinite(v.duration) ? v.currentTime / v.duration : 0);
        el.style.setProperty("--played", String(Math.min(Math.max(fraction, 0), 1)));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [video, target, override]);
}
