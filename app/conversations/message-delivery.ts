import { errorMessage, request, type ApiConfig } from "../atende-api";

type SentTextResult = { messageId?: unknown; timestamp?: number; message?: string } | null;

export async function deliverText(
  config: ApiConfig,
  chatId: string,
  text: string,
  quotedMessageId?: string,
): Promise<SentTextResult> {
  const response = await request(config,
    `/sessions/${encodeURIComponent(config.sessionId)}/messages/send-text`, {
      method: "POST",
      body: JSON.stringify({ chatId, text, ...(quotedMessageId ? { quotedMessageId } : {}) }),
    });
  const result = await response.json().catch(() => null) as SentTextResult;
  if (!response.ok) throw new Error(errorMessage(result));
  return result;
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

export async function deliverMedia(
  config: ApiConfig,
  chatId: string,
  file: File,
  voiceNote = false,
): Promise<void> {
  const base64 = await readFileBase64(file);
  const mime = file.type || "application/octet-stream";
  let outgoingBase64 = base64;
  let outgoingMime = mime;
  const endpoint = voiceNote || mime.startsWith("audio/")
    ? "send-audio"
    : mime.startsWith("image/")
      ? "send-image"
      : mime.startsWith("video/")
        ? "send-video"
        : "send-document";
  const extension = ({
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  } as Record<string, string>)[mime] || "bin";
  let outgoingFilename = file.name || `arquivo-colado.${extension}`;
  let ptt = false;

  if (voiceNote) {
    const conversion = await request(config,
      `/sessions/${encodeURIComponent(config.sessionId)}/media/convert/voice`, {
        method: "POST",
        body: JSON.stringify({ base64 }),
      });
    const converted = await conversion.json().catch(() => null) as {
      base64?: string; mimetype?: string;
    } | null;
    if (!conversion.ok) throw new Error(errorMessage(converted));
    if (!converted?.base64)
      throw new Error("Não foi possível preparar o áudio para envio.");
    outgoingBase64 = converted.base64;
    outgoingMime = converted.mimetype || "audio/ogg; codecs=opus";
    outgoingFilename = "mensagem-de-voz.ogg";
    ptt = true;
  }

  const response = await request(config,
    `/sessions/${encodeURIComponent(config.sessionId)}/messages/${endpoint}`, {
      method: "POST",
      body: JSON.stringify({
        chatId,
        base64: outgoingBase64,
        mimetype: outgoingMime,
        filename: outgoingFilename,
        ...(endpoint === "send-audio" ? { ptt } : {}),
      }),
    });
  if (!response.ok)
    throw new Error(errorMessage(await response.json().catch(() => null)));
}
