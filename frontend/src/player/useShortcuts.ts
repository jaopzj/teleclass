import { RefObject, useEffect, useRef } from "react";

export interface ShortcutHandlers {
  togglePlay(): void;
  seekBy(seconds: number): void;
  toggleMute(): void;
  toggleFullscreen(): void;
}

const EDITABLE = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const INTERACTIVE = new Set(["BUTTON", "A", "SUMMARY"]);

function isEditable(el: HTMLElement) {
  return el.isContentEditable || EDITABLE.has(el.tagName) || el.closest("[contenteditable=''],[contenteditable='true']") !== null;
}

/**
 * Atalhos globais do player (uma aula por página). Regras de foco:
 * - nunca intercepta teclas em campos editáveis (anotações, inputs);
 * - ignora combinações com Ctrl/⌘/Alt (Ctrl+F, Ctrl+M etc. são do navegador);
 * - Espaço sobre um botão/link FORA do player aciona esse botão, como o
 *   navegador faria; dentro do player, sempre alterna a reprodução;
 * - setas sobre um controle deslizante do player (volume) ficam com ele;
 * - Esc não é tratado: o navegador sai da tela cheia sozinho e o player
 *   acompanha pelo evento `fullscreenchange`.
 */
export function useShortcuts(container: RefObject<HTMLElement>, handlers: ShortcutHandlers, seekStep = 10) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : document.body;
      if (isEditable(target)) return;
      const insidePlayer = !!container.current?.contains(target);
      const onSlider = insidePlayer && target.getAttribute("role") === "slider" && target.dataset.ownKeys === "true";

      const key = event.key;
      const h = ref.current;
      switch (key) {
        case " ":
        case "Spacebar":
        case "k":
        case "K":
          if (key.trim() === "" && !insidePlayer && (INTERACTIVE.has(target.tagName) || target.getAttribute("role") === "button")) return;
          if (event.repeat) break;
          h.togglePlay();
          break;
        case "ArrowLeft":
        case "j":
        case "J":
          if (onSlider) return;
          h.seekBy(-seekStep);
          break;
        case "ArrowRight":
        case "l":
        case "L":
          if (onSlider) return;
          h.seekBy(seekStep);
          break;
        case "m":
        case "M":
          if (event.repeat) break;
          h.toggleMute();
          break;
        case "f":
        case "F":
          if (event.repeat) break;
          h.toggleFullscreen();
          break;
        default:
          return;
      }
      event.preventDefault(); // evita rolar a página com Espaço/setas
    };
    // Espaço num botão do player: o navegador "clicaria" o botão no keyup,
    // somando um segundo play/pause ao nosso. Bloqueia esse clique.
    const onKeyUp = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === " " && target && container.current?.contains(target) && !isEditable(target)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [container, seekStep]);
}
