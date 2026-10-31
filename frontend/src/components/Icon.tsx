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
  // temporizador
  timer: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 1.5M10 2h4M19 5l1.5 1.5",
  pause: "M9 5v14M15 5v14",
  stop: "M7 7h10v10H7z",
  skip: "M6 5l9 7-9 7zM18 5v14",
  leaf: "M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7",
  medal: "M8 3l2.5 6M16 3l-2.5 6M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 13l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2-1.45-1.4 2-.3z",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6",
  volume: "M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  mute: "M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6",
  minimize: "M5 12h14",
  expand: "M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6",
  collapse: "M4 14h6v6M20 10h-6V4M10 14l-6 6M14 10l6-6",
  plus: "M12 5v14M5 12h14",
  edit: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4",
  link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  drop: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z",
  wind: "M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7",
  coffee: "M4 8h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6zM17 9h1.5a2.5 2.5 0 0 1 0 5H17M8 2.5v2M12 2.5v2",
  wave: "M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1M2 17c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1",
  fire: "M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-1.5-2-1.5-3C7 9.5 6 12 6 15a6 6 0 0 0 6 6z",
  tree: "M12 3l6 8h-3l4 6H5l4-6H6zM12 17v4",
  rain: "M7 15a5 5 0 1 1 1-9.9A6 6 0 0 1 19 8a4 4 0 0 1 0 7M8 18l-1 3M12 18l-1 3M16 18l-1 3",
  noise: "M3 12h2l2-6 3 12 3-9 2 6 2-3h4",
  eye2: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  stretch: "M12 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM5 9l7-2 7 2M12 7v6l-3 8M12 13l3 8",
  lungs: "M12 4v8M12 12c-1.5-1-3-2.5-3-5M12 12c1.5-1 3-2.5 3-5M9 7c-3 0-5 4-5 9 0 3 2 4 4 3s2-3 2-6M15 7c3 0 5 4 5 9 0 3-2 4-4 3s-2-3-2-6",
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
