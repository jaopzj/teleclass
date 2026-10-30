import { forwardRef } from "react";
import { COUNTRIES, Country, detectCountry, digitsOnly, flag, formatNational } from "../phone";

interface Props {
  id: string;
  country: Country;
  national: string;
  onChange: (country: Country, national: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}

/** País (código de discagem) + número formatado conforme o país. */
const PhoneInput = forwardRef<HTMLInputElement, Props>(function PhoneInput(
  { id, country, national, onChange, disabled, invalid },
  ref,
) {
  function handleText(raw: string) {
    const detected = detectCountry(raw);
    if (detected) return onChange(detected.country, detected.national.slice(0, 15));
    let digits = digitsOnly(raw);
    // Apagar um caractere da máscara, como ")" ou "-", apaga o dígito antes dele.
    if (digits === national && raw.length < formatNational(national, country).length) digits = digits.slice(0, -1);
    onChange(country, digits.slice(0, 15));
  }

  return (
    <div className={`phone-input ${invalid ? "is-invalid" : ""}`}>
      <label className="phone-country">
        <span className="sr-only">País</span>
        <span className="phone-country-face" aria-hidden="true">
          <span className="phone-flag">{flag(country.iso)}</span>+{country.dial}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
        <select
          value={country.iso}
          disabled={disabled}
          onChange={(e) => onChange(COUNTRIES.find((c) => c.iso === e.target.value) ?? country, national)}
        >
          {COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso}>
              {flag(c.iso)} {c.name} (+{c.dial})
            </option>
          ))}
        </select>
      </label>
      <input
        ref={ref}
        id={id}
        className="input phone-number"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder={country.mask ? formatNational("9".repeat(country.max), country).replace(/9/g, "0") : "Número"}
        value={formatNational(national, country)}
        onChange={(e) => handleText(e.target.value)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-message`}
      />
    </div>
  );
});

export default PhoneInput;
