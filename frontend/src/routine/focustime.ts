// Tempo ao vivo de uma atividade enquanto o cronômetro do Foco roda nela.
import { useRef } from "react";
import type { FocusSession } from "../focus/api";
import { readout } from "../focus/derive";
import { serverNow } from "../focus/store";
import { useServerNow } from "../focus/useNow";
import type { Occurrence } from "./api";

/**
 * `invested`: tempo da atividade agora (o valor do servidor mais o que o Foco
 * contou desde a última leitura). `session`: a sessão do Foco desta atividade.
 */
export function useActivityTime(item: Occurrence, focus: FocusSession | null) {
  const session = item.focusing && focus?.activity_id === item.id ? focus : null;
  const now = useServerNow(!!session?.running);
  const base = useRef<{ item: Occurrence; focus: number } | null>(null);
  if (session && base.current?.item !== item) base.current = { item, focus: readout(session, serverNow()).focus };
  if (!session) base.current = null;
  const sessionFocus = session ? readout(session, now).focus : 0;
  const invested = session && base.current ? item.invested_seconds + Math.max(0, sessionFocus - base.current.focus) : item.invested_seconds;
  return { session, invested, sessionFocus };
}

/** Fração do tempo planejado já feita (até 100%). null sem duração. */
export function timeShare(invested: number, durationMinutes: number | null) {
  return durationMinutes ? Math.min(1, invested / (durationMinutes * 60)) : null;
}
