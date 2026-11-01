import { RefObject, useCallback, useEffect, useRef, useState } from "react";

const HIDE_AFTER_MS = 2600;

/**
 * Controles visíveis enquanto há interação; somem sozinhos depois de um tempo
 * sem mexer no mouse/teclado, mas só se `canHide` (vídeo tocando, nenhum menu
 * aberto, ninguém arrastando a barra, ponteiro fora da barra de controles).
 */
export function useIdle(container: RefObject<HTMLElement>, canHide: boolean) {
  const [idle, setIdle] = useState(false);
  const timer = useRef<number>();
  const canHideRef = useRef(canHide);
  canHideRef.current = canHide;

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!canHideRef.current) return;
    timer.current = window.setTimeout(() => {
      if (canHideRef.current) setIdle(true);
    }, HIDE_AFTER_MS);
  }, []);

  /** Qualquer interação: mostra os controles e reinicia a contagem. */
  const wake = useCallback(() => {
    setIdle(false);
    schedule();
  }, [schedule]);

  const hideNow = useCallback(() => {
    window.clearTimeout(timer.current);
    if (canHideRef.current) setIdle(true);
  }, []);

  useEffect(() => {
    if (canHide) schedule();
    else {
      window.clearTimeout(timer.current);
      setIdle(false);
    }
  }, [canHide, schedule]);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onLeave = (event: PointerEvent) => event.pointerType === "mouse" && hideNow();
    el.addEventListener("pointermove", wake);
    el.addEventListener("pointerdown", wake);
    el.addEventListener("focusin", wake);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      window.clearTimeout(timer.current);
      el.removeEventListener("pointermove", wake);
      el.removeEventListener("pointerdown", wake);
      el.removeEventListener("focusin", wake);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [container, wake, hideNow]);

  return { idle, wake };
}
