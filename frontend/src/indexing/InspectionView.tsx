import { useEffect, useMemo, useState } from "react";
import { ApiError, IndexResult, SnapshotInfo } from "../api";
import CourseCover from "../components/CourseCover";
import Icon from "../components/Icon";
import { plural } from "../format";
import { collectedAt } from "./ImportView";
import { useResource } from "../hooks/useResource";
import { Link, paths } from "../router";
import { dismissFresh, loadIndex, useFreshCourse } from "./collectStore";
import { ModuleCard } from "./CourseTree";
import { countLessons, countUnresolved } from "./model";
import ReportPanel from "./ReportPanel";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

interface Props {
  name: string;
  snapshots: SnapshotInfo[] | undefined;
  onBack: () => void;
}

export default function InspectionView({ name, snapshots, onBack }: Props) {
  const { data, error, loading, reload } = useResource(`index:${name}`, () => loadIndex(name));
  const snapshot = snapshots?.find((s) => s.name === name);

  if (error) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <>
        <Breadcrumb title={snapshot?.title ?? name} />
        <div className="empty">
          <span className="empty-icon">
            <Icon name="warningCircle" size={26} />
          </span>
          <h2>{missing ? "Importação não encontrada" : "Não foi possível montar a estrutura"}</h2>
          <p>{missing ? "Este canal não está mais entre as suas importações." : error.message}</p>
          <div className="ix-empty-actions">
            {!missing && (
              <button type="button" className="button button-primary" onClick={reload}>
                <Icon name="refresh" size={16} />
                Tentar de novo
              </button>
            )}
            <button type="button" className="button" onClick={onBack}>
              Voltar para Adicionar curso
            </button>
          </div>
        </div>
      </>
    );
  }

  if (loading || !data || data.name !== name) return <InspectionSkeleton title={snapshot?.title ?? null} />;
  return <Inspection result={data} snapshot={snapshot} onBack={onBack} />;
}

function Breadcrumb({ title }: { title: string | null }) {
  return (
    <nav className="breadcrumb" aria-label="Você está em">
      <Link to={paths.indexing()}>Adicionar curso</Link>
      {title && (
        <>
          <Icon name="chevron" size={12} />
          <span className="breadcrumb-part" aria-current="page">
            {title}
          </span>
        </>
      )}
    </nav>
  );
}

function InspectionSkeleton({ title }: { title: string | null }) {
  return (
    <div aria-busy="true" aria-label="Montando a estrutura do curso">
      <Breadcrumb title={title} />
      <div className="surface ix-course skeleton" style={{ minHeight: 132 }} />
      <div className="ix-workspace">
        <div className="surface ix-modules skeleton" style={{ minHeight: 280 }} />
        <div className="ix-preview">
          {[0, 1, 2].map((i) => (
            <div key={i} className="ix-module skeleton" style={{ height: 68 }} />
          ))}
        </div>
        <div className="surface ix-report skeleton" style={{ minHeight: 360 }} />
      </div>
    </div>
  );
}

function Inspection({ result, snapshot, onBack }: { result: IndexResult; snapshot?: SnapshotInfo; onBack: () => void }) {
  const { course, report, name } = result;
  const sections = course.sections;
  const lessons = useMemo(() => sections.reduce((n, s) => n + countLessons(s), 0), [sections]);
  const freshName = useFreshCourse();
  const fresh = freshName === name;
  // O aviso de "curso adicionado" some ao abrir outra importação.
  useEffect(() => {
    if (freshName && freshName !== name) dismissFresh();
  }, [freshName, name]);
  const messages = report.stats.messages ?? snapshot?.messages;

  // Módulo escolhido na navegação (null = todos) e módulos abertos na prévia.
  const [selected, setSelected] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<number>>(() => new Set(sections.map((_, i) => i)));
  useEffect(() => {
    setSelected(null);
    setOpen(new Set(sections.map((_, i) => i)));
  }, [sections]);


  const visible = selected === null ? sections.map((s, i) => [s, i] as const) : [[sections[selected], selected] as const];
  const allOpen = visible.every(([, i]) => open.has(i));
  const toggle = (i: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const toggleAll = () =>
    setOpen((current) => {
      const next = new Set(current);
      for (const [, i] of visible) {
        if (allOpen) next.delete(i);
        else next.add(i);
      }
      return next;
    });
  const select = (i: number | null) => {
    setSelected(i);
    if (i !== null) setOpen((current) => new Set(current).add(i));
  };

  return (
    <>
      <Breadcrumb title={course.title} />

      {fresh && (
        <div className="ix-success" role="status">
          <span className="ix-success-icon" aria-hidden="true">
            <Icon name="checkCircle" weight="fill" size={22} />
          </span>
          <div>
            <strong>Curso adicionado à sua biblioteca</strong>
            <span>Confira abaixo como os módulos e aulas foram organizados.</span>
          </div>
          <button type="button" className="icon-button icon-button-sm" aria-label="Fechar aviso" onClick={dismissFresh}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      <header className="surface ix-card ix-course">
        <CourseCover id={name} className="ix-course-cover" />
        <div className="ix-course-text">
          <p className="eyebrow">Prévia da importação</p>
          <h1>{course.title}</h1>
          <p className="ix-course-meta">
            <span>
              <Icon name="layers" size={16} />
              {plural(sections.length, "módulo", "módulos")}
            </span>
            <span>
              <Icon name="play" size={14} />
              {plural(lessons, "aula", "aulas")}
            </span>
            {messages != null && (
              <span>
                <Icon name="message" size={16} />
                {plural(messages, "mensagem", "mensagens")}
              </span>
            )}
            {snapshot && (
              <span>
                <Icon name="history" size={16} />
                {capitalize(collectedAt(snapshot.modified_at))}
              </span>
            )}
            {course.strategy === "summary" ? (
              <span className="badge badge-brand" data-tip="Módulos e aulas seguem o sumário publicado no canal">
                Pelo sumário do canal
              </span>
            ) : (
              <span className="badge badge-warning" data-tip="O canal não tem um sumário reconhecível">
                Ordem cronológica
              </span>
            )}
          </p>
        </div>
        <div className="ix-course-actions">
          <Link className="button button-primary" to={paths.course(name)}>
            <Icon name="play" size={14} />
            Abrir curso
          </Link>
          <button type="button" className="button" onClick={onBack}>
            <Icon name="plus" size={16} />
            Importar outro
          </button>
        </div>
      </header>

      <div className="ix-workspace">
        <nav className="surface ix-modules" aria-label="Módulos do curso">
          <h2 className="ix-modules-title">Módulos</h2>
          <ul>
            <li>
              <button
                type="button"
                className="ix-module-link"
                aria-current={selected === null ? "true" : undefined}
                onClick={() => select(null)}
              >
                <span className="ix-module-link-title">Todos os módulos</span>
                <span className="ix-module-link-count tabular">{lessons}</span>
              </button>
            </li>
            {sections.map((section, i) => {
              const pending = countUnresolved(section);
              return (
                <li key={i}>
                  <button
                    type="button"
                    className="ix-module-link"
                    aria-current={selected === i ? "true" : undefined}
                    onClick={() => select(i)}
                    title={section.title}
                  >
                    <span className="ix-module-link-title">{section.title}</span>
                    {pending > 0 && (
                      <span className="ix-module-link-alert" data-tip={plural(pending, "aula não resolvida", "aulas não resolvidas")}>
                        <Icon name="warningCircle" weight="fill" size={14} />
                        <span className="sr-only">{plural(pending, "aula não resolvida", "aulas não resolvidas")}</span>
                      </span>
                    )}
                    <span className="ix-module-link-count tabular">{countLessons(section)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="ix-preview" aria-labelledby="ix-preview-title">
          <div className="ix-preview-head">
            <h2 id="ix-preview-title">{selected === null ? "Estrutura do curso" : sections[selected].title}</h2>
            {visible.length > 0 && (
              <button type="button" className="link-button ix-toggle-all" onClick={toggleAll}>
                {allOpen ? "Recolher tudo" : "Expandir tudo"}
              </button>
            )}
          </div>
          {sections.length === 0 ? (
            <div className="empty empty-compact">
              <span className="empty-icon">
                <Icon name="structure" size={24} />
              </span>
              <h2>Nenhuma aula identificada</h2>
              <p>O canal não tem mensagens que formem aulas. Confira o painel de inspeção para entender o que foi coletado.</p>
            </div>
          ) : (
            <div className="ix-module-list">
              {visible.map(([section, i]) => (
                <ModuleCard key={i} section={section} index={i} open={open.has(i)} onToggle={() => toggle(i)} />
              ))}
            </div>
          )}
        </section>

        <ReportPanel report={report} />
      </div>
    </>
  );
}
