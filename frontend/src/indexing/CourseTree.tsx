import { Lesson, Material, Section } from "../api";

const REASONS: Record<Material["reason"], string> = {
  tag: "identificador na legenda",
  album: "mesmo álbum",
  chronological: "ordem cronológica",
};

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function MaterialRow({ material }: { material: Material }) {
  const media = material.media;
  return (
    <li>
      <code>msg {material.message_id}</code> {media ? media.kind : "texto"}{" "}
      {media?.file_name && <span>{media.file_name}</span>} <span className="muted">{formatSize(media?.size ?? null)}</span>{" "}
      <span className="tag">
        {REASONS[material.reason]}
        {material.via ? ` (via msg ${material.via})` : ""}
        {material.grouped_id ? ` · álbum ${material.grouped_id}` : ""}
      </span>
    </li>
  );
}

function LessonRow({ lesson }: { lesson: Lesson }) {
  return (
    <li className={lesson.resolved ? "lesson" : "lesson unresolved"}>
      <details>
        <summary>
          <span className="pos">{lesson.position}.</span>
          {lesson.ref && <span className="ref">#{lesson.ref_raw ?? lesson.ref}</span>}
          <span>{lesson.title}</span>
          {!lesson.resolved && <span className="badge">não resolvida</span>}
          <span className="muted small"> título: {lesson.title_source}</span>
        </summary>
        <div className="lesson-body">
          {lesson.summary_location && <p className="muted small">No sumário em {lesson.summary_location} (mensagem:linha)</p>}
          {lesson.description && <pre className="description">{lesson.description}</pre>}
          {lesson.materials.length > 0 ? (
            <ul className="materials">
              {lesson.materials.map((m) => (
                <MaterialRow key={m.message_id} material={m} />
              ))}
            </ul>
          ) : (
            <p className="muted small">Nenhuma mensagem do canal contém este identificador.</p>
          )}
        </div>
      </details>
    </li>
  );
}

export default function CourseTree({ sections }: { sections: Section[] }) {
  return (
    <ul className="tree">
      {sections.map((section, i) => (
        <li key={i} className={`section level-${section.level}`}>
          <div className="tree-section-title">
            {section.title}
            {section.implicit && <span className="badge">implícita</span>}
          </div>
          {section.lessons.length > 0 && (
            <ul className="lessons">
              {section.lessons.map((lesson) => (
                <LessonRow key={lesson.position} lesson={lesson} />
              ))}
            </ul>
          )}
          {section.children.length > 0 && <CourseTree sections={section.children} />}
        </li>
      ))}
    </ul>
  );
}
