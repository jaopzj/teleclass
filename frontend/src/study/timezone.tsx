// Fuso horário das métricas: define o do dispositivo na primeira visita e avisa
// quando o dispositivo está num fuso diferente do salvo.
import { useEffect, useRef, useState } from "react";
import { browserTimezone, StudyMetrics, studyApi } from "./api";
import { timezoneLabel } from "./format";
import { invalidateStudyMetrics } from "./metricsStore";

export function useTimezoneSetup(data: StudyMetrics | null) {
  const done = useRef(false);
  useEffect(() => {
    if (!data || data.timezone_configured || done.current) return;
    done.current = true;
    studyApi
      .setTimezone(browserTimezone())
      .then(invalidateStudyMetrics)
      .catch(() => {
        /* continua no padrão; tenta de novo na próxima visita */
      });
  }, [data]);
}

export function TimezoneNotice({ timezone }: { timezone: string }) {
  const device = browserTimezone();
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (device === timezone || dismissed) return null;
  async function use() {
    setSaving(true);
    try {
      await studyApi.setTimezone(device);
      invalidateStudyMetrics();
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="tz-notice" role="status">
      <span>
        Seus dias contam pelo fuso de <strong>{timezoneLabel(timezone)}</strong>, mas este dispositivo está em{" "}
        <strong>{timezoneLabel(device)}</strong>.
      </span>
      <span className="tz-notice-actions">
        <button type="button" className="button button-sm button-soft" onClick={use} disabled={saving}>
          Usar {timezoneLabel(device)}
        </button>
        <button type="button" className="button button-sm button-ghost" onClick={() => setDismissed(true)}>
          Manter
        </button>
      </span>
    </div>
  );
}
