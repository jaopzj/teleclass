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
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M3 3l18 18M10.6 5.1A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  user: "M20 21a8 8 0 1 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 1 1 8 0v4",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  message: "M4 5h16v11H8l-4 4z",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  send: "M21 3L10 14M21 3l-7 18-4-7-7-4z",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  arrow: "M5 12h14m-6-6l6 6-6 6",
  close: "M6 6l12 12M18 6L6 18",
  flame: "M12 3c.5 3 4 5 4 10a4 4 0 0 1-8 0c0-2.5 1.5-4 2.5-5 0 2 .8 3 1.5 3.5 0-3 0-5.5 0-8.5z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8",
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
