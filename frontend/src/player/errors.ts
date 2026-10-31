import { AUTH_EVENT } from "../api";

export interface PlaybackError {
  title: string;
  message: string;
  canRetry: boolean;
}

/**
 * Traduz a falha do <video> em uma mensagem útil. O elemento só informa um
 * código genérico, então perguntamos ao backend o que houve com o arquivo.
 */
export async function diagnose(src: string, error: MediaError | null, mimeType: string | null): Promise<PlaybackError> {
  const code = error?.code;
  try {
    const response = await fetch(src, { headers: { Range: "bytes=0-0" } });
    if (response.status === 401 || response.status === 409 || response.status === 503) {
      const body = await response.json().catch(() => ({}));
      if (body.code === "telegram_reauth_required" || body.code === "not_authenticated") {
        // O app leva para a tela de vínculo (ou de login) automaticamente.
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: body.code }));
      }
      return {
        title: body.code === "telegram_unavailable" ? "Telegram fora do ar" : "Telegram desconectado",
        message: body.detail ?? "Vincule sua conta do Telegram para assistir às aulas.",
        canRetry: true,
      };
    }
    if (response.status === 410) {
      return {
        title: "Vídeo indisponível",
        message: "Este vídeo foi apagado do canal ou não está mais acessível por esta conta.",
        canRetry: false,
      };
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { title: "Não foi possível carregar", message: body.detail ?? `Erro ${response.status}.`, canRetry: true };
    }
  } catch {
    return { title: "Sem conexão", message: "O servidor do TeleClass não respondeu.", canRetry: true };
  }
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === MediaError.MEDIA_ERR_DECODE) {
    return {
      title: "Formato não suportado",
      message: `O navegador não consegue reproduzir este arquivo${mimeType ? ` (${mimeType})` : ""}.`,
      canRetry: false,
    };
  }
  return {
    title: "A reprodução foi interrompida",
    message: code === MediaError.MEDIA_ERR_NETWORK ? "A conexão com o vídeo caiu." : "Ocorreu uma falha ao reproduzir o vídeo.",
    canRetry: true,
  };
}
