// Marcações de tempo das anotações ("03:14", "1:02:30").

export function formatStamp(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Aceita "194", "3:14", "03:14", "1:02:30" e "3m14s". Devolve null se não entender. */
export function parseStamp(text: string): number | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  const units = value.match(/^(?:(\d+)h)?\s*(?:(\d+)m(?:in)?)?\s*(?:(\d+)s)?$/);
  if (units && (units[1] || units[2] || units[3])) {
    return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  }
  if (/^\d+$/.test(value)) return Number(value);
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p) && p !== parts[0])) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n >= 60)) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

/** Mensagem de validação de um tempo em relação à duração do vídeo. */
export function stampProblem(seconds: number | null, duration: number | null | undefined): string | null {
  if (seconds === null) return "Use o formato mm:ss, por exemplo 03:14.";
  if (seconds < 0) return "O tempo não pode ser negativo.";
  if (duration && seconds > duration + 2) return `O vídeo tem ${formatStamp(duration)}.`;
  return null;
}
