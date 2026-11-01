// Mesmas regras do backend (backend/app/accounts/validation.py). O backend decide;
// aqui servem para avisar antes de enviar.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const RESERVED = new Set(["admin", "administrador", "root", "system", "sistema", "api", "local", "teleaula", "telegram", "suporte", "support"]);
const COMMON = new Set([
  "12345678", "123456789", "1234567890", "password", "password1", "senha123", "senha1234", "qwerty123", "qwertyuiop",
  "11111111", "00000000", "abc12345", "iloveyou", "teleaula", "teleaula123", "admin123", "abcd1234", "87654321",
  "aaaaaaaa", "senhasenha",
]);

export function normalizeUsername(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function usernameProblem(raw: string): string | null {
  const value = normalizeUsername(raw);
  if (!value) return "Escolha um nome de usuário.";
  if (value.length < USERNAME_MIN) return `Use pelo menos ${USERNAME_MIN} caracteres.`;
  if (value.length > USERNAME_MAX) return `Use no máximo ${USERNAME_MAX} caracteres.`;
  if (!/^[a-z]/.test(value)) return "Comece com uma letra.";
  if (!/^[a-z][a-z0-9_.]*$/.test(value)) return "Use apenas letras sem acento, números, ponto e sublinhado.";
  if (value.includes("..") || value.endsWith(".")) return "O ponto não pode se repetir nem ficar no fim.";
  if (RESERVED.has(value)) return "Este nome é reservado. Escolha outro.";
  return null;
}

export interface PasswordCheck {
  label: string;
  ok: boolean;
}

export function passwordChecks(password: string, username: string): PasswordCheck[] {
  const lowered = password.toLowerCase();
  const user = normalizeUsername(username);
  return [
    { label: `Pelo menos ${PASSWORD_MIN} caracteres`, ok: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX },
    { label: "Não é uma senha comum", ok: password.length > 0 && !COMMON.has(lowered) && new Set(password).size >= 4 },
    { label: "Não contém o nome de usuário", ok: password.length > 0 && !(user && lowered.includes(user)) },
  ];
}

export function passwordProblem(password: string, username: string): string | null {
  if (!password) return "Crie uma senha.";
  if (password.length < PASSWORD_MIN) return `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`;
  if (password.length > PASSWORD_MAX) return `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.`;
  const failed = passwordChecks(password, username).find((check) => !check.ok);
  if (failed?.label === "Não é uma senha comum") return "Essa senha é fácil de adivinhar. Escolha outra.";
  if (failed) return "A senha não pode conter o nome de usuário.";
  return null;
}

/** 0 a 4: só para o medidor visual. */
export function passwordStrength(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= PASSWORD_MIN) score++;
  if (password.length >= 12) score++;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes >= 2) score++;
  if (classes >= 3 && password.length >= 10) score++;
  if (COMMON.has(password.toLowerCase()) || new Set(password).size < 4) return Math.min(score, 1);
  return score;
}
