// Ícones do player: traço arredondado de 1.8px num grid de 24, mesma família
// visual dos ícones do resto do app, preenchidos onde o peso ajuda a leitura.
import { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 22, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const PlayIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" fill="currentColor" stroke="none" />
  </Svg>
);

export const PauseIcon = (p: P) => (
  <Svg {...p}>
    <rect x="6.5" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none" />
    <rect x="13.7" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none" />
  </Svg>
);

export const ReplayIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4.5v4h4" />
  </Svg>
);

export const VolumeIcon = ({ level, muted, ...p }: P & { level: number; muted: boolean }) => (
  <Svg {...p}>
    <path d="M4.5 9.5h3l4.2-3.6a.6.6 0 0 1 1 .46v11.3a.6.6 0 0 1-1 .46L7.5 14.5h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z" fill="currentColor" stroke="none" />
    {muted || level === 0 ? (
      <path d="M16.5 9.5l5 5m0-5l-5 5" />
    ) : (
      <>
        <path d="M16 9.2a4 4 0 0 1 0 5.6" />
        <path d="M18.6 6.6a7.6 7.6 0 0 1 0 10.8" style={{ opacity: level > 0.5 ? 1 : 0, transition: "opacity .15s" }} />
      </>
    )}
  </Svg>
);

export const FullscreenIcon = ({ active, ...p }: P & { active: boolean }) => (
  <Svg {...p}>
    {active ? (
      <path d="M9 4v3a2 2 0 0 1-2 2H4M15 4v3a2 2 0 0 0 2 2h3M9 20v-3a2 2 0 0 0-2-2H4M15 20v-3a2 2 0 0 1 2-2h3" />
    ) : (
      <path d="M4 9V6a2 2 0 0 1 2-2h3M20 9V6a2 2 0 0 0-2-2h-3M4 15v3a2 2 0 0 0 2 2h3M20 15v3a2 2 0 0 1-2 2h-3" />
    )}
  </Svg>
);

export const SpeedIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4.2 16.5a8.5 8.5 0 1 1 15.6 0" />
    <path d="M12 13l3.6-3.6" />
    <circle cx="12" cy="13" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);

export const NextIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 6.4v11.2a.8.8 0 0 0 1.2.7l8.6-5.6a.8.8 0 0 0 0-1.4L7.2 5.7a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none" />
    <path d="M18.5 6v12" strokeWidth={2.2} />
  </Svg>
);

export const AlertIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 8.5v4.5m0 3.2v.01" />
    <path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </Svg>
);

export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

/** Seta circular com o número de segundos no centro geométrico do círculo. */
export function SkipIcon({ seconds, direction, size = 24 }: { seconds: number; direction: "back" | "forward"; size?: number }) {
  const back = direction === "back";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" transform={back ? undefined : "matrix(-1 0 0 1 24 0)"}>
        <path d="M5.6 6.6A8.5 8.5 0 1 1 3.5 12" />
        <path d="M5.9 2.9v3.9h3.9" />
      </g>
      <text x="12" y="12.4" textAnchor="middle" dominantBaseline="central" fill="currentColor" fontSize="7.4" fontWeight="700"
        fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
        {seconds}
      </text>
    </svg>
  );
}
