import { useEffect, useRef, useState } from "react";
import { formatClock } from "../format";
import { SavePosition, useProgressSync } from "../hooks/useProgressSync";
import Icon from "./Icon";

interface Props {
  src: string;
  poster?: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  initialPosition: number;
  onSavePosition: SavePosition;
}

type State = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string; retry: boolean };

// Não vale retomar nos últimos segundos: a pessoa provavelmente quer rever.
const RESUME_TAIL_SECONDS = 10;
const SKIP_SECONDS = 10;

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/**
 * Player nativo do navegador (`<video>`): play/pausa, volume, tela cheia,
 * barra de progresso e velocidade vêm prontos e funcionam com Range, que o
 * backend implementa. A proporção segue a do vídeo original.
 */
export default function VideoPlayer({ src, poster, mimeType, width, height, initialPosition, onSavePosition }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const lastPosition = useRef(initialPosition);
  const [skipped, setSkipped] = useState<{ delta: number; id: number } | null>(null);

  function skip(delta: number) {
    const element = video.current;
    if (!element || state.kind !== "ready") return;
    const end = Number.isFinite(element.duration) ? element.duration : Infinity;
    element.currentTime = Math.min(Math.max(element.currentTime + delta, 0), end);
    setSkipped({ delta, id: Date.now() });
  }

  // Atalhos: ← / → (ou J / L) voltam e avançam 10 s, fora dos campos de texto.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "arrowleft" || key === "j") skip(-SKIP_SECONDS);
      else if (key === "arrowright" || key === "l") skip(SKIP_SECONDS);
      else return;
      event.preventDefault(); // evita o salto de 5 s do player nativo somado ao nosso
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!skipped) return;
    const t = window.setTimeout(() => setSkipped(null), 700);
    return () => window.clearTimeout(t);
  }, [skipped]);

  useProgressSync(video, state.kind === "ready", initialPosition, (position, duration, keepalive) => {
    lastPosition.current = position;
    onSavePosition(position, duration, keepalive);
  });

  useEffect(() => {
    if (!resumedAt) return;
    const t = window.setTimeout(() => setResumedAt(null), 6000);
    return () => window.clearTimeout(t);
  }, [resumedAt]);

  function onLoadedMetadata() {
    const element = video.current!;
    const start = lastPosition.current;
    if (start > 1 && Number.isFinite(element.duration) && start < element.duration - RESUME_TAIL_SECONDS) {
      element.currentTime = start;
      if (attempt === 0) setResumedAt(start);
    }
    setState({ kind: "ready" });
  }

  async function onError() {
    const element = video.current;
    const code = element?.error?.code;
    let message = "Não foi possível reproduzir este vídeo.";
    let retry = true;
    try {
      const response = await fetch(src, { headers: { Range: "bytes=0-0" } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 503) {
          message = "O Telegram não está conectado. Rode “python -m app.cli login” e reinicie o servidor.";
        } else if (response.status === 410) {
          message = "Este vídeo foi apagado do canal ou não está mais acessível.";
          retry = false;
        } else {
          message = body.detail ?? message;
        }
      } else if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === MediaError.MEDIA_ERR_DECODE) {
        message = `O navegador não consegue reproduzir este formato${mimeType ? ` (${mimeType})` : ""}.`;
        retry = false;
      } else if (code === MediaError.MEDIA_ERR_NETWORK) {
        message = "A conexão com o vídeo caiu.";
      }
    } catch {
      message = "Sem conexão com o servidor do Teleaula.";
    }
    setState({ kind: "error", message, retry });
  }

  function retry() {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
    video.current?.load(); // o mesmo elemento recarrega e volta para a última posição
  }

  function restart() {
    const element = video.current;
    if (element) element.currentTime = 0;
    setResumedAt(null);
  }

  const aspect = width && height ? `${width} / ${height}` : "16 / 9";
  return (
    <div className="player" style={{ aspectRatio: aspect }}>
      <video
        ref={video}
        src={src}
        poster={poster}
        controls
        preload="metadata"
        playsInline
        onLoadedMetadata={onLoadedMetadata}
        onError={onError}
      />
      {state.kind === "ready" && (
        <div className="player-skip">
          <button onClick={() => skip(-SKIP_SECONDS)} aria-label="Voltar 10 segundos" title="Voltar 10 s (←)">
            <SkipIcon direction="back" />
          </button>
          <button onClick={() => skip(SKIP_SECONDS)} aria-label="Avançar 10 segundos" title="Avançar 10 s (→)">
            <SkipIcon direction="forward" />
          </button>
        </div>
      )}
      {skipped && (
        <div key={skipped.id} className={`player-skip-flash ${skipped.delta < 0 ? "is-back" : "is-forward"}`}>
          {skipped.delta < 0 ? "−" : "+"}
          {Math.abs(skipped.delta)} s
        </div>
      )}
      {state.kind === "loading" && (
        <div className="player-overlay">
          <span className="spinner" aria-label="Carregando vídeo" />
        </div>
      )}
      {state.kind === "error" && (
        <div className="player-overlay player-error" role="alert">
          <Icon name="alert" size={28} />
          <p>{state.message}</p>
          {state.retry && (
            <button className="button button-on-dark" onClick={retry}>
              <Icon name="rotate" size={16} /> Tentar novamente
            </button>
          )}
        </div>
      )}
      {resumedAt !== null && state.kind === "ready" && (
        <div className="player-toast">
          Retomando de {formatClock(resumedAt)}
          <button onClick={restart}>Começar do início</button>
        </div>
      )}
    </div>
  );
}

/** Seta circular com o "10" no centro geométrico do círculo (mesmo viewBox). */
function SkipIcon({ direction }: { direction: "back" | "forward" }) {
  const back = direction === "back";
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        {back ? (
          <>
            <path d="M5.6 6.6A8.5 8.5 0 1 1 3.5 12" />
            <path d="M5.9 2.9v3.9h3.9" />
          </>
        ) : (
          <>
            <path d="M18.4 6.6A8.5 8.5 0 1 0 20.5 12" />
            <path d="M18.1 2.9v3.9h-3.9" />
          </>
        )}
      </g>
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        fontSize="7.2"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      >
        10
      </text>
    </svg>
  );
}
