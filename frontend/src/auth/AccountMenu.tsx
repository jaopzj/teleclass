// Menu da conta no topo: quem está logado, situação do Telegram, desvincular e sair.
import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import Icon from "../components/Icon";
import { telegramApi } from "./api";
import { useAuth } from "./AuthProvider";
import Field from "./fields/Field";
import PasswordInput from "./fields/PasswordInput";
import SubmitButton from "./fields/SubmitButton";

export default function AccountMenu() {
  const auth = useAuth();
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

  return (
    <div className="account-menu" ref={root}>
      <button type="button" className="account-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        <span className="account-avatar sm">{user.username.slice(0, 1).toUpperCase()}</span>
        <span className="account-trigger-name">{user.username}</span>
      </button>
      {open && (
        <div className="account-popover" role="menu">
          <div className="account-popover-head">
            <strong>{user.username}</strong>
            <span className="muted small">Conta do Teleaula</span>
          </div>
          {telegram.account && (
            <div className="account-popover-tg">
              <span className="tg-dot" />
              <div>
                <span>{telegram.account.name}</span>
                <span className="muted small">Telegram · {telegram.account.phone}</span>
              </div>
            </div>
          )}
          <button type="button" role="menuitem" className="account-item" onClick={() => { setOpen(false); setConfirming(true); }}>
            <Icon name="close" size={16} />
            Desvincular Telegram
          </button>
          <button type="button" role="menuitem" className="account-item" onClick={auth.logout}>
            <Icon name="logout" size={16} />
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
          A sessão do Teleaula será encerrada no Telegram e os vídeos param de tocar até você vincular uma conta de novo. Seu
          progresso e suas anotações continuam salvos.
        </p>
        <Field id="unlink-password" label="Confirme com a senha do Teleaula" error={error}>
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
