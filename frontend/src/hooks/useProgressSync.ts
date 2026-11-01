import { RefObject, useEffect, useRef } from "react";

const INTERVAL_MS = 10_000;

export type SavePosition = (position: number, duration: number | null, keepalive: boolean) => void;

/**
 * Salva a posição do vídeo: a cada 10 s durante a reprodução, ao pausar, ao
 * terminar, ao esconder a aba, ao fechar a página e ao sair da aula.
 *
 * `ready` só fica verdadeiro depois que a posição salva foi aplicada ao vídeo,
 * para que o carregamento (currentTime = 0) não sobrescreva o progresso.
 */
export function useProgressSync(
  video: RefObject<HTMLVideoElement>,
  ready: boolean,
  initialPosition: number,
  save: SavePosition,
) {
  const lastSaved = useRef(initialPosition);
  const saveRef = useRef(save);
  saveRef.current = save;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    const element = video.current;
    if (!element) return;

    const flush = (keepalive = false, force = false) => {
      if (!readyRef.current) return;
      const position = element.currentTime;
      if (!force && Math.abs(position - lastSaved.current) < 1) return;
      lastSaved.current = position;
      const duration = Number.isFinite(element.duration) ? element.duration : null;
      saveRef.current(position, duration, keepalive);
    };

    const timer = window.setInterval(() => {
      if (!element.paused) flush();
    }, INTERVAL_MS);
    const onPlay = () => flush(false, true); // registra "última aula assistida" já no início
    const onPause = () => flush();
    const onSeeked = () => element.paused && flush();
    const onHidden = () => document.visibilityState === "hidden" && flush(true);
    const onPageHide = () => flush(true);

    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("ended", onPause);
    element.addEventListener("seeked", onSeeked);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      flush(true); // saindo da aula (troca de rota)
      window.clearInterval(timer);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("ended", onPause);
      element.removeEventListener("seeked", onSeeked);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [video]);
}
