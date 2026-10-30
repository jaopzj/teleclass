import Icon from "../../components/Icon";
import { TelegramAccount } from "../api";

export default function LinkedStep({ account, onContinue, busy }: { account: TelegramAccount; onContinue: () => void; busy?: boolean }) {
  return (
    <div className="auth-form linked">
      <div className="success-mark" aria-hidden="true">
        <svg viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="24" />
          <path d="M15 27l7 7 15-16" />
        </svg>
      </div>
      <h2>Tudo pronto!</h2>
      <p className="muted">Sua conta do Telegram está vinculada. Ela continua conectada nos próximos acessos.</p>
      <div className="account-card">
        <span className="account-avatar">{account.name.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{account.name}</strong>
          <span className="muted">
            {account.username ? `@${account.username} · ` : ""}
            {account.phone}
          </span>
        </div>
        <Icon name="check" size={18} className="account-ok" />
      </div>
      <button type="button" className="button button-primary button-lg button-block" onClick={onContinue} disabled={busy} autoFocus>
        Ir para meus cursos
        <Icon name="arrow" size={16} />
      </button>
    </div>
  );
}
