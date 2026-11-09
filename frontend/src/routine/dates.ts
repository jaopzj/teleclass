// Datas da Minha Rotina. As datas são de calendário ("AAAA-MM-DD") no fuso da
// pessoa, e o "hoje" vem do servidor. Aqui só fazemos aritmética de calendário
// em UTC ao meio-dia, que nunca muda de dia por horário de verão.

const parse = (iso: string) => new Date(`${iso}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const isIsoDate = (value: string | null | undefined): value is string =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parse(value).getTime());

export function addDays(day: string, delta: number) {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + delta);
  return iso(d);
}

/** Segunda = 0 ... domingo = 6 (padrão brasileiro). */
export const weekday = (day: string) => (parse(day).getUTCDay() + 6) % 7;

export const weekStart = (day: string) => addDays(day, -weekday(day));

export const weekDays = (day: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i));

export const monthOf = (day: string) => day.slice(0, 7);

export function addMonths(day: string, delta: number) {
  const [y, m, d] = day.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Semanas completas (segunda a domingo) que cobrem o mês de `day`. */
export function monthWeeks(day: string): string[][] {
  const first = `${monthOf(day)}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const weeks: string[][] = [];
  for (let start = weekStart(first); start <= last; start = addDays(start, 7)) weeks.push(weekDays(start));
  return weeks;
}

export function daysBetween(a: string, b: string) {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

const fmt = (day: string, options: Intl.DateTimeFormatOptions) => parse(day).toLocaleDateString("pt-BR", { ...options, timeZone: "UTC" });

export const WEEKDAY_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
export const WEEKDAY_LONG = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
export const WEEKDAY_INITIAL = ["S", "T", "Q", "Q", "S", "S", "D"];

/** "Segunda-feira, 9 de novembro". */
export const longDay = (day: string) => `${capitalize(fmt(day, { weekday: "long" }))}, ${fmt(day, { day: "numeric", month: "long" })}`;

/** "9 de nov." */
export const shortDay = (day: string) => fmt(day, { day: "numeric", month: "short" });

/** "Novembro de 2026". */
export const monthTitle = (day: string) => capitalize(fmt(day, { month: "long", year: "numeric" }));

/** "9 – 15 de novembro" (ou entre meses: "30 de nov. – 6 de dez."). */
export function weekTitle(day: string) {
  const [first, last] = [weekStart(day), addDays(weekStart(day), 6)];
  if (monthOf(first) === monthOf(last)) return `${fmt(first, { day: "numeric" })} – ${fmt(last, { day: "numeric", month: "long" })}`;
  return `${shortDay(first)} – ${shortDay(last)}`;
}

/** "Hoje", "Amanhã", "Ontem" ou o dia da semana com a data. */
export function relativeDay(day: string, today: string) {
  const diff = daysBetween(today, day);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  return `${capitalize(fmt(day, { weekday: "long" }))}, ${shortDay(day)}`;
}

/** Hora local do dispositivo em minutos (para a linha do "agora"). */
export const nowMinutes = (date = new Date()) => date.getHours() * 60 + date.getMinutes();

export function toMinutes(time: string | null | undefined) {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function toTime(minutes: number) {
  const m = Math.max(0, Math.min(minutes, 23 * 60 + 59));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
