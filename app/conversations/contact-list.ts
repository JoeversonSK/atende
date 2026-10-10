import { isGroupChat, type Chat, type MessageContactCard } from "../conversation-model";
import type { SupportOverview } from "../dashboard-model";

export type ContactRow = {
  id: string;
  name: string;
  phone?: string;
  avatar?: string;
  tags: string[];
};

const phoneDigits = (value?: string) => (value || "").replace(/\D/g, "");

/** Localiza um contato pelo telefone de um vCard, aceitando formatos com máscara. */
export function findContactRowByPhone(rows: ContactRow[], phone?: string): ContactRow | undefined {
  const wanted = phoneDigits(phone);
  if (!wanted) return undefined;
  return rows.find(row => phoneDigits(row.phone || row.id.split("@")[0]) === wanted);
}

type Profile = SupportOverview["contacts"][number];
const hasName = (value?: string) => Boolean(value && /[\p{L}]/u.test(value));
const displayName = (...values: (string | undefined)[]) =>
  values.find(hasName)?.trim() || "Contato sem nome";
const nameKey = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Resolve um cartão compartilhado para uma conversa já carregada, sem criar histórico. */
export function findChatForSharedContact(
  chats: Chat[],
  rows: ContactRow[],
  card: MessageContactCard,
): Chat | undefined {
  const phones = [card.waid, card.phone].filter((phone): phone is string => Boolean(phone));
  const row = phones.map(phone => findContactRowByPhone(rows, phone)).find(Boolean);
  const byPhone = (row && chats.find(chat => !isGroupChat(chat) && chat.id === row.id)) || chats.find(chat => {
    if (isGroupChat(chat)) return false;
    const digits = phoneDigits(chat.phone || chat.id.split("@")[0]);
    return digits && phones.some(phone => digits === phoneDigits(phone));
  });
  if (byPhone) return byPhone;

  const key = nameKey(card.name);
  if (key.length < 2) return undefined;
  const named = chats.filter(chat => {
    if (isGroupChat(chat)) return false;
    const chatKey = nameKey(chat.name);
    return chatKey === key || chatKey.startsWith(`${key} `) || chatKey.endsWith(` ${key}`);
  });
  return named.length === 1 ? named[0] : undefined;
}

export function buildContactRows(chats: Chat[], contacts: Profile[]): ContactRow[] {
  const hiddenIds = new Set(contacts.filter(contact => contact.data.directoryHidden).map(contact => contact.chatId));
  const liveChatIds = new Set(chats.filter(chat => !isGroupChat(chat)).map(chat => chat.id));
  const rows = new Map<string, ContactRow>(chats
    .filter(chat => !isGroupChat(chat) && !hiddenIds.has(chat.id))
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
