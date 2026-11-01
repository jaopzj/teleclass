import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { SnapshotInfo } from "../api";
import CourseCover from "../components/CourseCover";
import Icon from "../components/Icon";
import { formatRelative, plural } from "../format";
import { Link, paths } from "../router";
import { dismissFresh, draft, startCollection } from "./collectStore";
import type { TelegramState } from "./IndexingPage";
import { LINK_EXAMPLES, parseChannelLink } from "./links";

export function IndexingHeader({ telegram }: { telegram?: TelegramState }) {
  return (
    <header className="page-head ix-head">
      <div>
        <h1>Adicionar curso</h1>
        <p className="muted">Transforme um canal do Telegram em um curso organizado em módulos e aulas.</p>
      </div>
      {telegram && <TelegramStatus state={telegram} />}
    </header>
  );
}

const TELEGRAM_STATUS: Record<TelegramState, { label: string; tone: string; tip?: string }> = {
  loading: { label: "Verificando Telegram", tone: "" },
  unknown: { label: "Telegram indisponível", tone: "badge-warning", tip: "Não foi possível consultar a conexão agora" },
  unconfigured: { label: "Telegram não configurado", tone: "badge-warning", tip: "O servidor não tem as credenciais da API do Telegram" },
  unlinked: { label: "Telegram não conectado", tone: "badge-warning", tip: "Vincule sua conta do Telegram para coletar canais" },
  linked: { label: "Telegram conectado", tone: "badge-success" },
};

function TelegramStatus({ state }: { state: TelegramState }) {
  const { label, tone, tip } = TELEGRAM_STATUS[state];
  return (
    <span className={`badge ix-status ${tone}`} role="status" data-tip={tip}>
      <span className="ix-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

interface Props {
  telegram: TelegramState;
  snapshots: SnapshotInfo[] | undefined;
  snapshotsError: Error | undefined;
}

export default function ImportView({ telegram, snapshots, snapshotsError }: Props) {
  // O aviso de "curso adicionado" vale só para a inspeção logo após a coleta.
  useEffect(dismissFresh, []);
  return (
    <>
      <IndexingHeader telegram={telegram} />
      <div className="ix-import">
        <ImportCard telegram={telegram} />
        <RecentImports snapshots={snapshots} error={snapshotsError} />
      </div>
    </>
  );
}

function ImportCard({ telegram }: { telegram: TelegramState }) {
  // Depois de um erro, o link volta para o campo para ser corrigido.
  const [link, setLink] = useState(draft);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const canPaste = typeof navigator !== "undefined" && !!navigator.clipboard?.readText;

  const ready = telegram === "linked";
  const value = link.trim();
  const valid = value ? parseChannelLink(value) !== null : false;
  const showInvalid = touched && value !== "" && !valid;

  useEffect(() => {
    if (ready) inputRef.current?.focus();
  }, [ready]);

  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setLink(text);
        setTouched(true);
      }
    } catch {
      // Permissão negada: a pessoa ainda pode colar com o teclado.
    }
    inputRef.current?.focus();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!ready || !valid) return;
    void startCollection(value);
  }

  let message: { text: string; error?: boolean };
  if (!ready && telegram !== "loading") {
    message = { text: `${TELEGRAM_STATUS[telegram].tip ?? "A coleta precisa do Telegram conectado"}.`, error: true };
  } else if (showInvalid) {
    message = { text: "Link não reconhecido. Use um dos formatos abaixo.", error: true };
  } else {
    message = { text: "Você precisa participar do canal ou grupo com a conta do Telegram vinculada." };
  }

  return (
    <section className="surface ix-card ix-import-card" aria-labelledby={`${id}-title`}>
      <div className="ix-card-head">
        <span className="ix-tile" aria-hidden="true">
          <Icon name="telegram" size={24} />
        </span>
        <div>
          <h2 id={`${id}-title`}>Importar de um canal</h2>
          <p className="muted">Cole o link e o TeleClass lê as mensagens, identifica o sumário e monta módulos e aulas.</p>
        </div>
      </div>

      <form className="ix-form" onSubmit={submit} noValidate>
        <div className={`field ${showInvalid ? "is-invalid" : ""}`}>
          <label htmlFor={`${id}-link`}>Link do canal ou grupo</label>
          <div className="input-group">
            <span className="input-icon">
              <Icon name="link" size={18} />
            </span>
            <input
              ref={inputRef}
              id={`${id}-link`}
              className={`input has-icon ${canPaste ? "has-action" : ""}`}
              placeholder="https://t.me/nome_do_canal"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onBlur={() => setTouched(true)}
              disabled={!ready}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={showInvalid || undefined}
              aria-describedby={`${id}-hint`}
            />
            {canPaste && (
              <button
                type="button"
                className="input-action"
                onClick={paste}
                disabled={!ready}
                aria-label="Colar link"
                data-tip="Colar"
              >
                <Icon name="paste" size={18} />
              </button>
            )}
          </div>
          <p id={`${id}-hint`} className={`field-message ${message.error ? "is-error" : ""}`}>
            {message.text}
          </p>
        </div>
        <button type="submit" className="button button-primary button-lg ix-submit" disabled={!ready || !valid}>
          <Icon name="download" size={18} />
          Coletar canal
        </button>
      </form>

      <div className="ix-formats">
        <span className="ix-formats-label">Formatos aceitos</span>
        <ul>
          {LINK_EXAMPLES.map((example) => (
            <li key={example}>
              <code>{example}</code>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** "coletado há 2 dias", "coletado em 22/09/2026". */
export function collectedAt(iso: string) {
  const when = formatRelative(iso);
  return /^\d/.test(when) ? `coletado em ${when}` : `coletado ${when}`;
}

function RecentImports({ snapshots, error }: { snapshots: SnapshotInfo[] | undefined; error: Error | undefined }) {
  const sorted = snapshots && [...snapshots].sort((a, b) => b.modified_at.localeCompare(a.modified_at));
  return (
    <section className="surface ix-card ix-recent" aria-labelledby="ix-recent-title">
      <div className="ix-recent-head">
        <h2 id="ix-recent-title">Importações recentes</h2>
        {sorted && sorted.length > 0 && <span className="badge">{sorted.length}</span>}
      </div>

      {error && <div className="alert alert-error">Não foi possível carregar as importações: {error.message}</div>}

      {!sorted && !error && (
        <ul className="ix-recent-list" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="ix-recent-skeleton skeleton" />
          ))}
        </ul>
      )}

      {sorted && sorted.length === 0 && (
        <div className="ix-recent-empty">
          <span className="empty-icon">
            <Icon name="folderPlus" size={24} />
          </span>
          <p>Os canais que você coletar aparecem aqui, prontos para conferir a estrutura.</p>
        </div>
      )}

      {sorted && sorted.length > 0 && (
        <ul className="ix-recent-list">
          {sorted.map((s) => {
            const title = s.title ?? s.name;
            return (
              <li key={s.name}>
                <Link className="ix-recent-item" to={paths.indexing(s.name)}>
                  <CourseCover id={s.name} title={title} className="ix-recent-cover" />
                  <span className="ix-recent-text">
                    <strong>{title}</strong>
                    <span className="ix-recent-meta">
                      {[s.name, plural(s.messages, "mensagem", "mensagens"), collectedAt(s.modified_at)].join(" · ")}
                    </span>
                  </span>
                  <Icon name="chevron" size={18} className="ix-recent-chevron" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
