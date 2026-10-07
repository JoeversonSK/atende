import { errorMessage, request, type ApiConfig } from "../atende-api";
import { listFrom, mergeMessages, messageDateTime, messageIdentityIds, serializedMessageId,
  toMessage, type MessageWithTimestamp } from "../conversation-model";

type MessageSource = "database" | "history";
type FetchedHistory = {
  records: Record<string, unknown>[];
  source: MessageSource;
  fallback: boolean;
};

export async function fetchMessageRecords(
  config: ApiConfig,
  chatId: string,
  liveHistory: boolean,
): Promise<FetchedHistory> {
  const session = encodeURIComponent(config.sessionId);
  const chat = encodeURIComponent(chatId);
  const localPath = `/sessions/${session}/messages?chatId=${chat}&limit=100&inlineMedia=true`;
  const historyPath = `/sessions/${session}/messages/${chat}/history?limit=2000&deep=true`;
  const response = await request(config, liveHistory ? historyPath : localPath);
  if (!response.ok && liveHistory) {
    const fallback = await request(config, localPath);
    if (!fallback.ok)
      throw new Error(errorMessage(await fallback.json().catch(() => null)));
    return { records: listFrom(await fallback.json(), "messages"), source: "database", fallback: true };
  }
  if (!response.ok)
    throw new Error(errorMessage(await response.json().catch(() => null)));
  return {
    records: listFrom(await response.json(), liveHistory ? undefined : "messages"),
    source: liveHistory ? "history" : "database",
    fallback: false,
  };
}

export async function fetchRecentMediaRecords(
  config: ApiConfig,
  chatId: string,
): Promise<Record<string, unknown>[] | null> {
  const response = await request(config,
    `/sessions/${encodeURIComponent(config.sessionId)}/messages/${encodeURIComponent(chatId)}/history?limit=100&includeMedia=true`);
  return response.ok ? listFrom(await response.json()) : null;
}

export function reconcileMessageRecords(
  current: MessageWithTimestamp[],
  records: Record<string, unknown>[],
  source: MessageSource,
  replace = false,
): MessageWithTimestamp[] {
  const incoming = records
    .filter(record => source !== "database" || (record.status !== "pending" && record.status !== "failed"))
    .map((record, index) => ({
      ...toMessage(record, source),
      ...(source === "history" && replace ? { historyOrder: index } : {}),
    }))
    .filter(message => message.body);
  const combined = replace
    ? [...current.filter(message => message.source === "optimistic"), ...incoming]
    : [...current, ...incoming];
  return mergeMessages(combined);
}

export function createOptimisticText(
  body: string,
  id: string,
  timestamp: number,
  quoted?: { id: string; body: string },
): MessageWithTimestamp {
  return {
    id, identityIds: [id], body, mine: true,
    time: messageDateTime(new Date(timestamp)), timestamp, type: "text",
    ...(quoted ? { quotedMessage: quoted } : {}),
    source: "optimistic",
  };
}

export function appendOptimisticText(
  current: MessageWithTimestamp[],
  body: string,
  id: string,
  timestamp: number,
  quoted?: { id: string; body: string },
): MessageWithTimestamp[] {
  return mergeMessages([...current, createOptimisticText(body, id, timestamp, quoted)]);
}

export function confirmOptimisticText(
  current: MessageWithTimestamp[],
  optimisticId: string,
  result: { messageId?: unknown; timestamp?: number } | null,
  optimisticTimestamp: number,
): MessageWithTimestamp[] {
  const confirmedId = serializedMessageId(result?.messageId);
  const confirmedTimestamp = Number(result?.timestamp) > 0
    ? Number(result?.timestamp) * 1000 : optimisticTimestamp;
  return mergeMessages(current.map(message =>
    message.identityIds.includes(optimisticId)
      ? {
          ...message,
          id: confirmedId || message.id,
          waMessageId: confirmedId || message.waMessageId,
          identityIds: confirmedId
            ? [...new Set([...message.identityIds, ...messageIdentityIds(confirmedId)])]
            : message.identityIds,
          timestamp: confirmedTimestamp,
          time: messageDateTime(new Date(confirmedTimestamp)),
          source: "history" as const,
        }
      : message));
}

export function discardOptimisticText(
  current: MessageWithTimestamp[], optimisticId: string,
): MessageWithTimestamp[] {
  return current.filter(message => !message.identityIds.includes(optimisticId));
}
