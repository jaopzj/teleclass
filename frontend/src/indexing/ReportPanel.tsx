// Painel de inspeção: os números do relatório e os pontos para conferir.
// Tudo vem do `report` do backend; nada é estimado na tela.
import { Report } from "../api";
import Icon from "../components/Icon";
import { ATTENTION_STATS, issueGroups, STAT_LABELS } from "./model";

export default function ReportPanel({ report }: { report: Report }) {
  const groups = issueGroups(report);
  const pending = groups.reduce((n, g) => n + g.items.length, 0);
  const stats: [string, string, number][] = [
    ...Object.entries(report.stats).map(([key, value]) => [key, STAT_LABELS[key] ?? key, value] as [string, string, number]),
    ["summary_warnings", "Avisos do sumário", report.summary.warnings.length],
  ];

  return (
    <aside className="surface ix-card ix-report" aria-labelledby="ix-report-title">
      <div className="ix-report-head">
        <h2 id="ix-report-title">Inspeção</h2>
        {pending > 0 ? (
          <span className="badge badge-warning">{pending} para conferir</span>
        ) : (
          <span className="badge badge-success">Sem pendências</span>
        )}
      </div>

      <dl className="ix-stats">
        {stats.map(([key, label, value]) => (
          <div key={key} className={ATTENTION_STATS.has(key) && value > 0 ? "is-attention" : ""}>
            <dt>{label}</dt>
            <dd className="tabular">{value.toLocaleString("pt-BR")}</dd>
          </div>
        ))}
      </dl>

      {report.summary.fallback_reason && (
        <div className="alert alert-warning ix-report-alert">
          <strong>Sem sumário.</strong> {report.summary.fallback_reason} As aulas seguem a ordem das mensagens.
        </div>
      )}
      {report.summary.message_ids.length > 0 && (
        <p className="ix-report-source">
          <Icon name="structure" size={16} />
          Sumário lido {report.summary.message_ids.length === 1 ? "da mensagem" : "das mensagens"}{" "}
          {report.summary.message_ids.join(", ")}
        </p>
      )}

      {groups.length > 0 ? (
        <div className="ix-issues">
          {groups.map((group) => (
            <details key={group.key} className="ix-issue">
              <summary>
                <span>{group.title}</span>
                <span className="badge badge-warning tabular">{group.items.length}</span>
                <Icon name="down" size={16} className="ix-issue-chevron" />
              </summary>
              <p className="ix-issue-hint">{group.hint}</p>
              <ul>
                {group.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      ) : (
        <p className="ix-report-ok">
          <Icon name="checkCircle" size={18} />
          Nenhuma inconsistência encontrada nesta coleta.
        </p>
      )}
    </aside>
  );
}
