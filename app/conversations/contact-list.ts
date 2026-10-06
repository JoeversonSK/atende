import type { Chat } from "../conversation-model";
import type { SupportOverview } from "../dashboard-model";

export type ContactRow = {
  id: string;
  name: string;
  phone?: string;
  avatar?: string;
  tags: string[];
};

type Profile = SupportOverview["contacts"][number];
const hasName = (value?: string) => Boolean(value && /[\p{L}]/u.test(value));
const displayName = (...values: (string | undefined)[]) =>
  values.find(hasName)?.trim() || "Contato sem nome";
const nameKey = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function buildContactRows(chats: Chat[], contacts: Profile[]): ContactRow[] {
  const hiddenIds = new Set(contacts.filter(contact => contact.data.directoryHidden).map(contact => contact.chatId));
  const liveChatIds = new Set(chats.map(chat => chat.id));
  const rows = new Map<string, ContactRow>(chats
    .filter(chat => !hiddenIds.has(chat.id))
    .map(chat => [chat.id, {
      id: chat.id, name: displayName(chat.name), phone: chat.phone, avatar: chat.avatar, tags: [],
    }]));

  for (const contact of contacts) {
    if (contact.data.directoryHidden || /@(g\.us|broadcast|newsletter)$/.test(contact.chatId)) continue;
    const old = rows.get(contact.chatId);
    rows.set(contact.chatId, {
      id: contact.chatId,
      name: displayName(contact.data.name, old?.name),
      phone: contact.data.phone || old?.phone,
      avatar: old?.avatar,
      tags: (contact.data as Profile["data"] & { tags?: string[] }).tags || [],
    });
  }

  // Mescla apenas o perfil importado por telefone com um único chat LID de
  // mesmo nome. Uma segunda conversa real permanece visível.
  const groups = new Map<string, ContactRow[]>();
  for (const row of rows.values()) {
    const key = nameKey(row.name);
    if (key.length < 6 || !/[\p{L}]/u.test(key)) continue;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  for (const group of groups.values()) {
    if (group.length !== 2) continue;
    const old = group.find(row => row.id.endsWith("@lid") && !row.phone);
    const imported = group.find(row => row.id.endsWith("@c.us") && row.phone && !liveChatIds.has(row.id));
    if (!old || !imported) continue;
    rows.set(old.id, { ...old, phone: imported.phone, tags: [...new Set([...old.tags, ...imported.tags])] });
    rows.delete(imported.id);
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findForwardCandidates(rows: ContactRow[], sourceChatId: string | undefined, search: string): ContactRow[] {
  const normalize = (value: string) =>
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const query = normalize(search.trim());
  return rows.filter(contact =>
    contact.id !== sourceChatId &&
    /@(c\.us|lid)$/.test(contact.id) &&
    (!query || normalize(`${contact.name} ${contact.phone || ""} ${contact.id}`).includes(query)));
}

export function availableContactTags(rows: ContactRow[]): string[] {
  return [...new Set(rows.flatMap(contact => contact.tags))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
