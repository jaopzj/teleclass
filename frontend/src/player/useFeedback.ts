import { useCallback, useEffect, useRef, useState } from "react";

export type Feedback =
  | { kind: "play" | "pause"; id: number }
  | { kind: "seek"; seconds: number; id: number }
  | { kind: "volume"; level: number; muted: boolean; id: number }
  | { kind: "rate"; rate: number; id: number };

type FeedbackInput =
  | { kind: "play" | "pause" }
  | { kind: "seek"; seconds: number }
  | { kind: "volume"; level: number; muted: boolean }
  | { kind: "rate"; rate: number };

const SEEK_ACCUMULATE_MS = 900;

/**
 * Indicadores temporários sobre o vídeo (um por vez). Saltos seguidos na
 * mesma direção somam (+10 s, +20 s, +30 s...) em vez de piscar.
 */
export function useFeedback() {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const counter = useRef(0);
  const lastSeek = useRef<{ at: number; seconds: number } | null>(null);
  const clearTimer = useRef<number>();

  const show = useCallback((input: FeedbackInput) => {
    const id = ++counter.current;
    let next: Feedback;
    if (input.kind === "seek") {
      const now = performance.now();
      const prev = lastSeek.current;
      const same = prev && now - prev.at < SEEK_ACCUMULATE_MS && Math.sign(prev.seconds) === Math.sign(input.seconds);
      const seconds = same ? prev!.seconds + input.seconds : input.seconds;
      lastSeek.current = { at: now, seconds };
      next = { kind: "seek", seconds, id };
    } else {
      lastSeek.current = null;
      next = { ...input, id } as Feedback;
    }
    setFeedback(next);
    window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => setFeedback(null), 1000);
  }, []);

  useEffect(() => () => window.clearTimeout(clearTimer.current), []);
  return { feedback, show };
}
