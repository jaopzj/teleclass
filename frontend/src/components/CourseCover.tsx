import type { CSSProperties } from "react";
// Identidade visual gerada a partir do curso: um degradê com tons derivados do
// id (estável entre visitas) e as iniciais do título. Quando houver capas
// (PLANO.md, fase 2), basta trocar o conteúdo deste componente.

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const STOP_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "em", "para", "com", "the", "of", "+", "-"]);

export function initials(title: string) {
  const words = title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w.toLowerCase()));
  return (words.slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
}

export function coverStyle(id: string) {
  const h = hash(id);
  const hue = h % 360;
  const hue2 = (hue + 35 + ((h >> 9) % 50)) % 360;
  return {
    "--cover-a": `hsl(${hue} 70% 46%)`,
    "--cover-b": `hsl(${hue2} 75% 30%)`,
  } as CSSProperties;
}

export default function CourseCover({ id, title, className = "" }: { id: string; title: string; className?: string }) {
  return (
    <div className={`cover ${className}`} style={coverStyle(id)} aria-hidden="true">
      <span className="cover-mark">{initials(title)}</span>
    </div>
  );
}
