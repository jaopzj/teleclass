import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon, { IconName } from "../components/Icon";
import RichText from "../components/RichText";
import Player from "../player/Player";
import { formatClock, formatSize } from "../format";
import { useResource } from "../hooks/useResource";
import { CourseDetail, learningApi, LessonDetail, LessonProgress, MaterialInfo, mediaUrl, thumbUrl } from "../learning/api";
import { Link, paths, useSearchParam } from "../router";
import { getPlayer } from "../player/controller";
import { api } from "../api";
import { useAuth } from "../auth/AuthProvider";
import QuickStart from "../focus/QuickStart";
import { notify } from "../notifications/center";
import LessonPanel from "../lesson/LessonPanel";
import "../lesson/lesson.css";

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

const THEATER_KEY = "teleclass:lesson-theater";
function loadTheater() {
  try {
    return localStorage.getItem(THEATER_KEY) === "1";
  } catch {
    return false;
  }
}

export default function LessonPage({ courseId, lessonKey }: { courseId: string; lessonKey: string }) {
  const { data, error, loading } = useResource(`lesson:${courseId}:${lessonKey}`, () =>
    learningApi.lesson(courseId, lessonKey),
  );
  // O sumário do curso fica carregado entre uma aula e outra; é relido ao trocar de aula
  // (a anterior pode ter avançado ou sido concluída) e depois de marcar uma conclusão.
  const outline = useResource(`course:${courseId}`, () => learningApi.course(courseId));
  const reloadOutline = outline.reload;
  const firstLesson = useRef(lessonKey);
  useEffect(() => {
    if (firstLesson.current === lessonKey) return;
    firstLesson.current = "";
    reloadOutline();
  }, [lessonKey, reloadOutline]);

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
  const course = outline.data?.id === courseId ? outline.data : null;
  // A chave remonta player e anotações a cada aula: cada uma tem seu próprio estado.
  return <LessonView key={data.lesson.key} detail={data} course={course} onCompletionChange={reloadOutline} switching={loading} />;
}

function LessonSkeleton() {
  return (
    <div className="page page-wide lv">
      <div className="lv-grid">
        <div className="lv-top">
          <span className="skeleton lv-skel-line" />
        </div>
        <div className="lv-stage">
          <div className="lv-skel-stage skeleton" />
        </div>
        <div className="lv-info lv-skel-info">
          <span className="skeleton lv-skel-line" />
          <span className="skeleton lv-skel-title" />
        </div>
        <div className="lv-panel lv-skel-panel skeleton" />
      </div>
    </div>
  );
}

function LessonView({
  detail,
  course: outline,
  onCompletionChange,
  switching,
}: {
  detail: LessonDetail;
  course: CourseDetail | null;
  onCompletionChange: () => void;
  switching: boolean;
}) {
  const { course, lesson, previous, next } = detail;
  const [progress, setProgress] = useState<LessonProgress | null>(lesson.progress);
  const [completing, setCompleting] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [theater, setTheater] = useState(loadTheater);
  const completed = !!progress?.completed;
  const video = lesson.video;
  const slowCrypto = useSlowCrypto();
  const { state: auth } = useAuth();
  const userId = auth.status === "authenticated" ? auth.user.id : null;
  const study = useMemo(
    () => (userId ? { userId, courseId: course.id, lessonKey: lesson.key } : undefined),
    [userId, course.id, lesson.key],
  );
  const playerLesson = useMemo(() => ({ courseId: course.id, lessonKey: lesson.key }), [course.id, lesson.key]);
  // `?t=194`: veio de uma anotação. Ao abrir, o player começa ali; com a aula já aberta, só salta.
  const t = useSearchParam("t");
  const [startAt] = useState(() => (t && /^\d+$/.test(t) ? Number(t) : null));
  useEffect(() => {
    if (!t || !/^\d+$/.test(t)) return;
    getPlayer(course.id, lesson.key)?.seek(Number(t), { play: true });
  }, [t, course.id, lesson.key]);

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
    setJustCompleted(target);
    setProgress((p) => ({ ...(p ?? emptyProgress), completed: target }));
    try {
      const result = await learningApi.setCompleted(course.id, lesson.key, target);
      setProgress(result.progress);
      onCompletionChange();
    } catch (e) {
      setJustCompleted(false);
      setProgress((p) => ({ ...(p ?? emptyProgress), completed: !target }));
      notify({ title: "Não foi possível atualizar a aula", body: (e as Error).message, tone: "neutral", essential: true });
    } finally {
      setCompleting(false);
    }
  }

  const toggleTheater = useCallback(() => {
    setTheater((value) => {
      try {
        localStorage.setItem(THEATER_KEY, value ? "0" : "1");
      } catch {
        /* só uma preferência */
      }
      return !value;
    });
  }, []);

  const module = lesson.path[lesson.path.length - 1];
  const materials = video ? lesson.materials : []; // sem vídeo, os arquivos já aparecem no lugar do player
  const hasBody = !!lesson.description || materials.length > 0;

  return (
    <div className={`page page-wide lv ${theater ? "is-theater" : ""} ${switching ? "is-switching" : ""}`}>
      <div className="lv-grid">
        <nav className="lv-top" aria-label="Você está em">
          <Link to={paths.course(course.id)} className="lv-back">
            <Icon name="left" size={16} />
            <span>{course.title}</span>
          </Link>
        </nav>

        <div className="lv-stage">
          {video && slowCrypto && (
            <div className="alert alert-warning lv-alert">
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
              study={study}
              lesson={playerLesson}
              startAt={startAt}
              theater={theater}
              onToggleTheater={toggleTheater}
              onPlayingChange={setPlaying}
            />
          ) : (
            <NoVideo detail={detail} />
          )}
        </div>

        <section className="lv-info" aria-labelledby="lv-title">
          <header className="lv-head">
            <div className="lv-heading">
              <p className="lv-meta">
                {module && <span>{module}</span>}
                <span>
                  Aula {lesson.number} de {course.total}
                </span>
                {lesson.duration ? <span>{formatClock(lesson.duration)}</span> : null}
              </p>
              <h1 id="lv-title">{lesson.title}</h1>
            </div>

            <div className="lv-actions">
              <QuickStart courseId={course.id} lessonKey={lesson.key} compact />
              {previous ? (
                <Link
                  to={paths.lesson(course.id, previous.key)}
                  className="icon-button lv-step"
                  aria-label={`Aula anterior: ${previous.title}`}
                  data-tip="Aula anterior"
                >
                  <Icon name="left" size={18} />
                </Link>
              ) : (
                <button type="button" className="icon-button lv-step" disabled aria-label="Esta é a primeira aula">
                  <Icon name="left" size={18} />
                </button>
              )}
              <button
                type="button"
                className={`button lv-complete ${completed ? "is-done" : ""} ${justCompleted && completed ? "is-celebrating" : ""}`}
                onClick={toggleCompleted}
                disabled={completing}
                aria-pressed={completed}
              >
                <span className="lv-complete-check" aria-hidden="true">
                  <Icon name="check" size={13} weight="bold" />
                </span>
                {completed ? "Concluída" : "Concluir aula"}
              </button>
              {next ? (
                <Link to={paths.lesson(course.id, next.key)} className="button button-primary lv-next" title={next.title}>
                  Próxima aula
                  <Icon name="right" size={16} />
                </Link>
              ) : (
                <Link to={paths.course(course.id)} className="button button-primary lv-next">
                  Voltar ao curso
                </Link>
              )}
            </div>
          </header>

          {hasBody && (
            <div className={`lv-body ${lesson.description && materials.length ? "has-both" : ""}`}>
              {lesson.description && (
                <div className="lv-about">
                  <h2>Sobre esta aula</h2>
                  <RichText text={lesson.description} />
                </div>
              )}
              {materials.length > 0 && (
                <div className="lv-files">
                  <h2>Materiais</h2>
                  <Materials courseId={course.id} materials={materials} />
                </div>
              )}
            </div>
          )}
        </section>

        <LessonPanel
          course={outline}
          courseId={course.id}
          lessonKey={lesson.key}
          lessonTitle={lesson.title}
          duration={lesson.duration}
          completed={completed}
          playing={playing}
        />
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

function fileIcon(m: MaterialInfo): IconName {
  const type = m.mime_type ?? "";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "file";
}

function fileType(m: MaterialInfo) {
  const ext = m.file_name?.match(/\.([a-z0-9]{1,5})$/i)?.[1];
  return ext ? ext.toUpperCase() : null;
}

function Materials({ courseId, materials }: { courseId: string; materials: MaterialInfo[] }) {
  return (
    <ul className="lv-file-list">
      {materials.map((m) => {
        const type = fileType(m);
        return (
          <li key={m.message_id}>
            <a className="lv-file" href={`${mediaUrl(courseId, m.message_id)}?download=true`} download>
              <span className="lv-file-icon">
                <Icon name={fileIcon(m)} size={18} />
              </span>
              <span className="lv-file-text">
                <span className="lv-file-name">{m.file_name ?? `Arquivo da mensagem ${m.message_id}`}</span>
                <span className="lv-file-meta">{[type, m.size ? formatSize(m.size) : null].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="lv-file-action" aria-hidden="true">
                <Icon name="download" size={17} />
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function NoVideo({ detail }: { detail: LessonDetail }) {
  const { lesson, course } = detail;
  const unavailable = lesson.kind === "unavailable";
  const files = lesson.materials.length > 0;
  const [title, text] = unavailable
    ? ["Aula indisponível", "O sumário cita esta aula, mas nenhuma mensagem do canal foi encontrada para ela."]
    : files
      ? ["Esta aula é um material para baixar", "Não há vídeo aqui. Baixe os arquivos e marque a aula como concluída quando terminar."]
      : ["Esta aula não tem vídeo", "O conteúdo está no texto logo abaixo."];
  return (
    <div className={`lv-doc ${unavailable ? "is-unavailable" : ""}`}>
      <span className="lv-doc-icon">
        <Icon name={unavailable ? "alert" : files ? "file" : "text"} size={26} />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {files && <Materials courseId={course.id} materials={lesson.materials} />}
    </div>
  );
}
