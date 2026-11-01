import { useEffect } from "react";
import Toasts from "../notifications/Toasts";
import { isBreak } from "./derive";
import FloatingTimer from "./FloatingTimer";
import FocusModeBar from "./FocusModeBar";
import { setFocusMode, useFocusModeEffect, useFocusModePreference } from "./focusMode";
import RestScreen from "./RestScreen";
import { useFocus } from "./store";
import "./focus.css";

/**
 * Camada global do temporizador, montada uma vez acima das páginas: widget
 * flutuante, Focus Mode, tela de descanso (bloqueio) e avisos. Sobrevive à
 * troca de página porque o estado vem do store, não da página.
 */
export default function FocusLayer({ onFocusPage, contentId }: { onFocusPage: boolean; contentId: string }) {
  const { session, locked, status } = useFocus();
  const preference = useFocusModePreference();
  const resting = !!session && (locked || isBreak(session.stage));
  const focusMode = preference && !!session && !resting;
  useFocusModeEffect(focusMode);

  // Sem sessão, não há Focus Mode (volta ao normal sozinho quando a sessão termina).
  useEffect(() => {
    if (status === "ready" && !session && preference) setFocusMode(false);
  }, [status, session, preference]);

  // Durante a pausa o resto da plataforma fica inerte (sem foco de teclado nem cliques).
  useEffect(() => {
    const el = document.getElementById(contentId);
    if (!el) return;
    el.toggleAttribute("inert", resting);
    el.setAttribute("aria-hidden", resting ? "true" : "false");
    document.body.classList.toggle("is-resting", resting);
    return () => {
      el.removeAttribute("inert");
      el.removeAttribute("aria-hidden");
      document.body.classList.remove("is-resting");
    };
  }, [resting, contentId]);

  return (
    <>
      {session && resting && <RestScreen session={session} />}
      {session && focusMode && !onFocusPage && <FocusModeBar session={session} />}
      {session && !resting && !focusMode && !onFocusPage && <FloatingTimer session={session} />}
      <Toasts />
    </>
  );
}
