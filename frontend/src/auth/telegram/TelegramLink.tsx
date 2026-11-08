// Etapas do vínculo com o Telegram. Mostra uma etapa por vez, na ordem que o
// backend indicar (a senha 2FA só aparece se a conta tiver uma).
import { useEffect, useState } from "react";
import { LinkFlow, TelegramAccount } from "../api";
import { Country, DEFAULT_COUNTRY } from "../phone";
import CodeStep from "./CodeStep";
import LinkedStep from "./LinkedStep";
import PasswordStep from "./PasswordStep";
import PhoneStep from "./PhoneStep";
import QrStep from "./QrStep";
import { LinkStep, useTelegramLink } from "./useTelegramLink";

interface Props {
  initialFlow: LinkFlow | null;
  onStepChange?: (step: LinkStep, needsPassword: boolean) => void;
  onDone: (account: TelegramAccount) => void | Promise<void>;
}

export default function TelegramLink({ initialFlow, onStepChange, onDone }: Props) {
  const link = useTelegramLink(initialFlow);
  const { state } = link;
  const [draft, setDraft] = useState<{ country: Country; national: string }>({ country: DEFAULT_COUNTRY, national: "" });
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    onStepChange?.(state.step, state.needsPassword);
  }, [state.step, state.needsPassword, onStepChange]);

  async function finish(account: TelegramAccount) {
    setLeaving(true);
    try {
      await onDone(account);
    } finally {
      setLeaving(false);
    }
  }

  let content;
  if (state.step === "done" && state.account) {
    const account = state.account;
    content = <LinkedStep account={account} busy={leaving} onContinue={() => finish(account)} />;
  } else if (state.step === "password" && state.flow) {
    content = (
      <PasswordStep
        flow={state.flow}
        busy={state.busy}
        error={state.error}
        rejection={state.rejection}
        onSubmit={link.sendPassword}
        onChangePhone={link.changePhone}
      />
    );
  } else if (state.step === "qr" && state.flow) {
    content = <QrStep flow={state.flow} busy={state.busy} error={state.error} onPoll={link.pollQr} onCancel={link.changePhone} />;
  } else if (state.step === "code" && state.flow) {
    content = (
      <CodeStep
        flow={state.flow}
        busy={state.busy}
        error={state.error}
        notice={state.notice}
        rejection={state.rejection}
        onSubmit={link.sendCode}
        onResend={link.resend}
        onChangePhone={link.changePhone}
        onUseQr={link.startQr}
      />
    );
  } else {
    content = (
      <PhoneStep
        busy={state.busy === "phone" || state.busy === "cancel"}
        error={state.error}
        onSubmit={link.sendPhone}
        onUseQr={link.startQr}
        qrBusy={state.busy === "qr"}
        draft={draft}
        onDraft={setDraft}
      />
    );
  }

  // A chave por etapa faz cada etapa entrar com uma transição curta.
  return (
    <div className="auth-step" key={state.step}>
      {content}
    </div>
  );
}
