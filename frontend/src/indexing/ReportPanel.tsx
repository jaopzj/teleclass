import { ReactNode } from "react";
import { Report } from "../api";

const STAT_LABELS: Record<string, string> = {
  messages: "Mensagens",
  media_messages: "Com mídia",
  lessons: "Aulas",
  resolved_lessons: "Resolvidas",
  unresolved_lessons: "Não resolvidas",
  materials: "Materiais",
  orphan_media_messages: "Mídias fora do curso",
};

function Block({ title, items }: { title: string; items: ReactNode[] }) {
  if (items.length === 0) return null;
  return (
    <div className="report-block">
      <h3>
        {title} <span className="count">{items.length}</span>
      </h3>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function ReportPanel({ report }: { report: Report }) {
  return (
    <aside className="report">
      <h2>Inspeção</h2>
      <dl className="stats">
        {Object.entries(report.stats).map(([key, value]) => (
          <div key={key}>
            <dt>{STAT_LABELS[key] ?? key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {report.summary.fallback_reason && <p className="error">Fallback: {report.summary.fallback_reason}</p>}
      <Block
        title="Referências não resolvidas"
        items={report.unresolved.map((u) => `#${u.ref} em ${u.location} (${u.section})`)}
      />
      <Block
        title="Duplicadas no sumário"
        items={report.duplicates_in_summary.map((d) => `#${d.ref}: mantida em ${d.kept_at}, ignorada em ${d.ignored_at.join(", ")}`)}
      />
      <Block
        title="Referências com várias mensagens"
        items={report.multi_message_refs.map((m) => `#${m.ref}: mensagens ${m.message_ids.join(", ")}`)}
      />
      <Block
        title="Mensagens em mais de uma aula"
        items={report.shared_messages.map((s) => `msg ${s.message_id}: ${s.refs.join(", ")}`)}
      />
      <Block
        title="No canal, mas fora do sumário"
        items={Object.entries(report.refs_not_in_summary).map(([ref, ids]) => `#${ref}: mensagens ${ids.join(", ")}`)}
      />
      <Block
        title="Materiais fora do curso"
        items={report.orphans.map(
          (o) =>
            `mensagens ${o.message_ids.join(", ")}` +
            (o.refs.length ? ` · ${o.refs.map((r) => "#" + r).join(" ")}` : "") +
            (o.caption.trim() ? ` · ${o.caption.trim().split("\n")[0].slice(0, 60)}` : ""),
        )}
      />
      <Block title="Avisos do sumário" items={report.summary.warnings} />
      <Block
        title="Outros candidatos a sumário"
        items={report.summary.discarded_candidates.map((c) => `mensagens ${c.message_ids.join(", ")} (${c.refs} refs)`)}
      />
    </aside>
  );
}
