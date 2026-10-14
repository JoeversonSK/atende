import { errorMessage, request, type ApiConfig } from "../atende-api";
import { messageDisplayText, type Message, type MessageWithTimestamp } from "../conversation-model";

export type MessageSearchHit = {
  messageId: string;
  waMessageId: string;
  body: string;
  snippet: string;
  timestamp: number;
  direction: "incoming" | "outgoing";
};

export type MessageSearchPage = { hits: MessageSearchHit[]; total: number };
export type ConversationSearchHit = MessageSearchHit & {
  source: "loaded" | "saved";
  timeLabel?: string;
};

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
}

/** The live WhatsApp history may not yet exist in the database search index. */
export function searchLoadedMessages(messages: Message[], query: string): ConversationSearchHit[] {
  const needle = normalizeSearchText(query.trim());
  if (needle.length < 2) return [];
  return messages.flatMap(message => {
    const body = messageDisplayText(message);
    if (!normalizeSearchText(body).includes(needle)) return [];
    const stamp = (message as Partial<MessageWithTimestamp>).timestamp;
    return [{
      messageId: message.id,
      waMessageId: message.waMessageId || "",
      body,
      snippet: body,
      timestamp: typeof stamp === "number" ? stamp : 0,
      direction: message.mine ? "outgoing" as const : "incoming" as const,
      source: "loaded" as const,
      timeLabel: message.time,
    }];
  });
}

export async function searchConversationMessages(
  config: ApiConfig,
  chatId: string,
  query: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<MessageSearchPage> {
  const params = new URLSearchParams({
    q: query,
    sessionId: config.sessionId,
    chatId,
    limit: "50",
    offset: String(offset),
  });
  const response = await request(config, `/search?${params}`, { signal });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(result));
  const page = result as Partial<MessageSearchPage> | null;
  if (!page || !Array.isArray(page.hits) || !Number.isFinite(page.total))
    throw new Error("A busca retornou uma resposta inválida.");
  return { hits: page.hits, total: page.total as number };
}

export function loadedSearchMessageId(messages: Message[], hit: MessageSearchHit): string | null {
  const match = messages.find(message =>
    message.id === hit.messageId ||
    (hit.waMessageId && (message.waMessageId === hit.waMessageId || message.identityIds?.includes(hit.waMessageId))) ||
    message.identityIds?.includes(hit.messageId));
  return match?.id || null;
}

export function searchSnippetText(snippet: string): string {
  return snippet.replace(/<\/?mark>/gi, "").trim();
}
