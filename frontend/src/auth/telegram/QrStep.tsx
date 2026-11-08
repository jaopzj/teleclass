// Vínculo por QR code: a pessoa aprova no celular, sem código nenhum. É a saída
// quando o Telegram não entrega o código (comum com o servidor na nuvem). O
// backend renova o QR quando ele expira; aqui só consultamos a cada 2 s.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Icon from "../../components/Icon";
import { LinkFlow } from "../api";
import { FormAlert } from "./PhoneStep";
import { Busy, LinkError } from "./useTelegramLink";

interface Props {
  flow: LinkFlow;
  busy: Busy;
  error: LinkError | null;
  onPoll: () => void;
  onCancel: () => void;
}

const POLL_MS = 2000;

export default function QrStep({ flow, busy, error, onPoll, onCancel }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const url = flow.qr_url ?? "";

  useEffect(() => {
    let alive = true;
    if (!url) return;
    QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b1220", light: "#ffffff" } })
      .then((markup) => alive && setSvg(markup))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [url]);

  useEffect(() => {
    const timer = window.setInterval(onPoll, POLL_MS);
    return () => window.clearInterval(timer);
  }, [onPoll]);

  return (
    <div className="auth-form">
      <div className="step-intro">
        <span className="step-icon">
          <Icon name="qr" size={20} />
        </span>
        <div>
          <h2>Escaneie com o celular</h2>
          <p className="muted">Nenhum código é enviado: você aprova o acesso direto no app do Telegram.</p>
        </div>
      </div>

      <div className="qr-box">
        {svg ? (
          <div className="qr-image" role="img" aria-label="QR code para entrar no Telegram" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="qr-image is-loading">
            <span className="mini-spinner" />
          </div>
        )}
        <ol className="qr-steps">
          <li>Abra o Telegram no celular.</li>
          <li>
            Vá em <strong>Configurações › Dispositivos</strong>.
          </li>
          <li>
            Toque em <strong>Conectar dispositivo</strong> e aponte a câmera para o código.
          </li>
        </ol>
      </div>

      {url && (
        <p className="qr-mobile muted">
          Está no celular? <a href={url}>Abrir no app do Telegram</a> e confirmar.
        </p>
      )}

      <p className="qr-wait muted" role="status">
        <span className="mini-spinner" />
        Aguardando a aprovação no celular. O código se renova sozinho.
      </p>

      {error && <FormAlert error={error} />}

      <div className="resend-row">
        <button type="button" className="link-button" onClick={onCancel} disabled={busy !== null}>
          Usar o número de telefone
        </button>
      </div>
    </div>
  );
}
