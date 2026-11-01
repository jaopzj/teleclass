import { useState } from "react";
import { chime, notify, requestSystemPermission, systemPermission } from "../notifications/center";
import { NoticeKind, NotificationPreferences } from "./api";
import Icon from "../components/Icon";
import { Link, paths } from "../router";
import { savePreferences, useFocus } from "./store";
import "./settings.css";

const KINDS: [NoticeKind, string, string][] = [
  ["focus_completed", "Fim de um ciclo de foco", "Hora de descansar ou de começar o próximo"],
  ["break_ending", "Pausa chegando ao fim", "Um aviso antes de voltar ao foco"],
  ["break_completed", "Fim da pausa", "O próximo ciclo está pronto"],
  ["session_ended", "Sessão concluída", "Resumo com tempo, ciclos e XP"],
  ["goal_reached", "Meta cumprida", "Diária ou semanal"],
  ["achievement_unlocked", "Conquista desbloqueada", ""],
  ["level_up", "Novo nível", ""],
];

/**
 * Configurações: hoje, os avisos do temporizador (guardados na conta). O som
 * ambiente fica na página Foco, na área Som ambiente.
 */
export default function SettingsPage() {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Configurações</h1>
          <p className="muted">Preferências da sua conta, válidas em todos os seus dispositivos.</p>
        </div>
      </header>
      <SettingsBody />
    </div>
  );
}

function SettingsBody() {
  const { prefs } = useFocus();
  const [permission, setPermission] = useState(systemPermission());
  const [error, setError] = useState<string | null>(null);

  if (!prefs) return <div className="surface skeleton" style={{ height: 300 }} />;

  async function update(next: Partial<NotificationPreferences>) {
    setError(null);
    try {
      await savePreferences(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleSystem(on: boolean) {
    if (on) {
      const result = await requestSystemPermission();
      setPermission(result);
      if (result !== "granted") {
        setError(result === "unsupported" ? "Este navegador não tem notificações do sistema." : "O navegador bloqueou as notificações. Libere nas configurações do site e tente de novo.");
        return;
      }
    }
    await update({ system: on });
  }

  return (
    <div className="settings">
      <section className="surface settings-block" aria-labelledby="notif-title">
        <h2 id="notif-title">Avisos do temporizador</h2>
        <p className="muted small">Valem para todos os seus dispositivos.</p>
        <div className="settings-rows">
          <Toggle label="Avisos na tela" hint="Cartões discretos no canto superior direito" checked={prefs.in_app} onChange={(v) => update({ in_app: v })} />
          <Toggle
            label="Notificações do sistema"
            hint={permission === "denied" ? "Bloqueadas pelo navegador neste dispositivo" : "Aparecem mesmo com o TeleClass em segundo plano"}
            checked={prefs.system && permission === "granted"}
            onChange={toggleSystem}
          />
          <Toggle label="Som" hint="Duas notas curtas e suaves" checked={prefs.sound} onChange={(v) => { void update({ sound: v }); if (v) chime("focus"); }} />
          <div className="settings-row">
            <div>
              <p className="settings-label">Avisar antes do fim da pausa</p>
            </div>
            <select className="select select-sm" value={prefs.break_ending_seconds} onChange={(e) => update({ break_ending_seconds: Number(e.target.value) as NotificationPreferences["break_ending_seconds"] })}>
              <option value={0}>Não avisar</option>
              <option value={30}>30 s antes</option>
              <option value={60}>1 min antes</option>
              <option value={120}>2 min antes</option>
            </select>
          </div>
        </div>
        <h3 className="settings-sub">Quais avisos</h3>
        <div className="settings-rows">
          {KINDS.map(([kind, label, hint]) => (
            <Toggle key={kind} label={label} hint={hint} checked={prefs.kinds[kind] !== false} onChange={(v) => update({ kinds: { ...prefs.kinds, [kind]: v } })} />
          ))}
        </div>
        <button type="button" className="button button-sm" onClick={() => notify({ title: "Aviso de teste", body: "É assim que os avisos do temporizador aparecem.", tone: "focus", inApp: true, sound: prefs.sound, system: prefs.system, essential: true })}>
          Testar aviso
        </button>
        {error && <div className="alert alert-error">{error}</div>}
      </section>
      <section className="surface settings-block" aria-labelledby="sound-title">
        <h2 id="sound-title">Som ambiente</h2>
        <p className="muted small">Sons, volumes e favoritos ficam na página Foco.</p>
        <Link className="button button-sm settings-link" to={paths.focus("som")}>
          <Icon name="volume" size={16} /> Abrir Som ambiente
        </Link>
      </section>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="settings-row">
      <div>
        <p className="settings-label">{label}</p>
        {hint && <p className="settings-hint">{hint}</p>}
      </div>
      <span className="switch">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span aria-hidden="true" />
      </span>
    </label>
  );
}
