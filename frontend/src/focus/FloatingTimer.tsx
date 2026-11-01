import { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Icon from "../components/Icon";
import { Link, paths } from "../router";
import { EndedSummary, FocusSession } from "./api";
import { primaryAction, runAction, stopMessage } from "./Controls";
import { displayTime, duration, ENDED_LABEL, isStopwatch, nextLabel, readout, sessionFraction, shortStage, toneOf } from "./derive";
import { useFocus } from "./store";
import TimerRing from "./TimerRing";
import { useServerNow } from "./useNow";

// --- posição e modo (guardados neste dispositivo, fora do React) -----------------------
//
// A posição é relativa ao canto mais próximo (horizontal e vertical), então o
// widget continua no mesmo lugar visual ao redimensionar a janela ou ao entrar
// e sair da tela cheia. O modo (compacto ou expandido) sobrevive à troca de
// página e de camada (a tela cheia monta o widget dentro do player).

interface Position {
  h: "left" | "right";
  v: "top" | "bottom";
  x: number;
  y: number;
}

const POS_KEY = "teleaula:focus:float-position";
const MODE_KEY = "teleaula:focus:widget";
const MARGIN = 12; // distância mínima das bordas
const SNAP = 32; // perto assim da borda, acomoda na margem
const DRAG_THRESHOLD = 4;

function topbarHeight() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--topbar-h");
  return parseInt(raw, 10) || 72;
}
// Canto superior direito, abaixo da linha do título das páginas, para não cobrir
// as ações que ficam ali (como "Adicionar curso").
const defaultPosition = (): Position => ({ h: "right", v: "top", x: 16, y: topbarHeight() + 80 });

function load<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return valid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
const isPosition = (v: unknown): v is Position => {
  const p = v as Position;
  return !!p && (p.h === "left" || p.h === "right") && (p.v === "top" || p.v === "bottom") && Number.isFinite(p.x) && Number.isFinite(p.y);
};

let position: Position | null = null;
let expanded = load(MODE_KEY, false, (v): v is boolean => typeof v === "boolean");
const subs = new Set<() => void>();
const emit = () => subs.forEach((l) => l());
const subscribe = (l: () => void) => {
  subs.add(l);
  return () => subs.delete(l);
};
function getPosition() {
  position ??= load(POS_KEY, defaultPosition(), isPosition);
  return position;
}
function setPosition(p: Position) {
  position = p;
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {
    /* modo privado */
  }
  emit();
}
function setExpanded(value: boolean) {
  expanded = value;
  try {
    localStorage.setItem(MODE_KEY, JSON.stringify(value));
  } catch {
    /* modo privado */
  }
  emit();
}

/** Elemento em tela cheia (o player), para o widget renderizar dentro dele e continuar visível. */
function useFullscreenElement(): Element | null {
  const get = () => document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ?? null;
  return useSyncExternalStore((l) => {
    document.addEventListener("fullscreenchange", l);
    document.addEventListener("webkitfullscreenchange", l);
    return () => {
      document.removeEventListener("fullscreenchange", l);
      document.removeEventListener("webkitfullscreenchange", l);
    };
  }, get);
}

// --- widget -----------------------------------------------------------------------------------

/**
 * Temporizador flutuante: acompanha a sessão em qualquer página, inclusive com
 * o vídeo em tela cheia. Só desenha e repassa ações: a contagem e as regras
 * vêm do store, a mesma fonte da página Foco.
 */
export default function FloatingTimer() {
  const { session, lastEnded } = useFocus();
  const host = useFullscreenElement() ?? document.body;
  const [ended, setEnded] = useState<EndedSummary | null>(null);
  const seen = useRef<string | null>(null);

  // Ao terminar, mostra o resultado por alguns segundos e recolhe sozinho.
  useEffect(() => {
    if (session || !lastEnded || seen.current === lastEnded.session_id) return;
    seen.current = lastEnded.session_id;
    setEnded(lastEnded);
  }, [session, lastEnded]);
  useEffect(() => {
    if (session) setEnded(null);
  }, [session]);

  if (!session && !ended) return null;
  return createPortal(
    <FloatShell key={session ? "live" : `ended-${ended?.session_id}`}>
      {(controls) =>
        session ? <LiveContent session={session} {...controls} /> : <EndedContent ended={ended as EndedSummary} onDone={() => setEnded(null)} {...controls} />
      }
    </FloatShell>,
    host,
  );
}

interface ShellControls {
  expanded: boolean;
  toggle: () => void;
  /** Liga o arrastar a um elemento (o widget inteiro funciona como alça). */
  grip: {
    onKeyDown: (e: ReactKeyboardEvent) => void;
  };
}

/** A casca: posição, arrastar com acomodação nas bordas, teclado e animação de entrada. */
function FloatShell({ children }: { children: (c: ShellControls) => JSX.Element }) {
  const pos = useSyncExternalStore(subscribe, getPosition);
  const open = useSyncExternalStore(subscribe, () => expanded);
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; rect: DOMRect; moving: boolean } | null>(null);
  const settleFrom = useRef<DOMRect | null>(null);
  const suppressClick = useRef(false);
  const [box, setBox] = useState({ vw: window.innerWidth, vh: window.innerHeight, w: 0, h: 0 });

  // Mede o widget e a janela para nunca deixá-lo sair da tela.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const measure = () => setBox({ vw: window.innerWidth, vh: window.innerHeight, w: node.offsetWidth, h: node.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Depois de soltar, desliza do ponto onde estava até o lugar acomodado (FLIP).
  useLayoutEffect(() => {
    const node = el.current;
    const from = settleFrom.current;
    if (!node || !from) return;
    settleFrom.current = null;
    const to = node.getBoundingClientRect();
    node.style.transition = "none";
    node.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px)`;
    void node.offsetWidth;
    node.style.transition = "";
    node.style.transform = "";
  }, [pos]);

  const maxX = Math.max(MARGIN, box.vw - box.w - MARGIN);
  const maxY = Math.max(MARGIN, box.vh - box.h - MARGIN);
  const style = {
    [pos.h]: Math.min(Math.max(pos.x, MARGIN), maxX),
    [pos.v]: Math.min(Math.max(pos.y, MARGIN), maxY),
  };

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("input, select, textarea, a, [data-no-drag]")) return;
    const node = el.current;
    if (!node) return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, rect: node.getBoundingClientRect(), moving: false };
    // Escuta na janela: um movimento rápido sai do widget antes de o arrastar começar.
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onPointerUp();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag.current;
    const node = el.current;
    if (!d || !node || d.id !== e.pointerId) return;
    let dx = e.clientX - d.sx;
    let dy = e.clientY - d.sy;
    if (!d.moving) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moving = true;
      node.classList.add("is-dragging");
    }
    // Mantém dentro da janela também durante o arrastar.
    dx = Math.min(Math.max(dx, MARGIN - d.rect.left), window.innerWidth - MARGIN - d.rect.right);
    dy = Math.min(Math.max(dy, MARGIN - d.rect.top), window.innerHeight - MARGIN - d.rect.bottom);
    node.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function onPointerUp() {
    const d = drag.current;
    const node = el.current;
    drag.current = null;
    if (!d || !node || !d.moving) return;
    suppressClick.current = true;
    // O clique que segue o soltar (se cair no widget) é engolido; fora dele, nada a engolir.
    window.setTimeout(() => (suppressClick.current = false), 0);
    node.classList.remove("is-dragging");
    const r = node.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = r.left + r.width / 2 < vw / 2 ? "left" : "right";
    const v = r.top + r.height / 2 < vh / 2 ? "top" : "bottom";
    const snap = (n: number) => (n < SNAP ? MARGIN : n);
    settleFrom.current = r;
    node.style.transform = "";
    setPosition({ h, v, x: snap(h === "left" ? r.left : vw - r.right), y: snap(v === "top" ? r.top : vh - r.bottom) });
  }

  // Alternativa ao arrastar: setas levam o widget para outro canto.
  function onGripKey(e: ReactKeyboardEvent) {
    const next = { ...pos };
    if (e.key === "ArrowLeft") next.h = "left";
    else if (e.key === "ArrowRight") next.h = "right";
    else if (e.key === "ArrowUp") next.v = "top";
    else if (e.key === "ArrowDown") next.v = "bottom";
    else return;
    e.preventDefault();
    const base = defaultPosition();
    next.x = base.x;
    next.y = next.v === "top" ? base.y : MARGIN + 4;
    settleFrom.current = el.current?.getBoundingClientRect() ?? null;
    setPosition(next);
  }

  return (
    <div
      ref={el}
      className={`fx-float ${open ? "is-expanded" : ""} from-${pos.h} from-${pos.v}`}
      style={style}
      onPointerDown={onPointerDown}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      // Teclas usadas aqui não vão para os atalhos do player (espaço, setas...).
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && open) setExpanded(false);
      }}
      onKeyUp={(e) => e.stopPropagation()}
    >
      {children({ expanded: open, toggle: () => setExpanded(!open), grip: { onKeyDown: onGripKey } })}
    </div>
  );
}

function LiveContent({ session, expanded, toggle, grip }: { session: FocusSession } & ShellControls) {
  const { busy } = useFocus();
  const now = useServerNow(true);
  const [confirming, setConfirming] = useState(false);
  const r = readout(session, now);
  const tone = toneOf(session);
  const stopwatch = isStopwatch(session);
  const time = session.stage === "ready" ? "Pronto" : displayTime(session, r);
  const stage = shortStage(session);
  const primary = primaryAction(session);
  const total = sessionFraction(session, r);
  const next = nextLabel(session);
  const needsConfirm = !(stopwatch && session.stage === "focus");
  const body = useRef<HTMLDivElement>(null);
  // Recolhido, o conteúdo fica fora do teclado e dos leitores de tela.
  useEffect(() => {
    body.current?.toggleAttribute("inert", !expanded);
    if (!expanded) setConfirming(false);
  }, [expanded]);

  return (
    <section className={`fx-float-card tone-${tone}`} aria-label="Temporizador de estudos">
      <div className="fx-float-bar">
        <TimerRing fraction={session.stage === "ready" ? 0 : stopwatch ? null : r.fraction} tone={tone} stroke={10} className="fx-float-ring">
          <Icon name={session.paused ? "pause" : session.stage === "ready" ? "play" : tone === "rest" ? "leaf" : "timer"} size={12} weight={session.paused || session.stage === "ready" ? "fill" : undefined} />
        </TimerRing>
        <button type="button" className="fx-float-readout" onClick={toggle} aria-expanded={expanded} aria-label={`${stage}, ${time}. ${expanded ? "Recolher" : "Expandir"} temporizador`}>
          <span className="fx-float-time tabular">{time}</span>
          <span className="fx-float-stage">
            <span key={stage} className="fx-swap">
              {stage}
            </span>
          </span>
        </button>
        {!expanded && session.stage === "ready" && primary && (
          <button type="button" className="fx-float-btn is-primary" onClick={() => runAction(primary.action)} disabled={!!busy} aria-label={primary.label}>
            <Icon name="play" size={14} weight="fill" />
          </button>
        )}
        <button type="button" className="fx-float-btn fx-float-grip" aria-label="Mover temporizador. Use as setas para trocar de canto." onKeyDown={grip.onKeyDown}>
          <Icon name="grip" size={16} />
        </button>
        <button type="button" className="fx-float-btn" onClick={toggle} aria-label={expanded ? "Minimizar temporizador" : "Expandir temporizador"}>
          <Icon name={expanded ? "minimize" : "open"} size={15} />
        </button>
      </div>

      <div className="fx-float-body" ref={body}>
        <div className="fx-float-inner">
          <p className="fx-float-method">
            {session.method_name}
            {!stopwatch && (
              <span>
                {" "}
                · ciclo {session.cycle} de {session.cycles_total}
              </span>
            )}
          </p>
          {total != null && (
            <div className="fx-float-progress" role="progressbar" aria-label="Progresso da sessão" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(total * 100)}>
              <span style={{ transform: `scaleX(${total})` }} />
            </div>
          )}
          <dl className="fx-float-facts">
            <div>
              <dt>Concentração</dt>
              <dd className="tabular">{duration(r.focus)}</dd>
            </div>
            {next && (
              <div>
                <dt>Depois</dt>
                <dd>{next}</dd>
              </div>
            )}
          </dl>
          {session.intention && <p className="fx-float-goal">{session.intention}</p>}
          {session.course && (
            <Link className="fx-float-link" to={session.lesson ? paths.lesson(session.course.id, session.lesson.key) : paths.course(session.course.id)}>
              <Icon name={session.lesson ? "play" : "courses"} size={13} />
              <span>{session.lesson?.title ?? session.course.title}</span>
            </Link>
          )}
          {session.deadline_at && (session.stage === "ready" || session.paused) && (
            <p className="fx-float-note">Sem atividade, encerra em {duration(Math.max(0, session.deadline_at - now))}.</p>
          )}

          {confirming ? (
            <div className="fx-float-confirm" role="alertdialog" aria-label="Encerrar a sessão agora?">
              <p>
                <strong>Encerrar a sessão agora?</strong> {stopMessage(session)}
              </p>
              <div className="fx-float-actions">
                <button type="button" className="fx-float-action" onClick={() => setConfirming(false)} disabled={busy === "stop"} autoFocus>
                  Continuar
                </button>
                <button
                  type="button"
                  className="fx-float-action is-danger"
                  disabled={busy === "stop"}
                  onClick={async () => {
                    if (await runAction("stop")) setConfirming(false);
                  }}
                >
                  {busy === "stop" ? "Encerrando..." : "Encerrar"}
                </button>
              </div>
            </div>
          ) : (
            <div className="fx-float-actions">
              {primary && (
                <button type="button" className="fx-float-action is-primary" onClick={() => runAction(primary.action)} disabled={!!busy}>
                  <Icon name={primary.icon} size={14} weight="fill" />
                  {primary.action === "start_next" ? `Ciclo ${session.cycle}` : primary.label}
                </button>
              )}
              <button type="button" className="fx-float-action" onClick={() => (needsConfirm ? setConfirming(true) : runAction("stop"))} disabled={!!busy}>
                <Icon name="stop" size={14} />
                {stopwatch ? "Concluir" : "Encerrar"}
              </button>
            </div>
          )}
          <Link className="fx-float-open" to={paths.focus()}>
            Abrir temporizador completo <Icon name="chevron" size={12} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function EndedContent({ ended, onDone, expanded }: { ended: EndedSummary; onDone: () => void } & ShellControls) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLeaving(true), expanded ? 9000 : 6000);
    return () => window.clearTimeout(t);
  }, [expanded]);
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(onDone, 260);
    return () => window.clearTimeout(t);
  }, [leaving, onDone]);
  const done = ended.status === "completed";
  return (
    <section className={`fx-float-card is-ended ${done ? "tone-done" : "tone-paused"} ${leaving ? "is-leaving" : ""}`} role="status" aria-label="Sessão encerrada">
      <div className="fx-float-bar">
        <span className="fx-float-badge" aria-hidden="true">
          <Icon name={done ? "check" : "stop"} size={14} weight={done ? "bold" : undefined} />
        </span>
        <Link className="fx-float-readout" to={paths.focus("historico")}>
          <span className="fx-float-time">Sessão {ENDED_LABEL[ended.status].toLowerCase()}</span>
          <span className="fx-float-stage">{duration(ended.focus_seconds)} de concentração</span>
        </Link>
        <button type="button" className="fx-float-btn" onClick={() => setLeaving(true)} aria-label="Fechar">
          <Icon name="close" size={15} />
        </button>
      </div>
    </section>
  );
}
