import { messageTimestamp, reconcileMessages } from "./message-reconciliation";

export type Chat = {
  id: string;
  name: string;
  isGroup?: boolean;
  phone?: string;
  avatar?: string;
  last: string;
  time: string;
  unread: number;
};

export type MessageMedia = { data?: string; mimetype: string; filename?: string; omitted?: boolean };
export type MessageContactCard = { name: string; phone?: string; waid?: string };
export type Message = {
  id: string;
  waMessageId?: string;
  body: string;
  time: string;
  mine: boolean;
  senderName?: string;
  type: string;
  media?: MessageMedia;
  contactCards?: MessageContactCard[];
  quotedMessage?: { id: string; body: string };
  forwarded?: boolean;
  identityIds?: string[];
};

export type ConversationFilter = "all" | "unread" | "mine" | "groups";

export const isGroupChat = (chat: Pick<Chat, "id" | "isGroup">) =>
  chat.isGroup === true || chat.id.endsWith("@g.us");
export type MessageSource = "database" | "history" | "optimistic" | "both";
export type MessageWithTimestamp = Message & {
  timestamp: number;
  source: MessageSource;
  identityIds: string[];
  historyTimestamp?: number;
  historyOrder?: number;
};

export const eventId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");

export const messageDateTime = (date: Date | null) =>
  date && !Number.isNaN(date.valueOf())
    ? `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
    : "";

export function listFrom(data: unknown, key?: string): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const value = data as Record<string, unknown>;
    const candidate = key ? value[key] : value.items || value.data;
    if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
    if ("id" in value) return [value];
  }
  return [];
}

function preview(value: unknown) {
  if (typeof value === "string") return value || "Sem mensagens";
  if (value && typeof value === "object") {
    const message = value as Record<string, unknown>;
    const body = String(message.body || message.text || message.content || "").trim();
    const cards = parseVCard(body);
    if (cards.length) return cards.map(card => card.name).join(", ");
    if (body) return body;
    const type = String(message.type || message.messageType || "").toLowerCase();
    const mime = String(message.mimetype || (message.media && typeof message.media === "object"
      ? (message.media as Record<string, unknown>).mimetype : "")).toLowerCase();
    if (["voice", "ptt", "audio"].includes(type) || mime.startsWith("audio/")) return "Áudio";
    if (["video", "gif"].includes(type) || mime.startsWith("video/")) return "Vídeo";
    if (type === "sticker") return "Figurinha";
    if (type === "image" || mime.startsWith("image/")) return "Imagem";
    if (type === "document" || mime === "application/pdf") return "Documento";
    if (type === "location") return "Localização";
    if (["contact", "vcard"].includes(type)) return "Contato";
    if (message.hasMedia === true || message.media) return "Mídia";
  }
  return "Sem mensagens";
}

function decodeVCardValue(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\([\\,;:])/g, "$1")
    .trim();
}

function unfoldVCard(value: string): string[] {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
}

/** Extract only the user-facing fields from a WhatsApp shared-contact vCard. */
export function parseVCard(value: unknown): MessageContactCard[] {
  const raw = typeof value === "string" ? value : "";
  if (!/BEGIN:VCARD/i.test(raw) || !/END:VCARD/i.test(raw)) return [];
  const blocks = [...raw.matchAll(/BEGIN:VCARD[\s\S]*?END:VCARD/gi)].map(match => match[0]);
  return blocks.map(block => {
    const lines = unfoldVCard(block);
    const field = (name: string) => lines.find(line => new RegExp(`^${name}(?:;[^:]*)?:`, "i").test(line));
    const fn = field("FN");
    const n = field("N");
    const nameValue = decodeVCardValue(fn?.slice(fn.indexOf(":") + 1) || "");
    const nameParts = decodeVCardValue(n?.slice(n.indexOf(":") + 1) || "").split(";").filter(Boolean);
    const name = nameValue || nameParts.reverse().join(" ") || "Contato";
    const phoneLine = lines.find(line => /^TEL(?:;[^:]*)?:/i.test(line));
    const phone = phoneLine ? decodeVCardValue(phoneLine.slice(phoneLine.indexOf(":") + 1)) : "";
    const waidMatch = phoneLine?.match(/(?:^|;)waid=([^;:]+)/i);
    const waid = waidMatch ? decodeVCardValue(waidMatch[1]) : "";
    return phone
      ? { name, phone, ...(waid ? { waid } : {}) }
      : waid ? { name, waid } : { name };
  }).filter(card => card.name || card.waid);
}

export function messageDisplayText(message: Pick<Message, "body" | "contactCards">): string {
  if (message.contactCards?.length)
    return message.contactCards.map(card => card.name).join(", ");
  const cards = parseVCard(message.body);
  return cards.length ? cards.map(card => card.name).join(", ") : message.body;
}

export function toChat(value: Record<string, unknown>): Chat {
  const id = String(value.id || value.chatId || value.remoteJid || "");
  const stamp = value.timestamp || value.lastMessageAt;
  const date = stamp ? new Date(typeof stamp === "number"
    ? stamp * (stamp < 10_000_000_000 ? 1000 : 1) : String(stamp)) : null;
  const lastMessage = value.lastMessage && typeof value.lastMessage === "object"
    ? value.lastMessage
    : { body: value.lastMessageBody || value.lastMessage, type: value.lastMessageType,
        hasMedia: value.lastMessageHasMedia };
  return {
    id,
    isGroup: value.isGroup === true || value.kind === "group" || id.endsWith("@g.us"),
    name: String(value.name || value.pushName || value.contactName || value.phone || id.replace(/@.*/, "")),
    last: preview(lastMessage),
    time: date && !Number.isNaN(date.valueOf())
      ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "",
    unread: Number(value.unreadCount || value.unread || 0),
  };
}

export function serializedMessageId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return serializedMessageId(record._serialized || record.id || record.messageId || record.key);
}

export function messageIdentityIds(id: string): string[] {
  const group = id.match(/^(true|false)_([^_]+@g\.us)_(.+)$/i);
  if (group) {
    // Em grupos, o trecho final pode ser o JID do participante. Ele se repete
    // em mensagens diferentes e nunca deve ser usado sozinho como identidade.
    const messageId = group[3].match(/^(.+)_([^_]+@(?:c\.us|lid|s\.whatsapp\.net))$/i)?.[1] || group[3];
    const canonical = `${group[1].toLowerCase()}_${group[2]}_${messageId}`;
    return canonical === id ? [id] : [id, canonical];
  }
  const serialized = id.match(/^(true|false)_.+_([^_]+)$/i);
  return serialized ? [id, `${serialized[1].toLowerCase()}_${serialized[2]}`] : [id];
}

export function toMessage(value: Record<string, unknown>, source: "database" | "history" = "database"): MessageWithTimestamp {
  const stamp = value.timestamp || value.createdAt || value.messageTimestamp;
  const timestamp = messageTimestamp(stamp);
  const date = timestamp ? new Date(timestamp) : null;
  const type = String(value.type || "").toLowerCase();
  const fallback = ({ sticker: "Figurinha", image: "Imagem", video: "Vídeo", audio: "Áudio",
    voice: "Mensagem de voz", document: "Documento", location: "Localização", contact: "Contato" } as Record<string, string>)[type] || "";
  let metadata: Record<string, unknown> | null = null;
  if (value.metadata && typeof value.metadata === "object") metadata = value.metadata as Record<string, unknown>;
  else if (typeof value.metadata === "string") {
    try { metadata = JSON.parse(value.metadata) as Record<string, unknown>; }
    catch { /* Metadados legados inválidos não impedem a leitura da mensagem. */ }
  }
  const mediaValue = value.media && typeof value.media === "object"
    ? value.media as Record<string, unknown>
    : metadata?.media && typeof metadata.media === "object" ? metadata.media as Record<string, unknown> : null;
  const defaultMime = ({ sticker: "image/webp", image: "image/jpeg", video: "video/mp4",
    audio: "audio/mpeg", voice: "audio/ogg", document: "application/octet-stream" } as Record<string, string>)[type];
  const media = mediaValue || (value.hasMedia === true && defaultMime)
    ? { data: typeof mediaValue?.data === "string" ? mediaValue.data : undefined,
        mimetype: typeof mediaValue?.mimetype === "string" ? mediaValue.mimetype : defaultMime || "application/octet-stream",
        filename: typeof mediaValue?.filename === "string" ? mediaValue.filename : undefined,
        omitted: mediaValue?.omitted === true }
    : undefined;
  const quotedValue = value.quotedMessage && typeof value.quotedMessage === "object"
    ? value.quotedMessage as Record<string, unknown>
    : metadata?.quotedMessage && typeof metadata.quotedMessage === "object"
      ? metadata.quotedMessage as Record<string, unknown> : null;
  const quotedId = quotedValue ? serializedMessageId(quotedValue.id) : "";
  const waMessageId = serializedMessageId(value.waMessageId || value.messageId || (source === "history" ? value.id : null));
  const rawIds = [value.waMessageId, value.messageId, value.id].map(serializedMessageId).filter(Boolean);
  const id = rawIds[0] || eventId();
  const identityIds = [...new Set(rawIds.flatMap(messageIdentityIds))];
  const body = String(value.body || value.text || value.content || fallback);
  const contact = value.contact && typeof value.contact === "object"
    ? value.contact as Record<string, unknown> : null;
  const author = String(value.author || "");
  const senderName = (value.isGroup === true || String(value.chatId || "").endsWith("@g.us")) &&
    value.fromMe !== true && String(value.direction || "").toLowerCase() !== "outgoing" && author
    ? String(contact?.name || contact?.pushName || value.pushName || author.replace(/@.*/, ""))
    : "";
  const contactCards = type === "contact" || /BEGIN:VCARD/i.test(body) ? parseVCard(body) : [];
  return {
    id,
    ...(waMessageId ? { waMessageId } : {}),
    identityIds: identityIds.length ? identityIds : [id],
    body,
    mine: Boolean(value.fromMe) || String(value.direction).toLowerCase() === "outgoing",
    ...(senderName ? { senderName } : {}),
    time: messageDateTime(date),
    timestamp,
    ...(source === "history" && timestamp ? { historyTimestamp: timestamp } : {}),
    type,
    media,
    ...(contactCards.length ? { contactCards } : {}),
    ...(quotedId ? { quotedMessage: { id: quotedId, body: String(quotedValue?.body || "") } } : {}),
    ...(value.forwarded === true || value.isForwarded === true || metadata?.forwarded === true ? { forwarded: true } : {}),
    source,
  };
}

export function mergeMessages(messages: MessageWithTimestamp[]) {
  return reconcileMessages(messages);
}
