// Prévia da estrutura extraída: módulos, subtópicos e aulas, com os materiais
// de cada aula sob demanda (só a aula aberta mostra os detalhes).
import { memo, useState } from "react";
import { Lesson, Material, Section } from "../api";
import Icon from "../components/Icon";
import RichText from "../components/RichText";
import { formatClock, formatSize, plural } from "../format";
import {
  countLessons,
  countSubtopics,
  countUnresolved,
  formatLocation,
  KIND_ICON,
  KIND_LABEL,
  lessonKind,
  MEDIA_LABEL,
  materialIcon,
  REASON_LABEL,
  TITLE_SOURCE_LABEL,
} from "./model";

const pad = (n: number) => String(n).padStart(2, "0");

function MaterialRow({ material }: { material: Material }) {
  const media = material.media;
  const name = media?.file_name || (media ? MEDIA_LABEL[media.kind] ?? "Mídia" : "Mensagem de texto");
  const details = [
    media?.size ? formatSize(media.size) : null,
    media?.duration ? formatClock(media.duration) : null,
    `mensagem ${material.message_id}`,
  ].filter(Boolean);
  return (
    <li className="ix-material">
      <span className="ix-material-icon" aria-hidden="true">
        <Icon name={materialIcon(material)} size={16} />
      </span>
      <span className="ix-material-text">
        <span className="ix-material-name">{name}</span>
        <span className="ix-material-meta">{details.join(" · ")}</span>
      </span>
      <span className="ix-reason" title="Como a mensagem foi associada à aula">
        {REASON_LABEL[material.reason]}
        {material.via ? ` · via ${material.via}` : ""}
      </span>
    </li>
  );
}

const LessonItem = memo(function LessonItem({ lesson }: { lesson: Lesson }) {
  const [open, setOpen] = useState(false);
  const kind = lessonKind(lesson);
  const location = formatLocation(lesson.summary_location);
  const bodyId = `ix-lesson-${lesson.position}`;
  return (
    <li className={`ix-lesson ${lesson.resolved ? "" : "is-unresolved"} ${open ? "is-open" : ""}`}>
      <button type="button" className="ix-lesson-row" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        <span className="ix-lesson-pos tabular">{lesson.position}</span>
        <span className={`ix-kind is-${kind}`} data-tip={KIND_LABEL[kind]} aria-label={KIND_LABEL[kind]}>
          <Icon name={KIND_ICON[kind]} size={16} />
        </span>
        <span className="ix-lesson-text">
          <span className="ix-lesson-title">{lesson.title}</span>
          <span className="ix-lesson-meta">
            {lesson.ref && <code className="ix-ref">#{lesson.ref_raw ?? lesson.ref}</code>}
            {lesson.materials.length > 0 && <span>{plural(lesson.materials.length, "material", "materiais")}</span>}
          </span>
        </span>
        {!lesson.resolved && <span className="badge badge-warning">Não resolvida</span>}
        <Icon name="down" size={16} className="ix-lesson-chevron" />
      </button>
      {open && (
        <div className="ix-lesson-body" id={bodyId}>
          <dl className="ix-facts">
            <div>
              <dt>Título</dt>
              <dd>{TITLE_SOURCE_LABEL[lesson.title_source] ?? lesson.title_source}</dd>
            </div>
            {location && (
              <div>
                <dt>No sumário</dt>
                <dd>{location}</dd>
              </div>
            )}
          </dl>
          {lesson.description && <RichText text={lesson.description} />}
          {lesson.materials.length > 0 ? (
            <ul className="ix-materials">
              {lesson.materials.map((m) => (
                <MaterialRow key={m.message_id} material={m} />
              ))}
            </ul>
          ) : (
            <p className="ix-lesson-empty">
              <Icon name="info" size={16} />
              Nenhuma mensagem do canal contém este identificador.
            </p>
          )}
        </div>
      )}
    </li>
  );
});

function SectionContent({ section }: { section: Section }) {
  return (
    <>
      {section.lessons.length > 0 && (
        <ul className="ix-lessons">
          {section.lessons.map((lesson) => (
            <LessonItem key={lesson.position} lesson={lesson} />
          ))}
        </ul>
      )}
      {section.children.map((child, i) => (
        <div key={i} className="ix-subtopic">
          <div className="ix-subtopic-title">
            <span>{child.title}</span>
            <span className="ix-subtopic-count">{plural(countLessons(child), "aula", "aulas")}</span>
          </div>
          <SectionContent section={child} />
        </div>
      ))}
      {section.lessons.length === 0 && section.children.length === 0 && (
        <p className="ix-lesson-empty">
          <Icon name="info" size={16} />
          Nenhuma aula neste módulo.
        </p>
      )}
    </>
  );
}

export function ModuleCard({
  section,
  index,
  open,
  onToggle,
}: {
  section: Section;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const lessons = countLessons(section);
  const subtopics = countSubtopics(section);
  const unresolved = countUnresolved(section);
  const bodyId = `ix-module-${index}`;
  return (
    <section className={`ix-module ${open ? "is-open" : ""}`}>
      <button type="button" className="ix-module-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="ix-module-index tabular">{pad(index + 1)}</span>
        <span className="ix-module-title">
          <strong>{section.title}</strong>
          <span>
            {plural(lessons, "aula", "aulas")}
            {subtopics > 0 && ` · ${plural(subtopics, "subtópico", "subtópicos")}`}
          </span>
        </span>
        <span className="ix-module-badges">
          {section.implicit && (
            <span className="badge" data-tip="Agrupa aulas que aparecem no sumário antes do primeiro módulo">
              Implícito
            </span>
          )}
          {unresolved > 0 && <span className="badge badge-warning">{plural(unresolved, "pendência", "pendências")}</span>}
        </span>
        <Icon name="chevron" size={18} className="ix-module-chevron" />
      </button>
      {open && (
        <div className="ix-module-body" id={bodyId}>
          <SectionContent section={section} />
        </div>
      )}
    </section>
  );
}
