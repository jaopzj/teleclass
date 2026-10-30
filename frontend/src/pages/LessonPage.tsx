import { useCallback, useEffect, useState } from "react";
import Icon from "../components/Icon";
import NotesPanel from "../components/NotesPanel";
import RichText from "../components/RichText";
import Player from "../player/Player";
import { formatSize } from "../format";
import { useResource } from "../hooks/useResource";
import { learningApi, LessonDetail, LessonProgress, mediaUrl, thumbUrl } from "../learning/api";
import { Link, paths } from "../router";
import { api } from "../api";

// Consultado uma vez por sessão: sem o cryptg, o download do Telegram fica muito lento.
let slowCryptoCheck: Promise<boolean> | null = null;
function useSlowCrypto() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    slowCryptoCheck ??= api
      .status()
      .then((s) => s.linked && s.fast_crypto === false)
      .catch(() => false);
    slowCryptoCheck.then(setSlow);
  }, []);
  return slow;
}

export default function LessonPage({ courseId, lessonKey }: { courseId: string; lessonKey: string }) {
  const { data, error, loading } = useResource(`lesson:${courseId}:${lessonKey}`, () =>
    learningApi.lesson(courseId, lessonKey),
  );

  if (error && !loading) {
    return (
      <div className="page page-narrow">
        <div className="alert alert-error">
          {error.message === "Aula não encontrada" ? "Esta aula não existe mais neste curso." : `Erro ao carregar a aula: ${error.message}`}
        </div>
        <Link to={paths.course(courseId)} className="button">
          <Icon name="back" size={16} /> Voltar ao curso
        </Link>
      </div>
    );
  }
  if (!data || data.course.id !== courseId) return <LessonSkeleton />;
  // A chave remonta player e anotações a cada aula: cada uma tem seu próprio estado.
  return <LessonView key={data.lesson.key} detail={data} switching={loading} />;
}

function LessonSkeleton() {
  return (
    <div className="page page-wide">
      <div className="lesson-layout">
        <div className="lesson-main">
          <div className="pp skeleton" style={{ aspectRatio: "16 / 9" }} />
        </div>
        <div className="notes skeleton" />
      </div>
    </div>
  );
}

function LessonView({ detail, switching }: { detail: LessonDetail; switching: boolean }) {
  const { course, lesson, previous, next } = detail;
  const [progress, setProgress] = useState<LessonProgress | null>(lesson.progress);
  const [completing, setCompleting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const completed = !!progress?.completed;
  const video = lesson.video;
  const slowCrypto = useSlowCrypto();

  const savePosition = useCallback(
    (position: number, duration: number | null, keepalive: boolean) => {
      learningApi
        .savePosition(course.id, lesson.key, position, duration, keepalive)
        .then((p) => !keepalive && setProgress(p))
        .catch(() => {
          /* a próxima gravação periódica tenta de novo */
        });
    },
    [course.id, lesson.key],
  );

  // Aulas sem vídeo contam como "acessadas" ao abrir, para a retomada do curso.
  useEffect(() => {
    if (!video && lesson.kind !== "unavailable") savePosition(0, null, false);
  }, [video, lesson.kind, savePosition]);

  async function toggleCompleted() {
    const target = !completed;
    setCompleting(true);
    setProgress((p) => ({ ...(p ?? emptyProgress), completed: target }));
    try {
      const result = await learningApi.setCompleted(course.id, lesson.key, target);
      setProgress(result.progress);
      setNotice(target ? `Aula concluída · ${result.course.completed} de ${result.course.total} no curso` : undefined);
    } catch (e) {
      setProgress((p) => ({ ...(p ?? emptyProgress), completed: !target }));
      setNotice(`Não foi possível atualizar: ${(e as Error).message}`);
    } finally {
      setCompleting(false);
    }
  }

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(undefined), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  return (
    <div className={`page page-wide lesson-page ${switching ? "is-switching" : ""}`}>
      <nav className="breadcrumb" aria-label="Você está em">
        <Link to={paths.library()}>Meus cursos</Link>
        <span>›</span>
        <Link to={paths.course(course.id)}>{course.title}</Link>
        {lesson.path.map((part, i) => (
          <span key={i} className="breadcrumb-part">
            <span>›</span> {part}
          </span>
        ))}
      </nav>

      <div className="lesson-layout">
        <div className="lesson-main">
          {video && slowCrypto && (
            <div className="alert alert-warning">
              O vídeo vai carregar devagar: falta o pacote <code>cryptg</code>, que acelera a criptografia do
              Telegram. Rode <code>pip install -e .</code> na pasta do projeto e reinicie o servidor.
            </div>
          )}
          {video ? (
            <Player
              title={lesson.title}
              next={
                next
                  ? {
                      title: next.title,
                      href: paths.lesson(course.id, next.key),
                      // Terminou o vídeo e seguiu: conta como concluída.
                      beforeNavigate: completed ? undefined : () => learningApi.setCompleted(course.id, lesson.key, true),
                    }
                  : undefined
              }
              src={mediaUrl(course.id, video.message_id)}
              poster={thumbUrl(course.id, video.message_id)}
              mimeType={video.mime_type}
              width={video.width}
              height={video.height}
              initialPosition={lesson.progress?.position_seconds ?? 0}
              onSavePosition={savePosition}
            />
          ) : (
            <NoVideo detail={detail} />
          )}

          <div className="lesson-controls">
            {previous ? (
              <Link to={paths.lesson(course.id, previous.key)} className="nav-button nav-prev" title={previous.title}>
                <Icon name="left" size={18} />
                <span>
                  <small>Aula anterior</small>
                  <span className="nav-title">{previous.title}</span>
                </span>
              </Link>
            ) : (
              <span className="nav-button nav-prev is-disabled">
                <Icon name="left" size={18} />
                <span>
                  <small>Aula anterior</small>
                  <span className="nav-title">Esta é a primeira aula</span>
                </span>
              </span>
            )}

            <button
              className={`button complete-button ${completed ? "is-done" : ""}`}
              onClick={toggleCompleted}
              disabled={completing}
              aria-pressed={completed}
            >
              <span className="complete-check">
                <Icon name="check" size={14} />
              </span>
              {completed ? "Concluída" : "Marcar como concluída"}
            </button>

            {next ? (
              <Link to={paths.lesson(course.id, next.key)} className="nav-button nav-next" title={next.title}>
                <span>
                  <small>Próxima aula</small>
                  <span className="nav-title">{next.title}</span>
                </span>
                <Icon name="right" size={18} />
              </Link>
            ) : (
              <Link to={paths.course(course.id)} className="nav-button nav-next">
                <span>
                  <small>Fim do curso</small>
                  <span className="nav-title">Voltar ao conteúdo</span>
                </span>
                <Icon name="right" size={18} />
              </Link>
            )}
          </div>
          {notice && (
            <p className="lesson-notice" role="status">
              {notice}
            </p>
          )}

          <header className="lesson-info">
            <p className="eyebrow">
              Aula {lesson.number} de {course.total}
              {lesson.path.length > 0 && ` · ${lesson.path[lesson.path.length - 1]}`}
            </p>
            <h1>{lesson.title}</h1>
          </header>
          {lesson.description && <RichText text={lesson.description} />}
        </div>

        <NotesPanel courseId={course.id} lessonKey={lesson.key} initial={detail.note} />
      </div>
    </div>
  );
}

const emptyProgress: LessonProgress = {
  position_seconds: 0,
  duration_seconds: null,
  completed: false,
  completed_at: null,
  last_watched_at: null,
};

function NoVideo({ detail }: { detail: LessonDetail }) {
  const { lesson, course } = detail;
  const unavailable = lesson.kind === "unavailable";
  return (
    <div className="no-video">
      <Icon name={unavailable ? "alert" : "file"} size={32} />
      <h2>{unavailable ? "Aula indisponível" : "Esta aula não tem vídeo"}</h2>
      <p className="muted">
        {unavailable
          ? "O sumário cita esta aula, mas nenhuma mensagem do canal foi encontrada para ela."
          : "O conteúdo desta aula está nos arquivos abaixo."}
      </p>
      {lesson.materials.length > 0 && (
        <ul className="file-list">
          {lesson.materials.map((m) => (
            <li key={m.message_id}>
              <Icon name="file" size={16} />
              <span className="file-name">{m.file_name ?? `Arquivo da mensagem ${m.message_id}`}</span>
              <span className="muted small">{formatSize(m.size)}</span>
              <a className="button button-sm" href={`${mediaUrl(course.id, m.message_id)}?download=true`} download>
                <Icon name="download" size={14} /> Baixar
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
