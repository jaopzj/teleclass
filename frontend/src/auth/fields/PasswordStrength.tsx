import Icon from "../../components/Icon";
import { passwordChecks, passwordStrength } from "../validation";

const LABELS = ["", "Fraca", "Razoável", "Boa", "Forte"];

export default function PasswordStrength({ password, username }: { password: string; username: string }) {
  const score = passwordStrength(password);
  const checks = passwordChecks(password, username);
  return (
    <div className={`strength strength-${score}`} aria-live="polite">
      <div className="strength-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={i <= score ? "is-on" : ""} />
        ))}
      </div>
      <span className="strength-label">{password ? LABELS[score] || "Muito fraca" : "Força da senha"}</span>
      <ul className="strength-checks">
        {checks.map((check) => (
          <li key={check.label} className={check.ok ? "is-ok" : ""}>
            <Icon name={check.ok ? "check" : "close"} size={12} />
            {check.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
