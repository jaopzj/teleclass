import { RefObject, useEffect } from "react";
import { flush } from "./queue";
import { LessonContext, StudyRecorder } from "./recorder";
import { PlaybackTracker } from "./tracker";

const TICK_MS = 1_000;

/**
 * Mede o tempo de reprodução efetiva da aula e envia ao servidor.
 *
 * Captura (PlaybackTracker) → sessão e numeração (StudyRecorder) → fila
 * persistente e envio (queue). Nenhum cálculo de métrica acontece aqui.
 */
export function useStudyTracking(video: RefObject<HTMLVideoElement>, context: LessonContext | null) {
  const userId = context?.userId;
  const courseId = context?.courseId;
  const lessonKey = context?.lessonKey;

  useEffect(() => {
    const element = video.current;
    if (!element || !userId || !courseId || !lessonKey) return;
    const recorder = new StudyRecorder({ userId, courseId, lessonKey });
    const tracker = new PlaybackTracker(element, (segment) => recorder.add(segment), {
      onPlayIntent: () => recorder.ensureOpen(),
    });
    tracker.attach();
    const tick = window.setInterval(() => tracker.tick(), TICK_MS);

    // Fim de reprodução: envia logo, para a tela inicial já mostrar o tempo.
    const onStop = () => window.setTimeout(() => void flush(), 0);
    // Aba oculta ou página fechando: fecha o trecho em andamento e envia com keepalive.
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      tracker.cut();
      void flush({ keepalive: true });
    };
    const onPageHide = () => {
      tracker.cut();
      recorder.finish();
    };
    element.addEventListener("pause", onStop);
    element.addEventListener("ended", onStop);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      // Troca de aula ou de rota: fecha o trecho e envia o que faltou.
      window.clearInterval(tick);
      tracker.detach();
      recorder.finish();
      element.removeEventListener("pause", onStop);
      element.removeEventListener("ended", onStop);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [video, userId, courseId, lessonKey]);
}
