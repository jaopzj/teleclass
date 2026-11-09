// Evolução: as últimas quatro semanas, a partir do que foi registrado (não do
// que as rotinas previam). Dias sem planejamento aparecem como descanso.
import Icon from "../components/Icon";
import { plural } from "../format";
import { useResource } from "../hooks/useResource";
import { routineApi } from "./api";
import { longDay, WEEKDAY_SHORT, weekday } from "./dates";
import { minutesLabel, secondsLabel } from "./domain";
import { IconTile, tone } from "./parts";
import { useRoutineRevision } from "./session";

export default function Evolution() {
  const revision = useRoutineRevision();
  const { data, error, reload } = useResource(`rt-stats:${revision}`, () => routineApi.stats());
  if (error && !data) {
    return (
      <div className="empty">
        <h2>Não foi possível carregar a evolução</h2>
        <button type="button" className="button button-primary" onClick={reload}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!data) return <div className="surface skeleton rt-skel-editor" aria-busy="true" />;

  const { totals, streak, days } = data;
  if (!totals.planned_days) {
    return (
      <div className="empty">
        <span className="empty-icon">
          <Icon name="chart" size={24} />
        </span>
        <h2>Sua evolução aparece aqui</h2>
        <p>Conforme você conclui atividades, este espaço mostra as últimas semanas: dias consistentes, tempo investido e como cada rotina está indo.</p>
      </div>
    );
  }
  // Grade de 4 semanas alinhada na segunda-feira.
  const pad = weekday(days[0].date);
  const cells = [...Array(pad).fill(null), ...days];

  return (
    <div className="rt-evo">
      <section className="surface rt-evo-card" aria-labelledby="rt-evo-days">
        <div className="rt-card-head">
          <h2 id="rt-evo-days" className="rt-card-title">
            Últimas 4 semanas
          </h2>
          <span className="rt-legend" aria-hidden="true">
            <i className="is-rest" /> sem plano <i className="is-low" /> começou <i className="is-mid" /> consistente <i className="is-full" /> tudo feito
          </span>
        </div>
        <div className="rt-heat" role="list">
          {WEEKDAY_SHORT.map((d) => (
            <span key={d} className="rt-heat-dow" aria-hidden="true">
              {d}
            </span>
          ))}
          {cells.map((d, i) =>
            d ? (
              <span
                key={d.date}
                role="listitem"
                className={`rt-heat-cell ${d.planned === 0 ? "is-rest" : d.progress === 1 ? "is-full" : d.consistent ? "is-mid" : d.completed ? "is-low" : "is-none"} ${d.date === data.today ? "is-today" : ""}`}
                data-tip={`${longDay(d.date)}: ${d.planned ? `${d.completed} de ${d.planned}${d.time_progress != null ? ` · ${Math.round(d.time_progress * 100)}% do tempo` : ""}` : "sem planejamento"}`}
                aria-label={`${longDay(d.date)}: ${d.planned ? `${d.completed} de ${d.planned} concluídas` : "sem planejamento"}`}
                tabIndex={0}
              />
            ) : (
              <span key={`pad-${i}`} aria-hidden="true" />
            ),
          )}
        </div>
      </section>
      <section className="surface rt-evo-card" aria-label="Totais do período">
        <dl className="rt-stats rt-evo-stats">
          <div>
            <dt>Concluídas</dt>
            <dd className="tabular">
              {totals.completed}
              <small>/{totals.planned}</small>
            </dd>
          </div>
          <div>
            <dt>Tempo investido</dt>
            <dd className="tabular">{secondsLabel(totals.invested_seconds)}</dd>
          </div>
          <div>
            <dt>Tempo planejado feito</dt>
            <dd className="tabular">
              {totals.time_progress == null ? "—" : `${Math.round(totals.time_progress * 100)}%`}
              {totals.planned_minutes > 0 && <small> de {minutesLabel(totals.planned_minutes)}</small>}
            </dd>
          </div>
          <div>
            <dt>Dias consistentes</dt>
            <dd className="tabular">
              {totals.consistent_days}
              <small> de {totals.planned_days} planejados</small>
            </dd>
          </div>
          <div>
            <dt>Sequência</dt>
            <dd className="tabular">
              {plural(streak.current, "dia", "dias")}
              <small> · melhor {streak.best}</small>
            </dd>
          </div>
        </dl>
        <p className="rt-muted">O tempo vem do cronômetro do Foco e conta até a duração de cada atividade. Um dia é consistente quando você conclui pelo menos metade das atividades planejadas. Dias sem planejamento não interrompem a sequência.</p>
      </section>
      {data.routines.length > 0 && (
        <section className="surface rt-evo-card" aria-labelledby="rt-evo-routines">
          <h2 id="rt-evo-routines" className="rt-card-title">
            Por rotina
          </h2>
          <ul className="rt-evo-routines">
            {data.routines.map((r) => {
              // Pelo tempo do Foco: quanto do tempo planejado da rotina foi feito.
              const byTime = r.time_progress != null;
              const pct = Math.round((byTime ? r.time_progress! : r.completed / r.planned) * 100);
              return (
                <li key={r.id} style={tone(r.color)}>
                  <IconTile icon={r.icon_key} color={r.color} label={r.name} size={32} />
                  <span className="rt-evo-name">{r.name}</span>
                  <span className="rt-evo-bar" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="rt-evo-val tabular" data-tip={`${r.completed} de ${r.planned} concluídas${byTime ? ` · ${secondsLabel(r.time_done_seconds)} de ${minutesLabel(r.planned_minutes)}` : ""}`}>
                    {byTime ? `${pct}% do tempo` : `${r.completed}/${r.planned}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
