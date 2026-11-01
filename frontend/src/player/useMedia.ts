import { RefObject, useEffect, useMemo, useSyncExternalStore } from "react";
import { MediaStore } from "./mediaStore";

/** Liga um MediaStore ao <video> e devolve o snapshot atual. */
export function useMedia(video: RefObject<HTMLVideoElement>) {
  const store = useMemo(() => new MediaStore(), []);
  useEffect(() => {
    store.attach(video.current);
    return () => store.detach();
  }, [store, video]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { state, store };
}

/** Comandos sobre o <video>. Sempre leem o elemento real no momento da ação. */
export function mediaActions(video: RefObject<HTMLVideoElement>) {
  const el = () => video.current;
  return {
    play() {
      const v = el();
      if (!v) return;
      if (v.ended) v.currentTime = 0;
      void v.play().catch(() => {
        /* bloqueado pelo navegador ou interrompido por um pause: o estado reflete isso */
      });
    },
    pause() {
      el()?.pause();
    },
    toggle() {
      const v = el();
      if (!v) return;
      if (v.paused || v.ended) this.play();
      else v.pause();
    },
    /** Desloca a posição respeitando o início e o fim; devolve o deslocamento real. */
    seekBy(delta: number) {
      const v = el();
      if (!v) return 0;
      const end = Number.isFinite(v.duration) ? v.duration : v.currentTime + Math.max(delta, 0);
      const target = Math.min(Math.max(v.currentTime + delta, 0), end);
      const applied = target - v.currentTime;
      v.currentTime = target;
      return applied;
    },
    seekTo(seconds: number) {
      const v = el();
      if (!v) return;
      const end = Number.isFinite(v.duration) ? v.duration : seconds;
      v.currentTime = Math.min(Math.max(seconds, 0), end);
    },
    setVolume(volume: number) {
      const v = el();
      if (!v) return;
      v.volume = Math.min(Math.max(volume, 0), 1);
      v.muted = v.volume === 0;
    },
    toggleMute() {
      const v = el();
      if (!v) return;
      if (v.muted || v.volume === 0) {
        if (v.volume === 0) v.volume = 0.5;
        v.muted = false;
      } else v.muted = true;
    },
    setRate(rate: number) {
      const v = el();
      if (v) v.playbackRate = rate;
    },
  };
}

export type MediaActions = ReturnType<typeof mediaActions>;
