import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, IndexResult, SnapshotInfo } from "./api";
import CourseTree from "./CourseTree";
import ReportPanel from "./ReportPanel";

export default function App() {
  const [status, setStatus] = useState<{ configured: boolean; authorized: boolean }>();
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [selected, setSelected] = useState<string>();
  const [result, setResult] = useState<IndexResult>();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setSnapshots(await api.snapshots());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api.status().then(setStatus).catch(() => setStatus(undefined));
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    setResult(undefined);
    setError(undefined);
    api.index(selected).then(setResult).catch((e: Error) => setError(e.message));
  }, [selected]);

  async function collect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const { name } = await api.collect(link.trim());
      await refresh();
      setSelected(name);
      setLink("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Teleaula</h1>
        <p className="muted">
          Telegram:{" "}
          {!status ? "?" : !status.configured ? "não configurado" : status.authorized ? "conectado" : "não conectado"}
        </p>

        <form onSubmit={collect} className="collect">
          <input
            placeholder="https://t.me/canal"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            disabled={busy || !status?.authorized}
          />
          <button disabled={busy || !link.trim() || !status?.authorized}>
            {busy ? "Coletando..." : "Coletar canal"}
          </button>
        </form>

        <h2>Snapshots</h2>
        {snapshots.length === 0 && <p className="muted">Nenhum snapshot em data/snapshots.</p>}
        <ul className="snapshots">
          {snapshots.map((s) => (
            <li key={s.name}>
              <button className={s.name === selected ? "active" : ""} onClick={() => setSelected(s.name)}>
                <strong>{s.title ?? s.name}</strong>
                <span className="muted">
                  {s.name} · {s.messages} mensagens
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main>
        {error && <div className="error">{error}</div>}
        {!selected && <p className="muted">Selecione um snapshot para ver a estrutura extraída.</p>}
        {selected && !result && !error && <p className="muted">Indexando...</p>}
        {result && (
          <div className="content">
            <section className="course">
              <h2>{result.course.title}</h2>
              <p className="muted">
                Estratégia: {result.course.strategy === "summary" ? "sumário" : "fallback cronológico"}
                {result.report.summary.message_ids.length > 0 &&
                  ` · sumário nas mensagens ${result.report.summary.message_ids.join(", ")}`}
              </p>
              <CourseTree sections={result.course.sections} />
            </section>
            <ReportPanel report={result.report} />
          </div>
        )}
      </main>
    </div>
  );
}
