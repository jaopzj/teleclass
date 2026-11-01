import { CSSProperties, useEffect, useState } from "react";
import Icon from "./Icon";

// Capa do curso (foto do canal) e as cores derivadas do id, que ainda tingem
// o destaque da página do curso.

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

/** Capas que o servidor não tem (canal sem foto ou inacessível): não pede de novo nesta visita. */
const missing = new Set<string>();

export const coverUrl = (id: string) => `/api/courses/${encodeURIComponent(id)}/photo`;

/**
 * Capa do curso: a foto do canal do Telegram. Enquanto carrega, ou se o canal
 * não tiver foto, mostra uma superfície neutra com o ícone do Telegram.
 */
export default function CourseCover({ id, className = "" }: { id: string; className?: string }) {
  const [failed, setFailed] = useState(() => missing.has(id));
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setFailed(missing.has(id));
    setLoaded(false);
  }, [id]);
  return (
    <div className={`cover ${loaded ? "is-loaded" : ""} ${className}`} aria-hidden="true">
      {!loaded && <Icon name="telegram" className="cover-placeholder" />}
      {!failed && (
        <img
          src={coverUrl(id)}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            missing.add(id);
            setFailed(true);
          }}
        />
      )}
    </div>
  );
}
