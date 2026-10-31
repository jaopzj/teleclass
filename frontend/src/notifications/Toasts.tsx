import Icon, { IconName } from "../components/Icon";
import { dismissToast, Tone, useToasts } from "./center";
import "./notifications.css";

const ICONS: Record<Tone, IconName> = {
  neutral: "spark",
  focus: "target",
  rest: "leaf",
  success: "check",
  reward: "medal",
};

export default function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="region" aria-label="Avisos" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`} role="status">
          <span className="toast-icon">
            <Icon name={ICONS[t.tone]} size={16} />
          </span>
          <div className="toast-text">
            <strong>{t.title}</strong>
            {t.body && <span>{t.body}</span>}
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action?.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button type="button" className="toast-close" aria-label="Fechar aviso" onClick={() => dismissToast(t.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
