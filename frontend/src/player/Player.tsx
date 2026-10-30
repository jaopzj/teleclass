import type { CSSProperties } from "react";
import { MouseEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatClock } from "../format";
import { SavePosition, useProgressSync } from "../hooks/useProgressSync";
import type { LessonContext } from "../study/recorder";
import { useStudyTracking } from "../study/useStudyTracking";
import ControlButton from "./ControlButton";
import { diagnose, PlaybackError } from "./errors";
import { FullscreenIcon, PauseIcon, PlayIcon, SkipIcon } from "./icons";
import { EndOverlay, ErrorOverlay, FeedbackLayer, Loader, NextLesson, StartOverlay } from "./Overlays";
import { loadPreferences, savePreferences } from "./preferences";
import ProgressBar from "./ProgressBar";
import SpeedMenu from "./SpeedMenu";
import { useFeedback } from "./useFeedback";
import { useFullscreen } from "./useFullscreen";
import { useIdle } from "./useIdle";
import { mediaActions, useMedia } from "./useMedia";
import { useShortcuts } from "./useShortcuts";
import VolumeControl from "./VolumeControl";
import "./player.css";

const SKIP_SECONDS = 10;
// Não vale retomar nos últimos segundos: a pessoa provavelmente quer rever.
const RESUME_TAIL_SECONDS = 10;

export interface PlayerProps {
  src: string;
  poster?: string;
  title: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  initialPosition: number;
  onSavePosition: SavePosition;
  next?: NextLesson;
  /** Aula a que o tempo de reprodução é creditado (métricas de estudo). */
  study?: LessonContext;
}

/**
 * Player do Teleaula. Composição:
 * - mediaStore/useMedia: estado derivado dos eventos reais do <video>;
 * - useFullscreen: tela cheia do contêiner inteiro (controles inclusos);
 * - useIdle: mostra/oculta os controles;
 * - useShortcuts: teclado, com regras de foco;
 * - useFeedback + Overlays: animações e estados sobre o vídeo;
 * - useProgressSync (já existente): grava a posição para retomar depois;
 * - useStudyTracking: mede o tempo de reprodução efetiva (métricas de estudo).
 */
export default function Player(props: PlayerProps) {
  const { src, poster, title, mimeType, width, height, initialPosition, onSavePosition, next, study } = props;
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const { state, store } = useMedia(video);
  const actions = useMemo(() => mediaActions(video), []);
  const fullscreen = useFullscreen(root, video);
  const { feedback, show } = useFeedback();

  const [menuOpen, setMenuOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [overControls, setOverControls] = useState(false);
  const [error, setError] = useState<PlaybackError | null>(null);
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const lastPosition = useRef(initialPosition);
  const metadataApplied = useRef(false);

  const { status } = state;
  const playing = status === "playing" || status === "buffering";
  const { idle, wake } = useIdle(root, playing && !menuOpen && !scrubbing && !overControls);

  // --- posição salva ----------------------------------------------------------
  useProgressSync(video, metadataApplied.current && status !== "loading", initialPosition, (position, duration, keepalive) => {
    lastPosition.current = position;
    onSavePosition(position, duration, keepalive);
  });

  const onLoadedMetadata = useCallback(() => {
    const v = video.current!;
    const start = lastPosition.current;
    if (start > 1 && Number.isFinite(v.duration) && start < v.duration - RESUME_TAIL_SECONDS) {
      v.currentTime = start;
      if (!metadataApplied.current) setResumedAt(start);
    }
    metadataApplied.current = true;
  }, []);

  useEffect(() => {
    if (resumedAt === null) return;
    const t = window.setTimeout(() => setResumedAt(null), 6000);
    return () => window.clearTimeout(t);
  }, [resumedAt]);

  useStudyTracking(video, study ?? null);

  // --- preferências (volume, mudo, velocidade) --------------------------------
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const prefs = loadPreferences();
    v.volume = prefs.volume;
    v.muted = prefs.muted;
    v.playbackRate = prefs.rate;
    v.defaultPlaybackRate = prefs.rate;
  }, []);
  useEffect(() => {
    if (status === "loading") return;
    savePreferences({ volume: state.volume, muted: state.muted, rate: state.rate });
  }, [state.volume, state.muted, state.rate, status]);

  // --- erro ----------------------------------------------------------------------
  useEffect(() => {
    if (status !== "error") return;
    let active = true;
    diagnose(src, state.error, mimeType).then((result) => active && setError(result));
    return () => {
      active = false;
    };
  }, [status, src, state.error, mimeType]);

  const retry = useCallback(() => {
    setError(null);
    store.reset();
    video.current?.load(); // mesmo elemento; volta para a última posição em loadedmetadata
  }, [store]);

  // --- ações com feedback -------------------------------------------------------
  const togglePlay = useCallback(() => {
    const v = video.current;
    if (!v || v.error) return;
    const willPlay = v.paused || v.ended;
    const firstPlay = !store.getSnapshot().started;
    actions.toggle();
    show({ kind: willPlay ? "play" : "pause" });
    if (!firstPlay) setResumedAt(null); // no primeiro play o aviso fica, com "Começar do início"
  }, [actions, show, store]);

  const seekBy = useCallback(
    (seconds: number) => {
      if (!video.current || store.getSnapshot().status === "loading") return;
      const applied = actions.seekBy(seconds);
      if (Math.abs(applied) > 0.05) show({ kind: "seek", seconds: applied }); // no início/fim, nada a indicar
      wake();
    },
    [actions, show, store, wake],
  );

  const toggleMute = useCallback(() => {
    actions.toggleMute();
    const v = video.current;
    if (v) show({ kind: "volume", level: v.volume, muted: v.muted });
  }, [actions, show]);

  const setRate = useCallback(
    (rate: number) => {
      actions.setRate(rate);
      if (video.current) video.current.defaultPlaybackRate = rate;
      show({ kind: "rate", rate });
    },
    [actions, show],
  );

  useShortcuts(root, {
    togglePlay: () => {
      togglePlay();
      wake();
    },
    seekBy,
    toggleMute: () => {
      toggleMute();
      wake();
    },
    toggleFullscreen: () => void fullscreen.toggle(),
  });

  // --- clique no vídeo -------------------------------------------------------------
  // Clique alterna a reprodução na hora. Duplo clique alterna a tela cheia e
  // desfaz o segundo alternar, então a reprodução termina como estava.
  // No toque, o primeiro toque com os controles ocultos só os mostra.
  const pointerType = useRef("mouse");
  const controlsHiddenOnDown = useRef(false);
  function onSurfacePointerDown(event: PointerEvent) {
    pointerType.current = event.pointerType;
    controlsHiddenOnDown.current = idle;
  }
  function onSurfaceClick(event: MouseEvent) {
    if (status === "error" || status === "loading") return;
    if (pointerType.current !== "mouse" && controlsHiddenOnDown.current) return;
    if (event.detail >= 2) {
      const v = video.current;
      if (v) (v.paused ? actions.play() : actions.pause()); // desfaz o clique anterior, sem feedback
      void fullscreen.toggle();
      return;
    }
    togglePlay();
  }

  const aspect = width && height ? `${width} / ${height}` : "16 / 9";
  const showStart = status === "idle" && !state.started;
  const pinControls = useCallback((open: boolean) => setMenuOpen(open), []);

  return (
    <div
      ref={root}
      className="pp"
      data-status={status}
      data-idle={idle && playing ? "true" : undefined}
      data-fullscreen={fullscreen.active || undefined}
      style={{ "--pp-aspect": aspect } as CSSProperties}
    >
      <video
        ref={video}
        className="pp-video"
        src={src}
        poster={poster}
        preload="metadata"
        playsInline
        onLoadedMetadata={onLoadedMetadata}
      />

      <div className="pp-surface" onPointerDown={onSurfacePointerDown} onClick={onSurfaceClick} aria-hidden="true" />

      {fullscreen.active && <div className="pp-topbar pp-chrome"><span className="pp-title">{title}</span></div>}

      {status === "loading" && !error && <Loader variant="initial" />}
      {status === "buffering" && <Loader variant="buffering" />}
      <FeedbackLayer feedback={feedback} />

      {showStart && <StartOverlay resumeAt={video.current?.currentTime ?? 0} duration={state.duration} onStart={togglePlay} />}
      {status === "ended" && <EndOverlay next={next} onReplay={togglePlay} />}
      {status === "error" && error && <ErrorOverlay title={error.title} message={error.message} onRetry={error.canRetry ? retry : undefined} />}

      {resumedAt !== null && state.started && (
        <div className="pp-toast">
          Retomando de {formatClock(resumedAt)}
          <button type="button" onClick={() => { actions.seekTo(0); setResumedAt(null); }}>Começar do início</button>
        </div>
      )}

      <div
        className="pp-controls pp-chrome"
        onPointerEnter={(e) => e.pointerType === "mouse" && setOverControls(true)}
        onPointerLeave={() => setOverControls(false)}
      >
        <ProgressBar
          video={video}
          duration={state.duration}
          currentTime={state.currentTime}
          buffered={state.buffered}
          onSeek={actions.seekTo}
          onScrubbing={setScrubbing}
        />
        <div className="pp-row">
          <ControlButton
            label={playing ? "Pausar" : "Reproduzir"}
            shortcut="Espaço"
            tipAlign="start"
            className="pp-btn-play"
            onClick={togglePlay}
            disabled={status === "loading" || status === "error"}
          >
            <span className={`pp-swap ${playing ? "is-b" : "is-a"}`}>
              <PlayIcon />
              <PauseIcon />
            </span>
          </ControlButton>
          <ControlButton label="Voltar 10 segundos" shortcut="←" onClick={() => seekBy(-SKIP_SECONDS)} disabled={status === "loading"}>
            <SkipIcon seconds={SKIP_SECONDS} direction="back" />
          </ControlButton>
          <ControlButton label="Avançar 10 segundos" shortcut="→" onClick={() => seekBy(SKIP_SECONDS)} disabled={status === "loading"}>
            <SkipIcon seconds={SKIP_SECONDS} direction="forward" />
          </ControlButton>
          <VolumeControl
            volume={state.volume}
            muted={state.muted}
            onToggleMute={toggleMute}
            onVolume={actions.setVolume}
          />
          <span className="pp-clock">
            <span>{formatClock(state.currentTime)}</span>
            <span className="pp-clock-sep">/</span>
            <span className="pp-clock-total">{state.duration ? formatClock(state.duration) : "--:--"}</span>
          </span>
          <span className="pp-spacer" />
          <SpeedMenu rate={state.rate} onRate={setRate} onOpenChange={pinControls} />
          <ControlButton
            label={fullscreen.active ? "Sair da tela cheia" : "Tela cheia"}
            shortcut="F"
            tipAlign="end"
            onClick={() => void fullscreen.toggle()}
          >
            <FullscreenIcon active={fullscreen.active} />
          </ControlButton>
        </div>
      </div>
    </div>
  );
}
