import { RefObject, useCallback, useEffect, useState } from "react";

type WebkitDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitDisplayingFullscreen?: boolean };

const doc = () => document as WebkitDocument;
const currentElement = () => doc().fullscreenElement ?? doc().webkitFullscreenElement ?? null;

/**
 * Tela cheia do player inteiro (contêiner), não só do <video>: controles,
 * animações e atalhos continuam os mesmos. O estado vem do evento
 * `fullscreenchange`, então entrar/sair por botão, tecla F, Esc ou pelo
 * próprio navegador mantém tudo sincronizado. O <video> não é desmontado.
 */
export function useFullscreen(container: RefObject<HTMLElement>, video: RefObject<HTMLVideoElement>) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => setActive(!!container.current && currentElement() === container.current);
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [container]);

  const enter = useCallback(async () => {
    const el = container.current as WebkitElement | null;
    if (!el) return;
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else throw new Error("sem suporte");
    } catch {
      // iPhone: só o <video> pode ir para tela cheia (com os controles do sistema).
      (video.current as WebkitVideo | null)?.webkitEnterFullscreen?.();
    }
  }, [container, video]);

  const exit = useCallback(async () => {
    if (!currentElement()) return;
    if (document.exitFullscreen) await document.exitFullscreen().catch(() => {});
    else doc().webkitExitFullscreen?.();
  }, []);

  const toggle = useCallback(() => (currentElement() === container.current ? exit() : enter()), [container, enter, exit]);

  const supported = typeof document !== "undefined" && (document.fullscreenEnabled || "webkitFullscreenEnabled" in document);
  return { active, toggle, enter, exit, supported };
}
