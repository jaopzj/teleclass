// Conta no topo: foto, nome e título do nível; o menu mostra o Telegram vinculado,
// desvincular e sair.
import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import Icon from "../components/Icon";
import { useLevelTitle } from "../focus/store";
import { Link, paths } from "../router";
import Avatar from "../ui/Avatar";
import { telegramApi } from "./api";
import { displayName, useAuth } from "./AuthProvider";
import Field from "./fields/Field";
import PasswordInput from "./fields/PasswordInput";
import SubmitButton from "./fields/SubmitButton";

export default function AccountMenu({ compact = false }: { compact?: boolean }) {
  const auth = useAuth();
  const levelTitle = useLevelTitle();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (auth.state.status !== "authenticated") return null;
  const { user, telegram } = auth.state;
  const name = displayName(user, telegram);

  return (
    <div className={`account ${compact ? "is-compact" : ""}`} ref={root}>
      <button
        type="button"
        className="account-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Conta de ${name}`}
      >
        <Avatar name={name} size={compact ? 34 : 36} />
        {!compact && (
          <span className="account-id">
            <span className="account-name">{name}</span>
            {/* Título do nível no temporizador de Foco (ex.: "Treineiro"). */}
            {levelTitle && <span className="account-level">{levelTitle}</span>}
          </span>
        )}
        <span className="account-caret" aria-hidden="true">
          <Icon name="down" size={12} weight="fill" />
        </span>
      </button>
      {open && (
        <div className="menu account-menu" role="menu">
          <div className="menu-head">
            <strong>{name}</strong>
            <span className="muted small">@{user.username}{levelTitle && ` · ${levelTitle}`}</span>
          </div>
          {telegram.account && (
            <div className="account-tg">
              <span className="tg-dot" />
              <div>
                <span>{telegram.account.name}</span>
                <span className="muted small">Telegram · {telegram.account.phone}</span>
              </div>
            </div>
          )}
          <div className="menu-sep" />
          <Link to={paths.progress()} role="menuitem" className="menu-item" onClick={() => setOpen(false)}>
            <Icon name="trophy" size={18} />
            Conquistas e metas
          </Link>
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); setConfirming(true); }}>
            <Icon name="link" size={18} />
            Desvincular Telegram
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={auth.logout}>
            <Icon name="logout" size={18} />
            Sair
          </button>
        </div>
      )}
      {confirming && <UnlinkDialog onClose={() => setConfirming(false)} />}
    </div>
  );
}

function UnlinkDialog({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      auth.setTelegram(await telegramApi.unlink(password));
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="unlink-title">
        <h2 id="unlink-title">Desvincular o Telegram?</h2>
        <p className="muted">
          A sessão do TeleClass será encerrada no Telegram e os vídeos param de tocar até você vincular uma conta de novo. Seu
          progresso e suas anotações continuam salvos.
        </p>
        <Field id="unlink-password" label="Confirme com a senha do TeleClass" error={error}>
          <PasswordInput
            id="unlink-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            disabled={busy}
          />
        </Field>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <SubmitButton loading={busy} loadingLabel="Desvinculando..." className="button-danger" disabled={!password}>
            Desvincular
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
