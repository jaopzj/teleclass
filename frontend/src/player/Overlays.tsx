// Camadas sobre o vídeo: carregamento, feedback de ações, início, fim e erro.
import { formatClock } from "../format";
import { Link } from "../router";
import { Feedback } from "./useFeedback";
import { AlertIcon, NextIcon, PauseIcon, PlayIcon, ReplayIcon, VolumeIcon } from "./icons";
import { formatRate } from "./SpeedMenu";

/** Marca do Teleaula (o "play" arredondado) com um brilho que a percorre. */
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
  return (
    <div className="pp-start">
      <button type="button" className="pp-start-button" onClick={onStart} aria-label={resumeAt ? "Continuar assistindo" : "Assistir"}>
        <PlayIcon size={34} />
      </button>
      <span className="pp-start-label">
        {resumeAt > 0 ? `Continuar de ${formatClock(resumeAt)}` : duration > 0 ? `Assistir · ${formatClock(duration)}` : "Assistir"}
      </span>
    </div>
  );
}

export function EndOverlay({ next, onReplay }: { next?: { title: string; href: string }; onReplay(): void }) {
  return (
    <div className="pp-panel pp-end">
      <p className="pp-panel-eyebrow">Aula finalizada</p>
      <div className="pp-end-actions">
        <button type="button" className="pp-action" onClick={onReplay}>
          <ReplayIcon size={18} /> Assistir de novo
        </button>
        {next && (
          <Link to={next.href} className="pp-action pp-action-primary">
            <NextIcon size={18} />
            <span>
              <small>Próxima aula</small>
              <span className="pp-action-title">{next.title}</span>
            </span>
          </Link>
        )}
      </div>
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
