import { useEffect, useState } from "react";
import { serverNow } from "./store";

/**
 * "Agora" no relógio do servidor, atualizado na virada de cada segundo enquanto
 * `active`. Só apresenta: nenhuma regra depende deste relógio.
 */
export function useServerNow(active = true): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!active) return;
    let timer: number;
    const tick = () => {
      const t = serverNow();
      setNow(t);
      // Acorda logo depois da próxima virada de segundo (contagem sem "pulos").
      const ms = 1000 - ((t * 1000) % 1000) + 15;
      timer = window.setTimeout(tick, ms);
    };
    tick();
    const onVisible = () => document.visibilityState === "visible" && setNow(serverNow());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);
  return now;
}
