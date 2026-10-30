// Ícones em SVG inline (traço de 1.75px, herdam a cor do texto).
const PATHS = {
  play: "M7 4.5v15l12-7.5z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  chevron: "M9 6l6 6-6 6",
  left: "M15 18l-6-6 6-6",
  right: "M9 6l6 6-6 6",
  back: "M19 12H5m6-6l-6 6 6 6",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  text: "M5 6h14M5 12h14M5 18h9",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  alert: "M12 8v5m0 3.5v.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  notes: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 8.5l3 3",
  download: "M12 4v11m-5-5l5 5 5-5M5 20h14",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  rotate: "M4 4v6h6M4.5 15a8 8 0 1 0 1.9-8.3L4 10",
  library: "M4 5h4v14H4zM10 5h4v14h-4zM16.5 5.5l3.6.9-3.3 13.6-3.6-.9z",
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const filled = name === "play";
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
