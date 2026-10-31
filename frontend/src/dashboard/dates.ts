// Datas da tela inicial. As datas chegam do servidor como "AAAA-MM-DD" já no fuso
// da pessoa; aqui só formatamos, sem converter fuso (por isso o meio-dia em UTC).

const parse = (iso: string) => new Date(`${iso}T12:00:00Z`);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "2026-10-30" → "30 de outubro, Sexta-feira". */
export function longDate(iso: string) {
  const date = parse(iso);
  const day = date.toLocaleDateString("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" });
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
  return `${day}, ${capitalize(weekday)}`;
}

/** "2026-10" → "Outubro" (com o ano quando não é o ano de referência). */
export function monthLabel(month: string, referenceYear: number) {
  const [year, m] = month.split("-").map(Number);
  const name = capitalize(new Date(Date.UTC(year, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", timeZone: "UTC" }));
  return year === referenceYear ? name : `${name} de ${year}`;
}

export function shiftMonth(month: string, delta: number) {
  const [year, m] = month.split("-").map(Number);
  const index = year * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * Semanas do mês para o calendário (segunda a domingo, como as métricas).
 * Cada semana tem 7 posições; dias de outros meses são `null`.
 */
export function monthGrid(month: string): (string | null)[][] {
  const [year, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, m - 1, 1));
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7; // segunda = 0
  const cells: (string | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Iniciais dos dias da semana, de segunda a domingo (como no Figma). */
export const WEEKDAY_INITIALS = ["S", "T", "Q", "Q", "S", "S", "D"];
export const WEEKDAY_NAMES = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
