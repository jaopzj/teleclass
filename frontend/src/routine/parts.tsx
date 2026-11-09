// Peças pequenas da Minha Rotina: ícone da biblioteca, tom de cor, marcas de status.
import Icon from "../components/Icon";
import type { Occurrence, Status } from "./api";
import { ICONS } from "./icons";
import { tone } from "./tone";

export { tone };

export const COLORS = [
  { key: "sky", label: "Céu" },
  { key: "teal", label: "Turquesa" },
  { key: "green", label: "Verde" },
  { key: "amber", label: "Âmbar" },
  { key: "coral", label: "Coral" },
  { key: "rose", label: "Rosa" },
  { key: "violet", label: "Lilás" },
  { key: "slate", label: "Grafite" },
] as const;

/** Cor efetiva de uma ocorrência: a própria ou a da rotina de origem. */
export const occurrenceColor = (o: Pick<Occurrence, "color" | "routine">) => o.color ?? o.routine?.color ?? null;
export const occurrenceIcon = (o: Pick<Occurrence, "icon_key" | "routine">) => o.icon_key ?? o.routine?.icon_key ?? null;

const inner = (svg: string) => svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

/** Ícone escolhido na biblioteca (chave estável). Sem ícone: nada. */
export function RoutineIcon({ name, size = 18, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const entry = name ? ICONS.get(name) : undefined;
  if (!entry) return null;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: inner(entry.svg) }}
    />
  );
}

/** Ladrilho com ícone (ou inicial) no tom da rotina. */
export function IconTile({ icon, color, label, size = 40 }: { icon: string | null; color: string | null; label: string; size?: number }) {
  return (
    <span className="rt-tile" style={{ ...tone(color), width: size, height: size }} aria-hidden="true">
      {icon && ICONS.has(icon) ? <RoutineIcon name={icon} size={Math.round(size * 0.5)} /> : <b>{label.trim().charAt(0).toUpperCase() || "•"}</b>}
    </span>
  );
}

export const STATUS_ICON: Partial<Record<Status, Parameters<typeof Icon>[0]["name"]>> = {
  completed: "check",
  skipped: "skip",
  cancelled: "close",
};
