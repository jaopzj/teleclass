import flameUrl from "../assets/flame.webp";
import { StudyMetrics } from "../study/api";
import { formatStudyTime } from "../study/format";
import { longDate } from "./dates";

type FlameState = "lit" | "waiting" | "out";

/**
 * Destaque do topo: data, boas-vindas e a sequência de dias de estudo.
 * A chama acende quando o dia de hoje já conta para a sequência; fica
 * esmaecida enquanto a sequência espera o estudo de hoje; apagada sem sequência.
 */
export default function StreakBanner({ name, metrics }: { name: string; metrics: StudyMetrics }) {
  const { streak, today, rules } = metrics;
  const remaining = Math.max(0, rules.active_day_seconds - today.seconds);
  const state: FlameState = streak.current > 0 ? (streak.includes_today ? "lit" : "waiting") : "out";

  return (
    <section className={`streak is-${state}`} aria-labelledby="streak-title">
      <div className="streak-text">
        <p className="streak-date">{longDate(today.date)}</p>
        <h1 id="streak-title" className="streak-title">
          Bem-vindo de volta, {name}!
        </h1>
        <p className="streak-message">
          <StreakMessage state={state} days={streak.current} remaining={remaining} studiedToday={today.seconds > 0} />
        </p>
      </div>
      <img className="streak-flame" src={flameUrl} alt="" width={412} height={402} decoding="async" />
    </section>
  );
}

function StreakMessage({ state, days, remaining, studiedToday }: { state: FlameState; days: number; remaining: number; studiedToday: boolean }) {
  const span = `${days} ${days === 1 ? "dia" : "dias"} de estudos`;
  if (state === "lit") {
    return (
      <>
        Sequência de <strong>{span}!</strong> Parabéns!
      </>
    );
  }
  if (state === "waiting") {
    return (
      <>
        Sequência de <strong>{span}.</strong> Estude <strong>{formatStudyTime(remaining)}</strong> hoje para mantê-la!
      </>
    );
  }
  return studiedToday ? (
    <>
      Faltam <strong>{formatStudyTime(remaining)}</strong> hoje para começar sua sequência.
    </>
  ) : (
    <>
      Estude <strong>{formatStudyTime(remaining)}</strong> hoje para começar uma sequência.
    </>
  );
}
