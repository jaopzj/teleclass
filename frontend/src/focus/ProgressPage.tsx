import GoalsPanel from "./Goals";
import { AchievementsTab } from "./Progression";
import "./progress.css";

/**
 * Conquistas, nível e metas. Saíram da página Foco (que cuida só da
 * concentração) e continuam aqui, acessíveis pelo menu da conta.
 */
export default function ProgressPage() {
  return (
    <div className="page progress-page">
      <header className="page-head">
        <div>
          <h1>Conquistas</h1>
          <p className="muted">Seu nível, suas metas de concentração e as conquistas desbloqueadas.</p>
        </div>
      </header>
      <div className="progress-layout">
        <AchievementsTab />
        <aside className="progress-side">
          <GoalsPanel />
        </aside>
      </div>
    </div>
  );
}
