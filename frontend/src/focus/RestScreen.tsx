import { useEffect, useRef, useState } from "react";
import Icon, { IconName } from "../components/Icon";
import { FocusSession } from "./api";
import ConfirmDialog from "./ConfirmDialog";
import { runAction } from "./Controls";
import { clock, duration, readout } from "./derive";
import { useFocus } from "./store";
import { useServerNow } from "./useNow";

const TIPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "drop", title: "Beba um copo de água", text: "Hidratação ajuda a manter a atenção no próximo ciclo." },
  { icon: "eye2", title: "Descanse os olhos", text: "Olhe para algo a uns 6 metros de distância por 20 segundos. Pisque devagar algumas vezes." },
  { icon: "stretch", title: "Alongue o corpo", text: "Gire os ombros para trás, incline a cabeça para cada lado e estique os braços acima da cabeça." },
  { icon: "wind", title: "Levante e caminhe", text: "Alguns passos pela casa ativam a circulação e tiram você da tela." },
  { icon: "leaf", title: "Respire com calma", text: "Siga o círculo: inspire enquanto ele cresce, solte o ar enquanto ele diminui." },
  { icon: "user", title: "Ajuste a postura", text: "Apoie os pés no chão, solte a mandíbula e relaxe os ombros longe das orelhas." },
];

// Respiração guiada: 4 s inspirando, 2 s segurando, 6 s soltando.
const BREATH = [
  { label: "Inspire", seconds: 4 },
  { label: "Segure", seconds: 2 },
  { label: "Solte o ar", seconds: 6 },
];
const BREATH_TOTAL = BREATH.reduce((a, b) => a + b.seconds, 0);

function breathCue(now: number) {
  let t = now % BREATH_TOTAL;
  for (const step of BREATH) {
    if (t < step.seconds) return step.label;
    t -= step.seconds;
  }
  return BREATH[0].label;
}

/**
 * Descanso guiado. Cobre toda a plataforma enquanto a pausa durar: os cursos e
 * as aulas ficam inacessíveis aqui e também no servidor (o vídeo não carrega).
 */
export default function RestScreen({ session }: { session: FocusSession }) {
  const now = useServerNow(true);
  const { busy } = useFocus();
  const r = readout(session, now);
  const [tip, setTip] = useState(session.phase_index % TIPS.length);
  const [confirming, setConfirming] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const isLong = session.stage === "long_break";
  const last = session.next?.stage === "end";

  // Bloqueia atalhos globais (ex.: espaço no player) e qualquer vídeo que tente tocar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (root.current?.contains(e.target as Node)) return;
      e.stopPropagation();
      if (e.key !== "Tab") e.preventDefault();
    };
    const onPlay = (e: Event) => (e.target as HTMLMediaElement).pause?.();
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("play", onPlay, true);
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("play", onPlay, true);
      previous?.focus?.();
    };
  }, []);

  const current = TIPS[tip];
  return (
    <div className={`rest ${isLong ? "is-long" : ""}`} role="dialog" aria-modal="true" aria-labelledby="rest-title" ref={root} tabIndex={-1}>
      <header className="rest-head">
        <p className="rest-eyebrow">
          <Icon name="leaf" size={14} /> {isLong ? "Pausa longa" : "Pausa"} · {session.method_name}
        </p>
        <p className="rest-sub">
          Cumpra a pausa para concluir o ciclo {session.cycle} de {session.cycles_total}.
        </p>
      </header>

      <main className="rest-main">
        <div className="breath" aria-hidden="true">
          <span className="breath-orb" />
          <span className="breath-cue">{breathCue(now)}</span>
        </div>
        <h1 id="rest-title" className="rest-time" aria-live="off">
          {clock(r.remaining ?? 0, { ceil: true })}
        </h1>
        <p className="rest-next">
          {last ? (
            "para o fim da sessão"
          ) : (
            <>
              para o ciclo {session.cycle + 1}
              {session.plan.focus_seconds ? ` · ${duration(session.plan.focus_seconds)} de concentração` : ""}
            </>
          )}
        </p>
        <div className="rest-progress" role="progressbar" aria-label="Pausa" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((r.fraction ?? 0) * 100)}>
          <span style={{ transform: `scaleX(${r.fraction ?? 0})` }} />
        </div>
      </main>

      <section className="rest-tip" aria-label="Sugestão para a pausa">
        <span className="rest-tip-icon">
          <Icon name={current.icon} size={18} />
        </span>
        <div>
          <strong>{current.title}</strong>
          <p>{current.text}</p>
        </div>
        <button type="button" className="icon-button icon-button-sm rest-tip-next" onClick={() => setTip((tip + 1) % TIPS.length)} aria-label="Outra sugestão">
          <Icon name="right" size={16} />
        </button>
      </section>

      <footer className="rest-foot">
        <p>As aulas e os cursos voltam quando a pausa terminar, neste e nos seus outros dispositivos.</p>
        <button type="button" className="button button-ghost button-sm rest-unlock" onClick={() => setConfirming(true)}>
          Preciso voltar agora
        </button>
      </footer>

      {confirming && (
        <ConfirmDialog
          tone="rest"
          title="Sair da pausa antes da hora?"
          confirmLabel="Sair da pausa"
          cancelLabel="Continuar descansando"
          danger
          busy={busy === "unlock_break"}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            if (await runAction("unlock_break", true)) setConfirming(false);
          }}
        >
          <p>
            A pausa será cancelada e o <strong>ciclo {session.cycle} não contará como concluído</strong>.
          </p>
          <p className="muted">
            O tempo de concentração que você já fez, os ciclos anteriores e o histórico continuam valendo.
            {last ? " Como era a última pausa, a sessão termina aqui." : ` Depois, o ciclo ${session.cycle + 1} fica pronto para começar.`}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
