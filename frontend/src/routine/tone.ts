import type { CSSProperties } from "react";

/** Variáveis de cor de uma rotina ou atividade (sem cor: a cor principal da marca). */
export function tone(color: string | null | undefined): CSSProperties {
  if (!color) return { "--tone": "var(--brand-500)", "--tone-soft": "var(--brand-a14)", "--tone-ink": "var(--brand-700)" } as CSSProperties;
  return {
    "--tone": `var(--tone-${color}-500)`,
    "--tone-soft": `var(--tone-${color}-soft)`,
    "--tone-ink": `var(--tone-${color}-ink)`,
  } as CSSProperties;
}

