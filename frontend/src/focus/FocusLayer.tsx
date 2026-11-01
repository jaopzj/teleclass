import { useEffect } from "react";
import Toasts from "../notifications/Toasts";
import { isBreak } from "./derive";
import FloatingTimer from "./FloatingTimer";
import RestScreen from "./RestScreen";
import { useFocus } from "./store";
import "./focus.css";

/**
 * Camada global do temporizador, montada uma vez acima das páginas: widget
 * flutuante, tela de descanso (bloqueio das pausas) e avisos. Sobrevive à
 * troca de página porque o estado vem do store, não da página.
 */
export default function FocusLayer({ onFocusPage, contentId }: { onFocusPage: boolean; contentId: string }) {
  const { session, locked } = useFocus();
  const resting = !!session && (locked || isBreak(session.stage));

  // Durante a pausa o resto da plataforma fica inerte (sem foco de teclado nem cliques).
  useEffect(() => {
    const el = document.getElementById(contentId);
    if (!el) return;
    el.toggleAttribute("inert", resting);
    el.setAttribute("aria-hidden", resting ? "true" : "false");
    document.body.classList.toggle("is-resting", resting);
    // A tela de descanso precisa ficar visível: sai da tela cheia do player.
    if (resting && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    return () => {
      el.removeAttribute("inert");
      el.removeAttribute("aria-hidden");
      document.body.classList.remove("is-resting");
    };
  }, [resting, contentId]);

  return (
    <>
      {session && resting && <RestScreen session={session} />}
      {!resting && !onFocusPage && <FloatingTimer />}
      <Toasts />
    </>
  );
}
