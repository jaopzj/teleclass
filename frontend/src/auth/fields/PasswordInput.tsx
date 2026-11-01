import { forwardRef, InputHTMLAttributes, useState } from "react";
import Icon from "../../components/Icon";

/** Campo de senha com botão de mostrar/ocultar. */
const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(
  { className, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-group">
      <span className="input-icon" aria-hidden="true">
        <Icon name="lock" size={16} />
      </span>
      <input
        ref={ref}
        {...props}
        type={visible ? "text" : "password"}
        className={`input has-icon has-action ${className ?? ""}`}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="input-action"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={visible}
        tabIndex={0}
      >
        <Icon name={visible ? "eyeOff" : "eye"} size={18} />
      </button>
    </div>
  );
});

export default PasswordInput;
