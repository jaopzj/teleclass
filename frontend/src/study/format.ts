// Formatação das métricas de estudo. Arredonda para baixo: nunca mostra mais
// tempo do que foi registrado.

export function formatStudyTime(seconds: number) {
  if (seconds <= 0) return "0 min";
  if (seconds < 60) return "<1 min";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Diferença assinada: "+25 min", "−1 h 5 min". */
export function formatDelta(seconds: number) {
  const sign = seconds >= 0 ? "+" : "−";
  return `${sign}${formatStudyTime(Math.abs(seconds))}`;
}

const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

export function weekdayName(index: number) {
  return WEEKDAYS[index];
}

export function weekdayShort(index: number) {
  return WEEKDAYS[index].slice(0, 3);
}

/** "2026-10-29" → "29/10" (a data já é local do usuário; sem conversão de fuso). */
export function shortDate(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Nome amigável do fuso: "America/Sao_Paulo" → "Sao Paulo". */
export function timezoneLabel(name: string) {
  return (name.split("/").pop() ?? name).replace(/_/g, " ");
}
