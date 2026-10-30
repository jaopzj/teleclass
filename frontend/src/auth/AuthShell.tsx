import { ReactNode } from "react";
import Icon, { IconName } from "../components/Icon";

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "layers", title: "Organizado em módulos", text: "Canais viram cursos com módulos, aulas e materiais." },
  { icon: "play", title: "Player com retomada", text: "Continue exatamente de onde parou, em qualquer aula." },
  { icon: "notes", title: "Progresso e anotações", text: "Tudo salvo na sua conta, separado de outros usuários." },
];

/** Moldura das telas de autenticação: painel da marca + cartão do formulário. */
export default function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-page">
      <aside className="auth-aside" aria-hidden="true">
        <div className="auth-aside-inner">
          <div className="brand auth-brand">
            <span className="brand-mark">
              <Icon name="play" size={12} />
            </span>
            Teleaula
          </div>
          <div className="auth-pitch">
            <h1>Seus cursos do Telegram, com cara de área de membros.</h1>
            <ul className="auth-features">
              {FEATURES.map((f) => (
                <li key={f.title}>
                  <span className="auth-feature-icon">
                    <Icon name={f.icon} size={16} />
                  </span>
                  <div>
                    <strong>{f.title}</strong>
                    <span>{f.text}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="auth-preview">
            <div className="auth-preview-row">
              <span className="auth-preview-thumb" />
              <div>
                <span className="auth-preview-line w70" />
                <span className="auth-preview-line w40" />
              </div>
            </div>
            <div className="auth-preview-progress">
              <span style={{ width: "64%" }} />
            </div>
            <span className="auth-preview-caption">64% concluído · 18 de 28 aulas</span>
          </div>
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-mobile-brand brand">
          <span className="brand-mark">
            <Icon name="play" size={12} />
          </span>
          Teleaula
        </div>
        <div className="auth-card">{children}</div>
        {footer && <div className="auth-footer">{footer}</div>}
      </main>
    </div>
  );
}
