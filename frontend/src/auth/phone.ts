// Telefone internacional: país (código de discagem), máscara de exibição e
// normalização para E.164 (+ e só dígitos), que é o formato enviado ao backend.

export interface Country {
  iso: string;
  name: string;
  dial: string;
  /** `#` = dígito. Sem máscara, agrupamos de 3 em 3. */
  mask?: string;
  min: number;
  max: number;
}

export const COUNTRIES: Country[] = [
  { iso: "BR", name: "Brasil", dial: "55", mask: "(##) #####-####", min: 10, max: 11 },
  { iso: "PT", name: "Portugal", dial: "351", mask: "### ### ###", min: 9, max: 9 },
  { iso: "AO", name: "Angola", dial: "244", mask: "### ### ###", min: 9, max: 9 },
  { iso: "MZ", name: "Moçambique", dial: "258", mask: "## ### ####", min: 9, max: 9 },
  { iso: "US", name: "Estados Unidos", dial: "1", mask: "(###) ###-####", min: 10, max: 10 },
  { iso: "AR", name: "Argentina", dial: "54", min: 10, max: 11 },
  { iso: "CL", name: "Chile", dial: "56", mask: "# #### ####", min: 9, max: 9 },
  { iso: "CO", name: "Colômbia", dial: "57", mask: "### ### ####", min: 10, max: 10 },
  { iso: "MX", name: "México", dial: "52", mask: "## #### ####", min: 10, max: 10 },
  { iso: "PE", name: "Peru", dial: "51", mask: "### ### ###", min: 9, max: 9 },
  { iso: "PY", name: "Paraguai", dial: "595", min: 9, max: 9 },
  { iso: "UY", name: "Uruguai", dial: "598", min: 8, max: 8 },
  { iso: "ES", name: "Espanha", dial: "34", mask: "### ### ###", min: 9, max: 9 },
  { iso: "FR", name: "França", dial: "33", mask: "# ## ## ## ##", min: 9, max: 9 },
  { iso: "DE", name: "Alemanha", dial: "49", min: 10, max: 11 },
  { iso: "IT", name: "Itália", dial: "39", mask: "### ### ####", min: 9, max: 10 },
  { iso: "GB", name: "Reino Unido", dial: "44", mask: "#### ######", min: 10, max: 10 },
  { iso: "IE", name: "Irlanda", dial: "353", mask: "## ### ####", min: 9, max: 9 },
  { iso: "CH", name: "Suíça", dial: "41", mask: "## ### ## ##", min: 9, max: 9 },
  { iso: "NL", name: "Países Baixos", dial: "31", mask: "# ########", min: 9, max: 9 },
  { iso: "JP", name: "Japão", dial: "81", min: 10, max: 10 },
  { iso: "CA", name: "Canadá", dial: "1", mask: "(###) ###-####", min: 10, max: 10 },
];

export const DEFAULT_COUNTRY = COUNTRIES[0];

export function flag(iso: string) {
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export const digitsOnly = (value: string) => value.replace(/\D/g, "");

/** Formata os dígitos nacionais pela máscara do país (o que sobra vai no fim). */
export function formatNational(digits: string, country: Country): string {
  if (!country.mask) return digits.replace(/(\d{3})(?=\d)/g, "$1 ");
  let out = "";
  let i = 0;
  for (const char of country.mask) {
    if (i >= digits.length) break;
    if (char === "#") out += digits[i++];
    else out += char;
  }
  return out + digits.slice(i);
}

/**
 * Se a pessoa colar ou digitar o número com "+" (ex.: +351 912...), descobrimos
 * o país pelo código de discagem mais longo que combina.
 */
export function detectCountry(input: string): { country: Country; national: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("+") && !trimmed.startsWith("00")) return null;
  const digits = digitsOnly(trimmed.startsWith("00") ? trimmed.slice(2) : trimmed);
  const match = [...COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => digits.startsWith(c.dial));
  return match ? { country: match, national: digits.slice(match.dial.length) } : null;
}

const stripTrunk = (national: string, country: Country) => (country.iso === "IT" ? national : national.replace(/^0+/, ""));

export function nationalProblem(raw: string, country: Country): string | null {
  if (!raw) return "Informe seu número de telefone.";
  const national = stripTrunk(raw, country);
  if (national.length < country.min) return `Número incompleto para ${country.name}. Inclua o DDD.`;
  if (national.length > country.max) return `Número longo demais para ${country.name}.`;
  return null;
}

/** E.164 enviado ao backend. O zero de tronco (ex.: 0 do Reino Unido) é removido. */
export function toE164(national: string, country: Country): string {
  return `+${country.dial}${stripTrunk(national, country)}`;
}
