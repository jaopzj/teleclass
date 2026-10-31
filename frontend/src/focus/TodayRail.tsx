import { useResource } from "../hooks/useResource";
import { focusApi } from "./api";
import { duration } from "./derive";
import { useFocus } from "./store";

/** Resumo de hoje e da semana (tempo de foco, sessões, ciclos). */
export default function TodayRail() {
  const { revision } = useFocus();
  const { data } = useResource(`focus-stats:7d:${revision}`, () => focusApi.stats("7d"));
  const today = data?.daily[data.daily.length - 1];
  return (
    <section className="rail-block rail-today" aria-label="Hoje">
      <dl>
        <div>
          <dt>Hoje</dt>
          <dd>{today ? duration(today.seconds) : "—"}</dd>
        </div>
        <div>
          <dt>Ciclos hoje</dt>
          <dd>{today ? today.cycles : "—"}</dd>
        </div>
        <div>
          <dt>7 dias</dt>
          <dd>{data ? duration(data.summary.focus_seconds) : "—"}</dd>
        </div>
      </dl>
    </section>
  );
}
