import { useState } from "react";
import { formatClock } from "../format";
import { LessonSummary, thumbUrl } from "../learning/api";
import Icon, { IconName } from "./Icon";

const KIND_ICON: Record<LessonSummary["kind"], IconName> = {
  video: "play",
  file: "file",
  text: "text",
  unavailable: "alert",
};

/** Miniatura do vídeo (vem do Telegram, sob demanda) com duração e quanto já foi assistido. */
export default function LessonThumb({
  courseId,
  lesson,
  watched,
}: {
  courseId: string;
  lesson: LessonSummary;
  watched: number;
}) {
  const [failed, setFailed] = useState(false);
  const video = lesson.video;
  return (
    <div className={`thumb thumb-${lesson.kind}`}>
      {video && !failed ? (
        <img src={thumbUrl(courseId, video.message_id)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : null}
      <span className="thumb-icon">
        <Icon name={KIND_ICON[lesson.kind]} size={lesson.kind === "video" ? 16 : 18} />
      </span>
      {lesson.duration ? <span className="thumb-duration">{formatClock(lesson.duration)}</span> : null}
      {watched > 0 && watched < 100 ? (
        <span className="thumb-watched">
          <span style={{ width: `${watched}%` }} />
        </span>
      ) : null}
    </div>
  );
}
