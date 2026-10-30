import { KeyboardEvent, useEffect, useState } from "react";
import { formatTime } from "../format";
import { SaveStatus, useNoteAutosave } from "../hooks/useNoteAutosave";
import { Note } from "../learning/api";
import Icon from "./Icon";

const STATUS: Record<SaveStatus, string> = {
  saved: "Salvo",
  dirty: "Alterações não salvas",
  saving: "Salvando…",
  error: "Falha ao salvar",
  conflict: "Conflito",
};

const MOBILE = "(max-width: 1023px)";

export default function NotesPanel({ courseId, lessonKey, initial }: { courseId: string; lessonKey: string; initial: Note }) {
  const { body, change, status, savedAt, conflict, saveNow, resolveConflict } = useNoteAutosave(courseId, lessonKey, initial);
  // No celular o painel começa recolhido para o vídeo e os controles ficarem à vista.
  const [collapsed, setCollapsed] = useState(() => window.matchMedia(MOBILE).matches && !initial.body);

  useEffect(() => {
    if (status === "conflict") setCollapsed(false);
  }, [status]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveNow();
    }
  }

  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  return (
    <aside className={`notes ${collapsed ? "is-collapsed" : ""}`} aria-label="Anotações da aula">
      <header className="notes-head">
        <button className="notes-toggle" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
          <Icon name="notes" size={17} />
          <span>Minhas anotações</span>
          <Icon name="chevron" size={16} className="notes-chevron" />
        </button>
        <span className={`save-status save-${status}`} role="status" aria-live="polite">
          <span className="save-dot" />
          {STATUS[status]}
        </span>
      </header>

      {!collapsed && (
        <>
          {conflict && (
            <div className="notes-conflict" role="alert">
              <p>
                <strong>Esta anotação foi alterada em outra aba ou dispositivo</strong>
                {conflict.updated_at && ` às ${formatTime(conflict.updated_at)}`}. Qual versão você quer manter?
              </p>
              <details>
                <summary>Ver a versão salva</summary>
                <pre>{conflict.body || "(vazia)"}</pre>
              </details>
              <div className="notes-conflict-actions">
                <button className="button button-sm button-primary" onClick={() => resolveConflict("mine")}>
                  Manter a que está aqui
                </button>
                <button className="button button-sm" onClick={() => resolveConflict("theirs")}>
                  Usar a versão salva
                </button>
              </div>
            </div>
          )}
          <textarea
            className="notes-editor"
            value={body}
            onChange={(e) => change(e.target.value)}
            onBlur={() => status === "dirty" && void saveNow()}
            onKeyDown={onKeyDown}
            placeholder="Escreva suas observações sobre esta aula. Tudo é salvo automaticamente."
            spellCheck
          />
          <footer className="notes-foot">
            <span>{words ? `${words} ${words === 1 ? "palavra" : "palavras"}` : "Sem anotações"}</span>
            {status === "error" ? (
              <button className="link-button" onClick={() => void saveNow()}>
                Tentar de novo
              </button>
            ) : (
              savedAt && status === "saved" && <span>Salvo às {formatTime(savedAt)}</span>
            )}
          </footer>
        </>
      )}
    </aside>
  );
}
