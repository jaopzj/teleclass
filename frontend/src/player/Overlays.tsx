// Camadas sobre o vídeo: carregamento, feedback de ações, início, fim e erro.
import { MouseEvent, useEffect, useState } from "react";
import { formatClock } from "../format";
import { Link, navigate } from "../router";
import { Feedback } from "./useFeedback";
import { AlertIcon, CheckIcon, NextIcon, PauseIcon, PlayIcon, ReplayIcon, VolumeIcon } from "./icons";
import { formatRate } from "./SpeedMenu";

/** Marca do TeleClass (o "play" arredondado) com um brilho que a percorre. */
export function Loader({ variant }: { variant: "initial" | "buffering" }) {
  return (
    <div className={`pp-loader pp-loader-${variant}`} role="status" aria-label={variant === "initial" ? "Carregando a aula" : "Carregando"}>
      <div className="pp-loader-disc">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <defs>
            <linearGradient id="pp-sheen" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="1" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.35" />
            </linearGradient>
          </defs>
          <circle className="pp-loader-orbit" cx="24" cy="24" r="21" />
          <path className="pp-loader-mark" d="M19 15.6v16.8a1.3 1.3 0 0 0 2 1.1l13.2-8.4a1.3 1.3 0 0 0 0-2.2L21 14.5a1.3 1.3 0 0 0-2 1.1z" />
        </svg>
      </div>
      {variant === "initial" && <span className="pp-loader-label">Preparando a aula</span>}
    </div>
  );
}

export function FeedbackLayer({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  switch (feedback.kind) {
    case "play":
    case "pause":
      return (
        <div key={feedback.id} className="pp-pulse" aria-hidden="true">
          {feedback.kind === "play" ? <PlayIcon size={34} /> : <PauseIcon size={34} />}
        </div>
      );
    case "seek": {
      const forward = feedback.seconds > 0;
      return (
        <div key={feedback.id} className={`pp-seek ${forward ? "is-forward" : "is-back"}`} aria-hidden="true">
          <span className="pp-seek-arrows">
            <i />
            <i />
            <i />
          </span>
          <strong>
            {forward ? "+" : "−"}
            {Math.round(Math.abs(feedback.seconds))} s
          </strong>
        </div>
      );
    }
    case "volume":
      return (
        <div key={feedback.id} className="pp-chip" aria-hidden="true">
          <VolumeIcon level={feedback.level} muted={feedback.muted} size={18} />
          <span className="pp-chip-bar">
            <span style={{ width: `${(feedback.muted ? 0 : feedback.level) * 100}%` }} />
          </span>
          <span className="pp-chip-value">{feedback.muted ? "Mudo" : `${Math.round(feedback.level * 100)}%`}</span>
        </div>
      );
    case "rate":
      return (
        <div key={feedback.id} className="pp-chip" aria-hidden="true">
          <span className="pp-chip-value">Velocidade {formatRate(feedback.rate)}</span>
        </div>
      );
  }
}

export function StartOverlay({ resumeAt, duration, onStart }: { resumeAt: number; duration: number; onStart(): void }) {
  const resuming = resumeAt > 0;
  return (
    <div className="pp-start">
      <button type="button" className="pp-start-button" onClick={onStart} aria-label={resuming ? "Continuar assistindo" : "Assistir"}>
        <PlayIcon size={30} />
      </button>
      <span className="pp-start-label">
        {resuming ? (
          <>
            Continuar de <strong>{formatClock(resumeAt)}</strong>
            {duration > 0 && <span className="pp-start-of"> de {formatClock(duration)}</span>}
          </>
        ) : duration > 0 ? (
          <>
            Assistir <span className="pp-start-of">{formatClock(duration)}</span>
          </>
        ) : (
          "Assistir"
        )}
      </span>
    </div>
  );
}

export interface NextLesson {
  title: string;
  href: string;
  /** Roda antes de ir para a próxima aula (ex.: marcar esta como concluída). */
  beforeNavigate?: () => Promise<unknown>;
}

/** Segundos até seguir sozinho para a próxima aula. */
const AUTO_NEXT_SECONDS = 8;

export function EndOverlay({ next, onReplay }: { next?: NextLesson; onReplay(): void }) {
  const [leaving, setLeaving] = useState(false);
  // Contagem para seguir sozinho; para com "Cancelar", com "Assistir de novo" ou com a aba oculta.
  const [left, setLeft] = useState<number | null>(next ? AUTO_NEXT_SECONDS : null);

  async function go() {
    if (!next || leaving) return;
    setLeaving(true);
    setLeft(null);
    try {
      await next.beforeNavigate?.();
    } catch {
      /* a navegação segue mesmo se a gravação falhar */
    }
    navigate(next.href);
  }

  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      void go();
      return;
    }
    const id = window.setTimeout(() => !document.hidden && setLeft((s) => (s === null ? null : s - 0.1)), 100);
    return () => window.clearTimeout(id);
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  function onNextClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void go();
  }

  const counting = left !== null && left > 0;
  return (
    <div className="pp-panel pp-end">
      <span className="pp-end-check" aria-hidden="true">
        <CheckIcon size={22} />
      </span>
      <p className="pp-panel-title">Aula finalizada</p>
      {next ? (
        <div className="pp-next">
          <span className="pp-next-label">
            {counting ? `A seguir em ${Math.ceil(left)} s` : "A seguir"}
            {counting && (
              <button type="button" className="pp-next-cancel" onClick={() => setLeft(null)}>
                Cancelar
              </button>
            )}
          </span>
          <span className="pp-next-title">{next.title}</span>
          <div className="pp-end-actions">
            <Link to={next.href} className="pp-action pp-action-primary" onClick={onNextClick} aria-busy={leaving || undefined}>
              {counting && (
                <svg className="pp-countdown" viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="10" cy="10" r="8" pathLength={1} style={{ strokeDashoffset: 1 - left / AUTO_NEXT_SECONDS }} />
                </svg>
              )}
              {!counting && <NextIcon size={16} />}
              {next.beforeNavigate ? "Concluir e continuar" : "Próxima aula"}
            </Link>
            <button type="button" className="pp-action" onClick={onReplay}>
              <ReplayIcon size={16} /> Assistir de novo
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="pp-panel-text">Esta é a última aula do curso.</p>
          <div className="pp-end-actions">
            <button type="button" className="pp-action" onClick={onReplay}>
              <ReplayIcon size={16} /> Assistir de novo
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function ErrorOverlay({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="pp-panel pp-error" role="alert">
      <span className="pp-error-icon">
        <AlertIcon size={26} />
      </span>
      <p className="pp-panel-title">{title}</p>
      <p className="pp-panel-text">{message}</p>
      {onRetry && (
        <button type="button" className="pp-action" onClick={onRetry}>
          <ReplayIcon size={18} /> Tentar novamente
        </button>
      )}
    </div>
  );
}
