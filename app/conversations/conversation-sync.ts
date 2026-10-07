import { request, type ApiConfig } from "../atende-api";
import { listFrom, toChat, type Chat } from "../conversation-model";
import type { SupportOverview } from "../dashboard-model";

export type ChatSnapshot = {
  overview: SupportOverview;
  records: Record<string, unknown>[];
  live: boolean;
};

export async function fetchChatSnapshot(config: ApiConfig): Promise<ChatSnapshot> {
  const session = encodeURIComponent(config.sessionId);
  const [profileResponse, chatResponse] = await Promise.all([
    request(config, `/operator-auth/contacts/${session}`),
    request(config, `/sessions/${session}/chats?limit=1000`).catch(() => null),
  ]);
  if (!profileResponse.ok)
    throw new Error("Não foi possível atualizar os perfis dos contatos.");

  const overview = await profileResponse.json() as SupportOverview;
  const live = Boolean(chatResponse?.ok);
  let records: Record<string, unknown>[] = live
    ? listFrom(await chatResponse!.json())
    : overview.activity.map(activity => ({
      id: activity.chatId,
      name: activity.name || "Contato sem nome",
      timestamp: Math.max(Number(activity.incoming), Number(activity.outgoing)),
      lastMessage: "Histórico salvo",
    }));

  while (live && records.length > 0 && records.length % 1000 === 0) {
    const page = await request(config,
      `/sessions/${session}/chats?limit=1000&offset=${records.length}`);
    if (!page.ok) throw new Error("Não foi possível carregar todas as conversas.");
    const batch = listFrom(await page.json());
    records = [...records, ...batch];
    if (batch.length < 1000) break;
  }
  return { overview, records, live };
}

export function buildSyncedChats({
  records, overview, pictures, readSnapshot, readVersions, pendingReads,
}: {
  records: Record<string, unknown>[];
  overview: SupportOverview;
  pictures: Map<string, string | null>;
  readSnapshot: Map<string, number>;
  readVersions: Map<string, number>;
  pendingReads: Set<string>;
}): Chat[] {
  const profiles = new Map(overview.contacts.map(profile => [profile.chatId, profile.data]));
  return records
    .filter(record => record.isGroup !== true &&
      !/@(g\.us|broadcast|newsletter)$/.test(String(record.id || "")))
    .map(record => {
      const chat = toChat(record);
      const profile = profiles.get(chat.id);
      return {
        ...chat,
        name: profile?.name || chat.name,
        phone: profile?.phone || String(record.phone ||
          (/@(c\.us|s\.whatsapp\.net)$/.test(chat.id) ? chat.id.split("@")[0] : "")),
        avatar: pictures.get(chat.id) || undefined,
        unread: pendingReads.has(chat.id) ||
          readSnapshot.get(chat.id) !== readVersions.get(chat.id)
          ? 0 : chat.unread,
      };
    });
}

export async function fetchProfilePictures(
  config: ApiConfig,
  chatIds: string[],
): Promise<Record<string, string | null> | null> {
  if (!chatIds.length) return null;
  const response = await request(config,
    `/sessions/${encodeURIComponent(config.sessionId)}/contacts/profile-pictures?ids=${encodeURIComponent(chatIds.join(","))}`)
    .catch(() => null);
  if (!response?.ok) return null;
  const result = await response.json() as { pictures?: Record<string, string | null> };
  return result.pictures || {};
}
