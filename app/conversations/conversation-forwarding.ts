import { errorMessage, request, type ApiConfig } from "../atende-api";

export type ForwardFailure = { id: string; name: string; reason: string };

export async function forwardMessageToContacts(
  config: ApiConfig,
  fromChatId: string,
  messageId: string,
  recipients: string[],
  contactName: (chatId: string) => string,
): Promise<{ delivered: number; failed: ForwardFailure[] }> {
  let delivered = 0;
  const failed: ForwardFailure[] = [];
  for (const toChatId of recipients) {
    try {
      const response = await request(config,
        `/sessions/${encodeURIComponent(config.sessionId)}/messages/forward`, {
          method: "POST",
          body: JSON.stringify({ fromChatId, toChatId, messageId }),
        });
      if (!response.ok)
        throw new Error(errorMessage(await response.json().catch(() => null)));
      delivered++;
    } catch (error) {
      failed.push({
        id: toChatId,
        name: contactName(toChatId),
        reason: error instanceof Error ? error.message : "Falha ao encaminhar",
      });
    }
  }
  return { delivered, failed };
}
