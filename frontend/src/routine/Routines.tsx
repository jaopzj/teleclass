// Minhas rotinas: ativas à vista; pausadas e arquivadas separadas, cada uma com
// a ação que faz sentido para o estado.
import { useState } from "react";
import Icon from "../components/Icon";
import ConfirmDialog from "../focus/ConfirmDialog";
import { useResource } from "../hooks/useResource";
import { notify } from "../notifications/center";
import { Link, navigate, paths } from "../router";
import { Routine, routineApi, RoutineStatus } from "./api";
import { failed } from "./actions";
import { WEEKDAY_INITIAL, WEEKDAY_LONG } from "./dates";
import { minutesLabel, MODE_LABEL } from "./domain";
import Menu from "./Menu";
import { IconTile, tone } from "./parts";
import { bumpRoutine, useRoutineRevision } from "./session";

export default function Routines({ today }: { today: string }) {
  const revision = useRoutineRevision();
  const { data, error, reload, setData } = useResource(`rt-routines:${revision}`, routineApi.routines);
  const [showArchived, setShowArchived] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "delete" | "archive"; routine: Routine } | null>(null);
  const [busy, setBusy] = useState(false);

  const setStatus = async (r: Routine, status: RoutineStatus) => {
    const previous = data;
    setData(data?.map((x) => (x.id === r.id ? { ...x, status } : x)));
    try {
      await routineApi.setRoutineStatus(r.id, status);
      bumpRoutine();
      const msg = { active: "Rotina ativada", paused: "Rotina pausada", archived: "Rotina arquivada" }[status];
      const body = {
        active: r.weekdays.length ? "Ela volta a aparecer nos dias programados." : "Aplique-a a um dia quando quiser.",
        paused: "Ela não entra em novos dias até você ativar de novo. O histórico continua.",
        archived: "Ela sai das rotinas ativas. Você pode restaurar quando quiser.",
      }[status];
      notify({ title: msg, body, tone: "neutral", durationMs: 4500 });
    } catch (e) {
      setData(previous);
      failed("Não foi possível mudar a rotina", e);
    }
  };

  const applyToday = async (r: Routine) => {
    try {
      const result = await routineApi.apply(r.id, today);
      bumpRoutine();
      notify({
        title: result.created.length ? `${r.name} aplicada a hoje` : `${r.name} já está em hoje`,
        tone: result.created.length ? "success" : "neutral",
        action: { label: "Ver meu dia", run: () => navigate(paths.routine()) },
      });
    } catch (e) {
      failed("Não foi possível aplicar", e);
    }
  };

  const doConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "delete") {
        await routineApi.deleteRoutine(confirm.routine.id);
        notify({ title: "Rotina excluída", body: "O histórico dos dias passados continua na agenda.", tone: "neutral" });
        bumpRoutine();
      } else await setStatus(confirm.routine, "archived");
      setConfirm(null);
    } catch (e) {
      failed("Não foi possível excluir", e);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return (
      <div className="empty">
        <h2>Não foi possível carregar suas rotinas</h2>
        <button type="button" className="button button-primary" onClick={reload}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rt-routines">
        {[0, 1, 2].map((i) => (
          <div key={i} className="surface skeleton rt-skel-card" />
        ))}
      </div>
    );
  }

  const active = data.filter((r) => r.status === "active");
  const paused = data.filter((r) => r.status === "paused");
  const archived = data.filter((r) => r.status === "archived");

  if (!active.length && !paused.length) {
    return (
      <>
        <div className="empty rt-routines-empty">
          <span className="empty-icon">
            <Icon name="layers" size={26} />
          </span>
          <h2>Monte sua primeira rotina</h2>
          <p>Uma rotina junta atividades que você repete, como a manhã, os estudos ou o treino. Escolha os dias e ela entra na sua agenda sozinha.</p>
          <Link className="button button-primary" to={paths.routine("rotinas/nova")}>
            <Icon name="plus" size={16} weight="bold" />
            Criar rotina
          </Link>
        </div>
        {archived.length > 0 && <Archived list={archived} open={showArchived} toggle={() => setShowArchived((v) => !v)} onRestore={(r) => setStatus(r, "paused")} onDelete={(r) => setConfirm({ kind: "delete", routine: r })} />}
        {confirm && <Confirm confirm={confirm} busy={busy} onCancel={() => setConfirm(null)} onConfirm={doConfirm} />}
      </>
    );
  }

  const card = (r: Routine) => (
    <RoutineCard
      key={r.id}
      routine={r}
      onApply={() => applyToday(r)}
      onToggle={() => setStatus(r, r.status === "active" ? "paused" : "active")}
      onArchive={() => setConfirm({ kind: "archive", routine: r })}
      onDelete={() => setConfirm({ kind: "delete", routine: r })}
    />
  );

  return (
    <div className="rt-routines">
      {active.length > 0 && <ul className="rt-routine-grid">{active.map(card)}</ul>}
      {paused.length > 0 && (
        <section className="rt-routine-section" aria-labelledby="rt-paused">
          <h2 id="rt-paused" className="rt-section-title">
            Pausadas
          </h2>
          <p className="rt-section-hint">Não entram em novos dias. Dá para editar e aplicar à mão.</p>
          <ul className="rt-routine-grid">{paused.map(card)}</ul>
        </section>
      )}
      {archived.length > 0 && <Archived list={archived} open={showArchived} toggle={() => setShowArchived((v) => !v)} onRestore={(r) => setStatus(r, "paused")} onDelete={(r) => setConfirm({ kind: "delete", routine: r })} />}
      {confirm && <Confirm confirm={confirm} busy={busy} onCancel={() => setConfirm(null)} onConfirm={doConfirm} />}
    </div>
  );
}

function Confirm({ confirm, busy, onCancel, onConfirm }: { confirm: { kind: "delete" | "archive"; routine: Routine }; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return confirm.kind === "delete" ? (
    <ConfirmDialog title={`Excluir “${confirm.routine.name}”?`} confirmLabel="Excluir rotina" danger busy={busy} onCancel={onCancel} onConfirm={onConfirm}>
      <p>A rotina deixa de existir e sai dos próximos dias em que ainda não foi tocada.</p>
      <p className="muted">Os dias passados e o tempo registrado continuam no histórico. Se quiser só tirá-la de vista, arquive.</p>
    </ConfirmDialog>
  ) : (
    <ConfirmDialog title={`Arquivar “${confirm.routine.name}”?`} confirmLabel="Arquivar" busy={busy} onCancel={onCancel} onConfirm={onConfirm}>
      <p>Ela sai das rotinas ativas e dos próximos dias ainda não iniciados. O histórico fica, e você pode restaurá-la depois.</p>
    </ConfirmDialog>
  );
}

function Archived({ list, open, toggle, onRestore, onDelete }: { list: Routine[]; open: boolean; toggle: () => void; onRestore: (r: Routine) => void; onDelete: (r: Routine) => void }) {
  return (
    <section className="rt-routine-section" aria-labelledby="rt-archived">
      <h2 id="rt-archived" className="rt-section-title">
        <button type="button" className="rt-disclosure" aria-expanded={open} onClick={toggle}>
          <Icon name="down" size={16} />
          Arquivadas ({list.length})
        </button>
      </h2>
      {open && (
        <ul className="rt-archived">
          {list.map((r) => (
            <li key={r.id} className="surface">
              <IconTile icon={r.icon_key} color={r.color} label={r.name} size={32} />
              <span className="rt-archived-name">
                {r.name}
                <small>{r.activities.length} {r.activities.length === 1 ? "atividade" : "atividades"}</small>
              </span>
              <button type="button" className="button button-sm button-soft" onClick={() => onRestore(r)}>
                <Icon name="rotate" size={14} />
                Restaurar
              </button>
              <button type="button" className="icon-button icon-button-sm" aria-label={`Excluir ${r.name}`} onClick={() => onDelete(r)}>
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RoutineCard({ routine: r, onApply, onToggle, onArchive, onDelete }: { routine: Routine; onApply: () => void; onToggle: () => void; onArchive: () => void; onDelete: () => void }) {
  const paused = r.status === "paused";
  return (
    <li className={`rt-routine surface ${paused ? "is-paused" : ""}`} style={tone(r.color)}>
      <Link to={paths.routine(`rotinas/${r.id}`)} className="rt-routine-main" aria-label={`Editar ${r.name}`}>
        <IconTile icon={r.icon_key} color={r.color} label={r.name} size={44} />
        <span className="rt-routine-text">
          <strong>{r.name}</strong>
          <small>
            {MODE_LABEL[r.mode]}
            {r.window ? ` · ${r.window.start}${r.window.end ? `–${r.window.end}` : ""}` : ""}
          </small>
        </span>
      </Link>
      {r.description && <p className="rt-routine-desc">{r.description}</p>}
      <ol className="rt-routine-acts" aria-label="Atividades">
        {r.activities.slice(0, 4).map((a) => (
          <li key={a.id}>
            <span className="tabular">{a.start_time ?? ""}</span>
            {a.title}
          </li>
        ))}
        {r.activities.length > 4 && <li className="rt-muted">e mais {r.activities.length - 4}</li>}
        {!r.activities.length && <li className="rt-muted">Sem atividades ainda</li>}
      </ol>
      <div className="rt-routine-foot">
        <span className="rt-days" aria-label={r.weekdays.length ? `Dias: ${r.weekdays.map((d) => WEEKDAY_LONG[d]).join(", ")}` : "Sem dias fixos"}>
          {WEEKDAY_INITIAL.map((d, i) => (
            <i key={i} className={r.weekdays.includes(i) ? "is-on" : ""} aria-hidden="true">
              {d}
            </i>
          ))}
        </span>
        <span className="rt-routine-total tabular">{r.estimated_minutes ? minutesLabel(r.estimated_minutes) : ""}</span>
      </div>
      <div className="rt-routine-actions">
        {paused && <span className="rt-state">Pausada</span>}
        <button type="button" className="button button-sm button-soft" onClick={onApply}>
          Aplicar a hoje
        </button>
        <Menu
          label={`Mais ações para ${r.name}`}
          actions={[
            { label: "Editar", icon: "edit", onSelect: () => navigate(paths.routine(`rotinas/${r.id}`)) },
            { label: paused ? "Ativar" : "Pausar", icon: paused ? "play" : "pause", onSelect: onToggle },
            { label: "Arquivar", icon: "archive", onSelect: onArchive },
            { label: "Excluir", icon: "trash", onSelect: onDelete, danger: true, separatorBefore: true },
          ]}
        />
      </div>
    </li>
  );
}
