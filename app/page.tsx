"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { LoginScreen, SettingsScreen } from "./account-panels";
import { connectionOrigin } from "./connection-origin";
import { ContactsPanel } from "./contacts-panel";
import { TeamChat } from "./team-chat";
import { ContactProfile } from "./contact-profile";
import { messageTimestamp, reconcileMessages } from "./message-reconciliation";
import type { ConversationFlow } from "./flow-settings";
import type { QuickReply } from "./quick-replies";
import {
  TicketDashboard,
  emptyOverview,
  type SupportOverview,
} from "./ticket-dashboard";
import {
  Bell,
  ChevronRight,
  Inbox,
  PanelRight,
  UserRound,
  UsersRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  Archive,
  ArrowLeft,
  Check,
  CheckCheck,
  CircleAlert,
  Filter,
  Forward,
  GitBranch,
  LoaderCircle,
  MessageCircle,
  Mic,
  Paperclip,
  Pause,
  Phone,
  Play,
  Reply,
  Search,
  Send,
  Settings,
  Smile,
  Smartphone,
  Trash2,
  Video,
  X,
} from "lucide-react";

type Config = { baseUrl: string; apiKey: string; sessionId: string };
type Chat = {
  id: string;
  name: string;
  phone?: string;
  avatar?: string;
  last: string;
  time: string;
  unread: number;
};
type PendingPaste =
  | { kind: "files"; files: File[]; omittedFiles: number; chatId: string; chatName: string }
  | { kind: "text"; text: string; chatId: string; chatName: string };
function PasteFilePreview({ file, index }: { file: File; index: number }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "file";
  useEffect(() => {
    if (kind === "file") return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setPreviewFailed(false);
    return () => URL.revokeObjectURL(url);
  }, [file, kind]);
  const label = kind === "image" ? "Imagem" : kind === "video" ? "Vídeo" : kind === "audio" ? "Áudio" : file.type === "application/pdf" ? "PDF" : "Arquivo";
  return <li className="paste-preview-file">
    {previewUrl && !previewFailed && kind === "image" && <img className="paste-file-image" src={previewUrl} alt={`Prévia da imagem ${file.name || index + 1}`} onError={() => setPreviewFailed(true)} />}
    {previewUrl && !previewFailed && kind === "video" && <video className="paste-file-video" src={previewUrl} controls preload="metadata" onError={() => setPreviewFailed(true)} />}
    {previewUrl && !previewFailed && kind === "audio" && <audio className="paste-file-audio" src={previewUrl} controls preload="metadata" onError={() => setPreviewFailed(true)} />}
    {(kind === "file" || previewFailed) && <div className="paste-file-generic"><Paperclip size={24}/><span>{previewFailed ? "Prévia indisponível" : label}</span></div>}
    <div className="paste-file-meta"><Paperclip size={17}/><span>{file.name || `${label} colado ${index + 1}`}</span><small>{label} · {Math.max(1, Math.ceil(file.size / 1024))} KB</small></div>
  </li>;
}
type MessageMedia = {
  data?: string;
  mimetype: string;
  filename?: string;
  omitted?: boolean;
};
type Message = {
  id: string;
  waMessageId?: string;
  body: string;
  time: string;
  mine: boolean;
  type: string;
  media?: MessageMedia;
  quotedMessage?: { id: string; body: string };
  forwarded?: boolean;
  identityIds?: string[];
};
type MessageSource = "database" | "history" | "optimistic" | "both";
type TeamAlert = { id: string; room: string; senderName: string; body: string; mentioned: boolean };
type MessageWithTimestamp = Message & {
  timestamp: number;
  source: MessageSource;
  identityIds: string[];
  historyTimestamp?: number;
  historyOrder?: number;
};
type Account = { name: string; phone: string };
type Assignment = {
  assigneeName: string;
  assigneeId?: string;
  updatedAt?: string;
};
type Operator = {
  id: string;
  username: string;
  displayName: string;
  role?: string;
  active?: boolean;
  canSend?: boolean;
  canAssign?: boolean;
  activityStatus?: 'available' | 'break' | 'meeting' | 'away' | 'custom' | 'onsite';
  activityNote?: string;
  activityUntil?: string | null;
};
export type NotificationPreferences = {
  enabled: boolean;
  desktop: boolean;
  sound: boolean;
  notifyMessages: boolean;
  notifyAssignments: boolean;
  showPreview: boolean;
  soundType: "classic" | "soft" | "bell" | "urgent";
  volume: number;
};
const storageKey = "atende-openwa-config";
const operatorStorageKey = "atende-operator-account";
const notificationStorageKey = "atende-notification-preferences";
const defaultNotificationPreferences: NotificationPreferences = {
  enabled: false,
  desktop: true,
  sound: true,
  notifyMessages: true,
  notifyAssignments: true,
  showPreview: true,
  soundType: "classic",
  volume: 70,
};
const emptyConfig: Config = {
  baseUrl: "http://127.0.0.1:2785",
  apiKey: "",
  sessionId: "",
};
const emojis = ["😀", "😂", "😍", "🙏", "👍", "🎉", "❤️", "👋"];
const eventId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
const messageDateTime = (date: Date | null) =>
  date && !Number.isNaN(date.valueOf())
    ? `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
    : "";

const initials = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "WA";
function ContactAvatar({
  chat,
  className = "wa-avatar wa-contact",
}: {
  chat: Pick<Chat, "name" | "avatar">;
  className?: string;
}) {
  return (
    <span className={className}>
      {chat.avatar ? (
        <img src={chat.avatar} alt="" referrerPolicy="no-referrer" />
      ) : (
        initials(chat.name)
      )}
    </span>
  );
}
function loadConfig(): Config {
  try {
    const saved =
      localStorage.getItem(storageKey) ||
      sessionStorage.getItem(storageKey) ||
      "{}";
    const config = { ...emptyConfig, ...JSON.parse(saved) };
    return {
      ...config,
      baseUrl: connectionOrigin(config.baseUrl, window.location.origin),
    };
  } catch {
    return { ...emptyConfig, baseUrl: window.location.origin };
  }
}
function persistConfig(config: Config) {
  const saved = JSON.stringify(config);
  localStorage.setItem(storageKey, saved);
  sessionStorage.setItem(storageKey, saved);
}
function loadOperator(): { user: Operator; token: string } | null {
  try {
    return JSON.parse(localStorage.getItem(operatorStorageKey) || "null");
  } catch {
    return null;
  }
}
function persistOperator(value: { user: Operator; token: string } | null) {
  if (value) localStorage.setItem(operatorStorageKey, JSON.stringify(value));
  else localStorage.removeItem(operatorStorageKey);
}
function loadNotificationPreferences(): NotificationPreferences {
  try {
    return {
      ...defaultNotificationPreferences,
      ...JSON.parse(localStorage.getItem(notificationStorageKey) || "{}"),
    };
  } catch {
    return defaultNotificationPreferences;
  }
}
function request(config: Config, path: string, init?: RequestInit) {
  return fetch(`${config.baseUrl.replace(/\/$/, "")}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
      "X-Atende-Token": loadOperator()?.token || "",
      ...(init?.headers || {}),
    },
  });
}
function errorMessage(data: unknown) {
  return typeof data === "object" && data && "message" in data
    ? String((data as { message: unknown }).message)
    : "Não foi possível concluir esta ação.";
}
function listFrom(data: unknown, key?: string): Record<string, unknown>[] {
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
    const body = String(
      message.body || message.text || message.content || "",
    ).trim();
    if (body) return body;
    const type = String(
      message.type || message.messageType || "",
    ).toLowerCase();
    const mime = String(
      message.mimetype ||
        (message.media && typeof message.media === "object"
          ? (message.media as Record<string, unknown>).mimetype
          : ""),
    ).toLowerCase();
    if (["voice", "ptt", "audio"].includes(type) || mime.startsWith("audio/"))
      return "Áudio";
    if (["video", "gif"].includes(type) || mime.startsWith("video/"))
      return "Vídeo";
    if (type === "sticker") return "Figurinha";
    if (type === "image" || mime.startsWith("image/")) return "Imagem";
    if (type === "document" || mime === "application/pdf") return "Documento";
    if (type === "location") return "Localização";
    if (["contact", "vcard"].includes(type)) return "Contato";
    if (message.hasMedia === true || message.media) return "Mídia";
  }
  return "Sem mensagens";
}
function toChat(value: Record<string, unknown>): Chat {
  const id = String(value.id || value.chatId || value.remoteJid || "");
  const stamp = value.timestamp || value.lastMessageAt;
  const date = stamp
    ? new Date(
        typeof stamp === "number"
          ? stamp * (stamp < 10_000_000_000 ? 1000 : 1)
          : String(stamp),
      )
    : null;
  const lastMessage =
    value.lastMessage && typeof value.lastMessage === "object"
      ? value.lastMessage
      : {
          body: value.lastMessageBody || value.lastMessage,
          type: value.lastMessageType,
          hasMedia: value.lastMessageHasMedia,
        };
  return {
    id,
    name: String(
      value.name ||
        value.pushName ||
        value.contactName ||
        value.phone ||
        id.replace(/@.*/, ""),
    ),
    last: preview(lastMessage),
    time:
      date && !Number.isNaN(date.valueOf())
        ? date.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "",
    unread: Number(value.unreadCount || value.unread || 0),
  };
}
function serializedMessageId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return serializedMessageId(
    record._serialized || record.id || record.messageId || record.key,
  );
}
function messageIdentityIds(id: string): string[] {
  const serialized = id.match(/^(true|false)_.+_([^_]+)$/i);
  return serialized
    ? [id, `${serialized[1].toLowerCase()}_${serialized[2]}`]
    : [id];
}
function toMessage(
  value: Record<string, unknown>,
  source: "database" | "history" = "database",
): MessageWithTimestamp {
  const stamp = value.timestamp || value.createdAt || value.messageTimestamp;
  const timestamp = messageTimestamp(stamp);
  const date = timestamp ? new Date(timestamp) : null;
  const type = String(value.type || "").toLowerCase();
  const fallback =
    (
      {
        sticker: "Figurinha",
        image: "Imagem",
        video: "Vídeo",
        audio: "Áudio",
        voice: "Mensagem de voz",
        document: "Documento",
        location: "Localização",
        contact: "Contato",
      } as Record<string, string>
    )[type] || "";
  let metadata: Record<string, unknown> | null = null;
  if (value.metadata && typeof value.metadata === "object")
    metadata = value.metadata as Record<string, unknown>;
  else if (typeof value.metadata === "string") {
    try {
      metadata = JSON.parse(value.metadata) as Record<string, unknown>;
    } catch {
      /* Ignore invalid legacy metadata. */
    }
  }
  const mediaValue =
    value.media && typeof value.media === "object"
      ? (value.media as Record<string, unknown>)
      : metadata?.media && typeof metadata.media === "object"
        ? (metadata.media as Record<string, unknown>)
        : null;
  const defaultMime = (
    {
      sticker: "image/webp",
      image: "image/jpeg",
      video: "video/mp4",
      audio: "audio/mpeg",
      voice: "audio/ogg",
      document: "application/octet-stream",
    } as Record<string, string>
  )[type];
  const media =
    mediaValue || (value.hasMedia === true && defaultMime)
      ? {
          data:
            typeof mediaValue?.data === "string" ? mediaValue.data : undefined,
          mimetype:
            typeof mediaValue?.mimetype === "string"
              ? mediaValue.mimetype
              : defaultMime || "application/octet-stream",
          filename:
            typeof mediaValue?.filename === "string"
              ? mediaValue.filename
              : undefined,
          omitted: mediaValue?.omitted === true,
        }
      : undefined;
  const quotedValue = value.quotedMessage && typeof value.quotedMessage === "object"
    ? value.quotedMessage as Record<string, unknown>
    : metadata?.quotedMessage && typeof metadata.quotedMessage === "object"
      ? metadata.quotedMessage as Record<string, unknown>
      : null;
  const quotedId = quotedValue ? serializedMessageId(quotedValue.id) : "";
  const waMessageId = serializedMessageId(value.waMessageId || value.messageId || (source === "history" ? value.id : null));
  const rawIds = [value.waMessageId, value.messageId, value.id]
    .map(serializedMessageId)
    .filter(Boolean);
  const id = rawIds[0] || eventId();
  const identityIds = [...new Set(rawIds.flatMap(messageIdentityIds))];
  return {
    id,
    ...(waMessageId ? { waMessageId } : {}),
    identityIds: identityIds.length ? identityIds : [id],
    body: String(value.body || value.text || value.content || fallback),
    mine:
      Boolean(value.fromMe) ||
      String(value.direction).toLowerCase() === "outgoing",
    time: messageDateTime(date),
    timestamp,
    ...(source === "history" && timestamp ? { historyTimestamp: timestamp } : {}),
    type,
    media,
    ...(quotedId ? { quotedMessage: { id: quotedId, body: String(quotedValue?.body || "") } } : {}),
    ...(value.forwarded === true || value.isForwarded === true || metadata?.forwarded === true ? { forwarded: true } : {}),
    source,
  };
}

function mergeMessages(messages: MessageWithTimestamp[]) {
  return reconcileMessages(messages);
}

function MessageText({ text }: { text: string }) {
  const parts: (string | { url: string })[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/gi;
  let cursor = 0,
    match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const raw = match[0],
      trailing = raw.match(/[),.!?;:\]}]+$/)?.[0] || "";
    const url = trailing ? raw.slice(0, -trailing.length) : raw;
    if (url) parts.push({ url });
    if (trailing) parts.push(trailing);
    cursor = match.index + raw.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  const renderText = (value: string, key: string) => {
    const fragments: React.ReactNode[] = [];
    const bold = /\*([^*\n]+)\*/g;
    let start = 0,
      boldMatch: RegExpExecArray | null;
    while ((boldMatch = bold.exec(value))) {
      if (boldMatch.index > start)
        fragments.push(value.slice(start, boldMatch.index));
      fragments.push(
        <strong key={`${key}-bold-${boldMatch.index}`}>{boldMatch[1]}</strong>,
      );
      start = boldMatch.index + boldMatch[0].length;
    }
    if (start < value.length) fragments.push(value.slice(start));
    return fragments.length ? fragments : value;
  };
  return (
    <p>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <span key={`text-${index}`}>{renderText(part, `text-${index}`)}</span>
        ) : (
          <a
            className="wa-message-link"
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            key={`${part.url}-${index}`}
          >
            {part.url}
          </a>
        ),
      )}
    </p>
  );
}

const mediaSource = (media: MessageMedia) =>
  media.data
    ? /^https?:\/\//i.test(media.data)
      ? media.data
      : `data:${media.mimetype};base64,${media.data}`
    : "";

function MessageAttachment({
  message,
  config,
  chatId,
}: {
  message: Message;
  config: Config;
  chatId: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const inlineVideoRef = useRef<HTMLVideoElement>(null);
  const viewerVideoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState(
    message.media ? mediaSource(message.media) : "",
  );
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const media = message.media;
  const mime = media?.mimetype.toLowerCase() || "";
  const isImage =
    message.type === "image" ||
    message.type === "sticker" ||
    mime.startsWith("image/");
  const isVideo =
    message.type === "video" ||
    message.type === "gif" ||
    mime.startsWith("video/");
  const isAudio =
    ["audio", "voice", "ptt"].includes(message.type) ||
    mime.startsWith("audio/");
  const closeViewer = useCallback(() => {
    viewerVideoRef.current?.pause();
    setViewerOpen(false);
  }, []);
  const openViewer = () => {
    inlineVideoRef.current?.pause();
    setViewerOpen(true);
  };
  useEffect(() => {
    if (!viewerOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeViewer();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeViewer, viewerOpen]);
  useEffect(() => {
    if (!media) return;
    if (media.data) {
      setSource(mediaSource(media));
      setFailed(false);
      return;
    }
    const element = host.current;
    if (!element) return;
    let active = true,
      objectUrl = "";
    const load = async () => {
      try {
        const response = await request(
          config,
          `/sessions/${encodeURIComponent(config.sessionId)}/messages/${encodeURIComponent(chatId)}/${encodeURIComponent(message.id)}/media`,
        );
        if (response.ok) {
          objectUrl = URL.createObjectURL(await response.blob());
          if (active) {
            setSource(objectUrl);
            setFailed(false);
          }
          return;
        }
        // Older rows may only contain the media envelope. Ask the connected WhatsApp session for
        // the recent message again so a retry can recover it without opening another page.
        const historyResponse = await request(
          config,
          `/sessions/${encodeURIComponent(config.sessionId)}/messages/${encodeURIComponent(chatId)}/history?limit=100&includeMedia=true`,
        );
        if (!historyResponse.ok) throw new Error("Mídia indisponível");
        const wanted = new Set(
          message.identityIds?.length
            ? message.identityIds.flatMap(messageIdentityIds)
            : messageIdentityIds(message.id),
        );
        const record = listFrom(await historyResponse.json()).find((item) => {
          const ids = [item.waMessageId, item.messageId, item.id]
            .map(serializedMessageId)
            .filter(Boolean)
            .flatMap(messageIdentityIds);
          return ids.some((id) => wanted.has(id));
        });
        const recovered = record
          ? toMessage(record, "history").media
          : undefined;
        if (!recovered?.data) throw new Error("Mídia indisponível");
        if (active) {
          setSource(mediaSource(recovered));
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [chatId, config, media, message.id, retry]);
  if (!media) return null;
  const visual =
    source && isImage ? (
      <button
        className="wa-image-expand"
        onClick={openViewer}
        aria-label="Ampliar imagem"
      >
        <img
          className="wa-media-image"
          src={source}
          alt={message.type === "sticker" ? "Figurinha" : "Imagem"}
        />
      </button>
    ) : source && isVideo ? (
      <video
        ref={inlineVideoRef}
        className="wa-media-video"
        controls
        preload="metadata"
        playsInline
        src={source}
        onDoubleClick={openViewer}
        title="Clique duas vezes para ampliar"
      />
    ) : source && isAudio ? (
      <audio
        className="wa-media-audio"
        controls
        preload="metadata"
        src={source}
      />
    ) : source && message.type === "document" ? (
      <a
        className="wa-document"
        href={source}
        download={media.filename || "arquivo"}
      >
        Baixar {media.filename || "documento"}
      </a>
    ) : null;
  return (
    <div ref={host} className="wa-media-container">
      {visual || (
        <button
          className="wa-media-placeholder"
          onClick={() => setRetry((value) => value + 1)}
        >
          {failed
            ? "Mídia indisponível · tentar novamente"
            : "Carregando mídia…"}
        </button>
      )}
      {viewerOpen && source && (isImage || isVideo) && (
        <div
          className="wa-media-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={
            isVideo ? "Visualizador de vídeo" : "Visualizador de imagem"
          }
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeViewer();
          }}
        >
          <div className="wa-media-viewer-card">
            <header>
              <strong>
                {media.filename || (isVideo ? "Vídeo" : "Imagem")}
              </strong>
              <button onClick={closeViewer} aria-label="Fechar visualizador">
                <X size={22} />
              </button>
            </header>
            {isVideo ? (
              <video
                ref={viewerVideoRef}
                controls
                autoPlay
                playsInline
                src={source}
              />
            ) : (
              <img
                className="wa-media-viewer-image"
                src={source}
                alt="Imagem ampliada"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [overview, setOverview] = useState<SupportOverview>(emptyOverview);
  const [closingTickets, setClosingTickets] = useState<Set<string>>(
    () => new Set(),
  );
  const [profileReload, setProfileReload] = useState(0);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [teamChatOpen, setTeamChatOpen] = useState(false);
  const [teamRoom, setTeamRoom] = useState("group");
  const [teamUnread, setTeamUnread] = useState(0);
  const [teamAlerts, setTeamAlerts] = useState<TeamAlert[]>([]);
  const [syncWarning, setSyncWarning] = useState("");
  const [transferId, setTransferId] = useState("");
  const readVersions = useRef(new Map<string, number>());
  const pendingReads = useRef(new Set<string>());
  const lastReadAttempt = useRef(new Map<string, number>());
  const refreshGeneration = useRef(0);
  const [config, setConfig] = useState<Config>(emptyConfig);
  const [status, setStatus] = useState<
    "unconfigured" | "offline" | "ready" | "connected"
  >("unconfigured");
  const [notice, setNotice] = useState("");
  const [chats, setChats] = useState<Chat[]>([]);
  const [selected, setSelected] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [forwardTarget, setForwardTarget] = useState<{ message: Message; chatId: string } | null>(null);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardToIds, setForwardToIds] = useState<string[]>([]);
  const [forwardBusy, setForwardBusy] = useState(false);
  const [forwardError, setForwardError] = useState("");
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const profileDirtyRef = useRef(false);
  const [assignments, setAssignments] = useState<Record<string, Assignment>>(
    {},
  );
  const [operator, setOperator] = useState<Operator | null>(null);
  const [operatorToken, setOperatorToken] = useState("");
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [activityMenuOpen, setActivityMenuOpen] = useState(false);
  const activityControlRef = useRef<HTMLDivElement>(null);
  const [activityNoteDraft, setActivityNoteDraft] = useState("");
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [onsiteClient, setOnsiteClient] = useState("");
  const [onsiteVisits, setOnsiteVisits] = useState<{id:string;clientName:string;startedAt:string;endedAt:string|null;durationSeconds?:number|null}[]>([]);
  const [onsiteLoading, setOnsiteLoading] = useState(false);
  useEffect(() => { setOnsiteVisits([]); }, [operatorToken]);
  const [registering, setRegistering] = useState(false);
  const [operatorUsername, setOperatorUsername] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [operatorPassword, setOperatorPassword] = useState("");
  const [operatorError, setOperatorError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [account, setAccount] = useState<Account>({
    name: "WhatsApp",
    phone: "",
  });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "mine">("all");
  const [tagFilter, setTagFilter] = useState("");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterMenuPage, setFilterMenuPage] = useState<"main" | "tags">("main");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const [pastedTextPending, setPastedTextPending] = useState(false);
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickReplyIndex, setQuickReplyIndex] = useState(0);
  const [quickReplyDismissed, setQuickReplyDismissed] = useState(false);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const quickReplyQuery = /^\/[a-z0-9_-]*$/i.test(draft) ? draft.slice(1).toLowerCase() : null;
  const quickReplyMatches = quickReplyQuery === null ? [] : quickReplies.filter(reply => reply.shortcut.startsWith(quickReplyQuery));
  const quickReplyOpen = quickReplyQuery !== null && !quickReplyDismissed;
  function insertQuickReply(reply: QuickReply) {
    setDraft(reply.text); setPastedTextPending(false); setQuickReplyDismissed(true);
    requestAnimationFrame(() => { composerInputRef.current?.focus(); composerInputRef.current?.setSelectionRange(reply.text.length, reply.text.length); });
  }
  const [busy, setBusy] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contactsReady, setContactsReady] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [messageAlerts, setMessageAlerts] = useState<
    { id: string; chatId: string; name: string; body: string }[]
  >([]);
  const notificationsRef = useRef(false);
  const notificationPreferencesRef = useRef<NotificationPreferences>(
    defaultNotificationPreferences,
  );
  const notifiedIds = useRef(new Set<string>());
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiToggleRef = useRef<HTMLButtonElement>(null);
  const emojiMenuRef = useRef<HTMLDivElement>(null);
  const [flows, setFlows] = useState<ConversationFlow[]>([]);
  const [flowMenuOpen, setFlowMenuOpen] = useState(false);
  const flowToggleRef = useRef<HTMLButtonElement>(null);
  const flowMenuRef = useRef<HTMLDivElement>(null);
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>(defaultNotificationPreferences);
  const [qr, setQr] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactCountryCode, setContactCountryCode] = useState("55");
  const [contactFormError, setContactFormError] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messageAreaRef = useRef<HTMLDivElement | null>(null);
  const keepAtBottomRef = useRef(true);
  const scrolledChatRef = useRef("");
  const historyCacheRef = useRef(new Map<string, MessageWithTimestamp[]>());
  const profilePicturesRef = useRef(new Map<string, string | null>());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chatsRef = useRef<Chat[]>([]);
  const selectedRef = useRef<Chat | null>(null);
  const refreshChatsRef = useRef<(active?: Config) => Promise<void>>(
    async () => undefined,
  );
  const refreshMessagesRef = useRef<
    (chat: Chat, active?: Config, loadLiveHistory?: boolean) => Promise<void>
  >(async () => undefined);
  const operatorRef = useRef<Operator | null>(null);

  useEffect(() => {
    if (!filterMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!filterPopoverRef.current?.contains(event.target as Node)) {
        setFilterMenuOpen(false);
        setFilterMenuPage("main");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFilterMenuOpen(false);
      setFilterMenuPage("main");
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [filterMenuOpen]);

  useEffect(() => {
    setActivityMenuOpen(false);
    setFlowMenuOpen(false);
    setEmojiOpen(false);
    setFilterMenuOpen(false);
  }, [settingsOpen, operatorOpen, newChatOpen, dashboardOpen, contactsOpen, teamChatOpen]);

  useEffect(() => {
    if (!activityMenuOpen && !flowMenuOpen && !emojiOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (activityMenuOpen && !activityControlRef.current?.contains(target)) setActivityMenuOpen(false);
      if (flowMenuOpen && !flowToggleRef.current?.contains(target) && !flowMenuRef.current?.contains(target)) setFlowMenuOpen(false);
      if (emojiOpen && !emojiToggleRef.current?.contains(target) && !emojiMenuRef.current?.contains(target)) setEmojiOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [activityMenuOpen, flowMenuOpen, emojiOpen]);

  function playNotificationSound() {
    try {
      const context = audioContextRef.current;
      const preferences = notificationPreferencesRef.current;
      if (!context || !preferences.sound || preferences.volume <= 0) return;
      const patterns = {
        classic: [[880, 0, 0.14]],
        soft: [
          [660, 0, 0.12],
          [784, 0.14, 0.13],
        ],
        bell: [
          [1046, 0, 0.16],
          [1318, 0.18, 0.2],
        ],
        urgent: [
          [880, 0, 0.12],
          [880, 0.18, 0.12],
          [1175, 0.36, 0.24],
        ],
      } as Record<NotificationPreferences["soundType"], number[][]>;
      for (const [frequency, offset, duration] of patterns[
        preferences.soundType
      ]) {
        const oscillator = context.createOscillator(),
          gain = context.createGain(),
          start = context.currentTime + offset;
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(
          Math.max(0.001, (preferences.volume / 100) * 0.12),
          start,
        );
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + duration);
      }
    } catch {
      /* Sound is optional when a browser blocks audio playback. */
    }
  }
  function updateNotificationPreferences(
    patch: Partial<NotificationPreferences>,
  ) {
    const next = { ...notificationPreferencesRef.current, ...patch };
    notificationPreferencesRef.current = next;
    notificationsRef.current = next.enabled;
    setNotificationPreferences(next);
    setNotificationsEnabled(next.enabled);
    localStorage.setItem(notificationStorageKey, JSON.stringify(next));
  }
  async function enableNotifications() {
    try {
      if (!audioContextRef.current)
        audioContextRef.current = new AudioContext();
      await audioContextRef.current.resume();
      updateNotificationPreferences({ enabled: true });
      let permission: NotificationPermission = "default";
      if (window.isSecureContext && "Notification" in window)
        permission =
          Notification.permission === "default"
            ? await Notification.requestPermission()
            : Notification.permission;
      playNotificationSound();
      setNotice(
        permission === "granted"
          ? "Som e notificações ativados neste computador."
          : "Som e avisos no canto da tela ativados. Mantenha o sistema aberto. Notificações fora da página exigem HTTPS e permissão do navegador.",
      );
    } catch {
      setNotice(
        "Não foi possível ativar o som. Clique novamente em Notificações.",
      );
    }
  }
  async function testNotification() {
    try {
      if (!audioContextRef.current)
        audioContextRef.current = new AudioContext();
      await audioContextRef.current.resume();
      playNotificationSound();
      if (
        window.isSecureContext &&
        notificationPreferencesRef.current.desktop &&
        "Notification" in window
      ) {
        const permission =
          Notification.permission === "default"
            ? await Notification.requestPermission()
            : Notification.permission;
        if (permission === "granted")
          new Notification("Teste de notificação", {
            body: "Cada nova mensagem terá um aviso separado.",
            tag: `atende-test-${Date.now()}`,
          });
      }
      setNotice("Teste de notificação executado.");
    } catch {
      setNotice(
        "O navegador bloqueou o teste. Revise a permissão de notificações.",
      );
    }
  }
  useEffect(() => {
    const saved = loadNotificationPreferences();
    notificationPreferencesRef.current = saved;
    notificationsRef.current = saved.enabled;
    setNotificationPreferences(saved);
    setNotificationsEnabled(saved.enabled);
  }, []);
  const loadFlows = useCallback(async () => {
    if (!operatorToken) return;
    try {
      const response = await fetch(
        `${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/flows`,
        { headers: { "X-Atende-Token": operatorToken } },
      );
      if (!response.ok)
        throw new Error(errorMessage(await response.json().catch(() => null)));
      const data = (await response.json()) as ConversationFlow[];
      setFlows(data.filter((flow) => flow.active));
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar os fluxos.",
      );
    }
  }, [config.baseUrl, operatorToken]);
  useEffect(() => {
    if (!operatorToken || quickReplyQuery === null) return;
    const abort = new AbortController();
    fetch(`${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/quick-replies`, { signal: abort.signal, headers: { "X-Atende-Token": operatorToken } })
      .then(async response => { if (!response.ok) throw new Error("Não foi possível carregar as mensagens rápidas."); return await response.json() as QuickReply[]; })
      .then(setQuickReplies).catch(error => { if (!abort.signal.aborted) setNotice(error.message); });
    return () => abort.abort();
  }, [config.baseUrl, operatorToken, quickReplyQuery !== null]);
  useEffect(() => { setQuickReplyIndex(0); setQuickReplyDismissed(false); }, [draft]);
  useEffect(() => {
    void loadFlows();
  }, [loadFlows]);
  const showMessageAlert = useCallback(
    (alert: { id: string; chatId: string; name: string; body: string }) => {
      setMessageAlerts((current) =>
        [
          ...current.filter((item) => item.chatId !== alert.chatId),
          alert,
        ].slice(-4),
      );
      window.setTimeout(
        () =>
          setMessageAlerts((current) =>
            current.filter((item) => item.id !== alert.id),
          ),
        8000,
      );
    },
    [],
  );

  useEffect(() => {
    if (!operatorToken) { setTeamUnread(0); setTeamAlerts([]); return; }
    let stopped = false, polling = false, cursorAt = "", cursorId = "";
    const root = `${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/team-chat`;
    const headers = { "X-Atende-Token": operatorToken };
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const query = cursorAt ? `?afterAt=${encodeURIComponent(cursorAt)}&afterId=${encodeURIComponent(cursorId)}` : "";
        const alertsResponse = await fetch(`${root}/alerts${query}`, { headers });
        if (!alertsResponse.ok) return;
        const result = await alertsResponse.json() as { cursorAt: string; cursorId: string; unreadCount: number; alerts: { id: string; recipientId: string | null; senderName: string; body: string; mentioned: boolean }[] };
        if (stopped) return;
        cursorAt = result.cursorAt;
        cursorId = result.cursorId;
        setTeamUnread(Number(result.unreadCount || 0));
        for (const item of result.alerts) {
          const alert: TeamAlert = { id: item.id, room: item.recipientId || "group", senderName: item.senderName, body: item.body, mentioned: item.mentioned };
          setTeamAlerts(current => [...current, alert].slice(-4));
          window.setTimeout(() => setTeamAlerts(current => current.filter(existing => existing.id !== item.id)), 8000);
          const preferences = notificationPreferencesRef.current;
          if (!notificationsRef.current || !preferences.notifyMessages) continue;
          playNotificationSound();
          if (preferences.desktop && window.isSecureContext && typeof Notification !== "undefined" && Notification.permission === "granted") {
            const desktop = new Notification(item.mentioned ? `${item.senderName} mencionou você` : `Mensagem da equipe · ${item.senderName}`, {
              body: preferences.showPreview ? item.body : "Nova mensagem interna",
              tag: `atende-team-${item.id}`,
            });
            desktop.onclick = () => { window.focus(); setTeamRoom(alert.room); setTeamChatOpen(true); setContactsOpen(false); setDashboardOpen(false); desktop.close(); };
          }
        }
      } catch { /* A próxima atualização tenta novamente quando a rede voltar. */ }
      finally { polling = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [config.baseUrl, operatorToken]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      () => setNotice((current) => (current === notice ? "" : current)),
      5000,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!contactsOpen) {
      setContactsReady(false);
      return;
    }
    // Give the browser a paint with the loading view before mounting thousands of contact rows.
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setContactsReady(true));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [contactsOpen]);

  const refreshChats = useCallback(
    async (active = config) => {
      if (!active.apiKey || !active.sessionId) return;
      const generation = ++refreshGeneration.current;
      const readSnapshot = new Map(readVersions.current);
      const [metaResponse, response] = await Promise.all([
        request(
          active,
          `/operator-auth/contacts/${encodeURIComponent(active.sessionId)}`,
        ),
        request(
          active,
          `/sessions/${encodeURIComponent(active.sessionId)}/chats?limit=1000`,
        ).catch(() => null),
      ]);
      if (!metaResponse.ok)
        throw new Error("Não foi possível atualizar os perfis dos contatos.");
      const meta = (await metaResponse.json()) as SupportOverview;
      const live = !!response?.ok;
      let data: Record<string, unknown>[] = live
        ? listFrom(await response!.json())
        : meta.activity.map((a) => ({
            id: a.chatId,
            name: a.name || "Contato sem nome",
            timestamp: Math.max(Number(a.incoming), Number(a.outgoing)),
            lastMessage: "Histórico salvo",
          }));
      while (live && data.length > 0 && data.length % 1000 === 0) {
        const page = await request(
          active,
          `/sessions/${encodeURIComponent(active.sessionId)}/chats?limit=1000&offset=${data.length}`,
        );
        if (!page.ok)
          throw new Error("Não foi possível carregar todas as conversas.");
        const batch = listFrom(await page.json());
        data = [...data, ...batch];
        if (batch.length < 1000) break;
      }
      if (generation !== refreshGeneration.current) return;
      setSyncWarning(
        live
          ? ""
          : "WhatsApp ainda não sincronizado. Exibindo os dados salvos; novas mensagens e leitura dependem da reconexão.",
      );
      if (live) setStatus("ready");
      if (!live && chatsRef.current.length)
        data = chatsRef.current.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          lastMessage: c.last,
          unreadCount: c.unread,
        }));
      setOverview(meta);
      let next = listFrom(data)
        .filter(
          (chat) =>
            chat.isGroup !== true &&
            !/@(g\.us|broadcast|newsletter)$/.test(String(chat.id || "")),
        )
        .map((value) => {
          const chat = toChat(value),
            profile = meta.contacts.find((p) => p.chatId === chat.id)?.data;
          return {
            ...chat,
            name: profile?.name || chat.name,
            phone:
              profile?.phone ||
              String(
                value.phone ||
                  (/@(c\.us|s\.whatsapp\.net)$/.test(chat.id)
                    ? chat.id.split("@")[0]
                    : ""),
              ),
            avatar: profilePicturesRef.current.get(chat.id) || undefined,
            unread:
              pendingReads.current.has(chat.id) ||
              readSnapshot.get(chat.id) !== readVersions.current.get(chat.id)
                ? 0
                : chat.unread,
          };
        });
      if (live) {
        const missing = next
          .filter((chat) => !profilePicturesRef.current.has(chat.id))
          .slice(0, 50);
        if (missing.length) {
          const picturesResponse = await request(
            active,
            `/sessions/${encodeURIComponent(active.sessionId)}/contacts/profile-pictures?ids=${encodeURIComponent(missing.map((chat) => chat.id).join(","))}`,
          ).catch(() => null);
          if (picturesResponse?.ok) {
            const result = (await picturesResponse.json()) as {
              pictures?: Record<string, string | null>;
            };
            for (const chat of missing)
              profilePicturesRef.current.set(
                chat.id,
                result.pictures?.[chat.id] || null,
              );
            next = next.map((chat) => ({
              ...chat,
              avatar: profilePicturesRef.current.get(chat.id) || undefined,
            }));
          }
        }
      }
      setChats(next);
      setSelected((current) =>
        current ? next.find((c) => c.id === current.id) || current : null,
      );
      const owners = await request(
        active,
        `/sessions/${encodeURIComponent(active.sessionId)}/conversations/assignments`,
      );
      if (owners.ok) {
        const rows = (await owners.json()) as (Assignment & {
          chatId: string;
        })[];
        if (generation !== refreshGeneration.current) return;
        setAssignments(
          Object.fromEntries(rows.map((row) => [row.chatId, row])),
        );
        if (selectedRef.current)
          setAssignment(
            rows.find((row) => row.chatId === selectedRef.current?.id) || null,
          );
      }
    },
    [config],
  );

  async function markRead(chatId: string, active = config) {
    if (pendingReads.current.has(chatId)) return;
    lastReadAttempt.current.set(chatId, Date.now());
    pendingReads.current.add(chatId);
    readVersions.current.set(
      chatId,
      (readVersions.current.get(chatId) || 0) + 1,
    );
    setChats((current) =>
      current.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)),
    );
    try {
      const response = await request(
        active,
        `/sessions/${encodeURIComponent(active.sessionId)}/chats/read`,
        { method: "POST", body: JSON.stringify({ chatId }) },
      );
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(
          "O WhatsApp não confirmou a leitura. Tente abrir a conversa novamente.",
        );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Erro ao sincronizar leitura.",
      );
    } finally {
      pendingReads.current.delete(chatId);
      readVersions.current.set(
        chatId,
        (readVersions.current.get(chatId) || 0) + 1,
      );
      void refreshChatsRef.current(active).catch(() => undefined);
    }
  }

  useEffect(() => {
    const acknowledge = () => {
      const chat = chats.find((c) => c.id === selected?.id);
      if (
        chat?.unread &&
        Date.now() - (lastReadAttempt.current.get(chat.id) || 0) > 15000 &&
        !dashboardOpen &&
        !teamChatOpen &&
        !settingsOpen &&
        !operatorOpen &&
        document.visibilityState === "visible" &&
        document.hasFocus()
      )
        void markRead(chat.id);
    };
    acknowledge();
    window.addEventListener("focus", acknowledge);
    document.addEventListener("visibilitychange", acknowledge);
    return () => {
      window.removeEventListener("focus", acknowledge);
      document.removeEventListener("visibilitychange", acknowledge);
    };
  }, [chats, selected?.id, dashboardOpen, teamChatOpen, settingsOpen, operatorOpen]);

  const refreshMessages = useCallback(
    async (chat: Chat, active = config, loadLiveHistory = false) => {
      if (!active.apiKey || !active.sessionId || !chat.id) return;
      const localPath = `/sessions/${encodeURIComponent(active.sessionId)}/messages?chatId=${encodeURIComponent(chat.id)}&limit=100&inlineMedia=true`;
      const historyPath = `/sessions/${encodeURIComponent(active.sessionId)}/messages/${encodeURIComponent(chat.id)}/history?limit=2000&deep=true`;
      const response = await request(
        active,
        loadLiveHistory ? historyPath : localPath,
      );
      if (!response.ok && loadLiveHistory) {
        const fallback = await request(active, localPath);
        if (!fallback.ok)
          throw new Error(
            errorMessage(await fallback.json().catch(() => null)),
          );
        const data = await fallback.json();
        const fallbackMessages = mergeMessages(
          listFrom(data, "messages")
            .filter((value) => value.status !== "pending" && value.status !== "failed")
            .map((value) => toMessage(value, "database"))
            .filter((message) => message.body),
        );
        historyCacheRef.current.set(chat.id, fallbackMessages);
        if (selectedRef.current?.id === chat.id) setMessages(fallbackMessages);
        setNotice(
          "O histórico ao vivo não respondeu; exibindo as mensagens já salvas.",
        );
        return;
      }
      if (!response.ok)
        throw new Error(errorMessage(await response.json().catch(() => null)));
      const data = await response.json();
      const applyRecords = (
        records: Record<string, unknown>[],
        source: "database" | "history",
        replace = false,
      ) => {
        const incoming = records
          .filter((value) => source !== "database" || (value.status !== "pending" && value.status !== "failed"))
          .map((value, index) => ({ ...toMessage(value, source), ...(source === "history" && replace ? { historyOrder: index } : {}) }))
          .filter((message) => message.body);
        const combined = replace
          ? [...(historyCacheRef.current.get(chat.id) || []).filter(message => message.source === "optimistic"), ...incoming]
          : [...(historyCacheRef.current.get(chat.id) || []), ...incoming];
        const next = mergeMessages(combined);
        historyCacheRef.current.set(chat.id, next);
        if (selectedRef.current?.id === chat.id) setMessages(next);
      };
      applyRecords(
        listFrom(data, loadLiveHistory ? undefined : "messages"),
        loadLiveHistory ? "history" : "database",
        loadLiveHistory,
      );
      if (loadLiveHistory) {
        request(
          active,
          `/sessions/${encodeURIComponent(active.sessionId)}/messages/${encodeURIComponent(chat.id)}/history?limit=100&includeMedia=true`,
        )
          .then(async (mediaResponse) => {
            if (mediaResponse.ok)
              applyRecords(listFrom(await mediaResponse.json()), "history");
          })
          .catch(() => undefined);
      }
    },
    [config],
  );

  const refreshAccount = useCallback(
    async (active = config) => {
      if (!active.apiKey || !active.sessionId) return;
      const response = await request(active, "/sessions?limit=100");
      if (!response.ok) return;
      const session = listFrom(await response.json()).find(
        (item) => String(item.id || item.sessionId) === active.sessionId,
      );
      if (session)
        setAccount({
          name: String(session.pushName || session.name || "WhatsApp"),
          phone: String(session.phone || ""),
        });
    },
    [config],
  );

  useEffect(() => {
    const saved = loadConfig();
    setDetailsOpen(window.innerWidth > 1250);
    const savedOperator = loadOperator();
    setAuthLoaded(true);
    setConfig(saved);
    if (savedOperator) {
      setOperatorToken(savedOperator.token);
      fetch(`${saved.baseUrl.replace(/\/$/, "")}/api/operator-auth/me`, {
        headers: { "X-Atende-Token": savedOperator.token },
      })
        .then(async (response) => {
          if (!response.ok) {
            persistOperator(null);
            setOperatorToken("");
            return;
          }
          const user = (await response.json()) as Operator;
          setOperator(user);
          setOperatorName(user.displayName);
        })
        .catch(() =>
          setOperatorError(
            "Não foi possível acessar o servidor. Tente entrar novamente.",
          ),
        );
    } else setOperatorOpen(true);
    if (saved.apiKey) setSettingsOpen(!saved.sessionId);
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);
  useEffect(() => {
    if (
      !operatorToken ||
      (config.apiKey && !config.apiKey.startsWith("atende_"))
    )
      return;
    const credential = `atende_${operatorToken}`;
    if (config.apiKey === credential && config.sessionId) return;
    const controller = new AbortController();
    void fetch(
      `${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/connection`,
      {
        headers: { "X-Atende-Token": operatorToken },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(errorMessage(result));
        if (!controller.signal.aborted) {
          setConfig((current) => ({
            ...current,
            apiKey: credential,
            sessionId: result.sessionId,
          }));
          setNotice("Carregando as conversas da equipe…");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setNotice(
            error instanceof Error
              ? error.message
              : "Não foi possível carregar a conexão da equipe.",
          );
      });
    return () => controller.abort();
  }, [operatorToken, config.baseUrl, config.apiKey, config.sessionId]);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    operatorRef.current = operator;
  }, [operator]);
  useEffect(() => {
    if (!operatorToken) return;
    let live = true;
    async function refreshAccess() {
      try {
        const response = await request(config, "/operator-auth/me");
        if (!live) return;
        if (response.status === 401) {
          persistOperator(null);
          setOperator(null);
          setOperatorToken("");
          setSelected(null);
          setMessages([]);
          setChats([]);
          socketRef.current?.disconnect();
          setOperatorError(
            "Sua sessão expirou ou a conta foi desativada. Entre novamente.",
          );
        } else if (response.ok) {
          const user = (await response.json()) as Operator;
          if (live) {
            setOperator(user);
            persistOperator({ user, token: operatorToken });
          }
        }
      } catch {
        /* A network outage does not erase the saved session. */
      }
    }
    const timer = window.setInterval(refreshAccess, 15000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [operatorToken, config.baseUrl]);
  useEffect(() => {
    refreshChatsRef.current = refreshChats;
    refreshMessagesRef.current = refreshMessages;
  }, [refreshChats, refreshMessages]);
  useEffect(() => {
    if (!operatorToken) return;
    if (!config.apiKey || !config.sessionId) return;
    const active = config;
    refreshChats(active).catch(() => undefined);
    refreshAccount(active).catch(() => undefined);
  }, [config.apiKey, config.baseUrl, config.sessionId, operatorToken]);
  useEffect(() => {
    if (!operatorToken) return;
    if (!config.apiKey || !config.sessionId) return;
    const active = config;
    const socket = io(`${active.baseUrl.replace(/\/$/, "")}/events`, {
      auth: { apiKey: active.apiKey },
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
    socket.on("connect", () => {
      setStatus("connected");
      socket.emit("message", {
        type: "subscribe",
        sessionId: active.sessionId,
        events: [
          "message.received",
          "message.sent",
          "conversation.assigned",
          "session.status",
          "session.qr",
        ],
        requestId: eventId(),
      });
    });
    socket.on(
      "message",
      (event: {
        type?: string;
        payload?: {
          event?: string;
          sessionId?: string;
          data?: Record<string, unknown>;
        };
      }) => {
        if (
          event.type !== "event" ||
          event.payload?.sessionId !== active.sessionId
        )
          return;
        if (event.payload.event === "session.qr")
          setQr(String(event.payload.data?.qrCode || ""));
        if (
          event.payload.event === "message.received" ||
          event.payload.event === "message.sent"
        ) {
          refreshChatsRef.current(active).catch(() => undefined);
          const current = selectedRef.current;
          if (current)
            refreshMessagesRef.current(current, active).catch(() => undefined);
        }
        if (event.payload.event === "message.received") {
          const data = event.payload.data || {};
          const chatId = String(data.chatId || data.from || "");
          if (
            !chatId ||
            /@(g\.us|broadcast|newsletter)$/.test(chatId) ||
            data.isGroup === true
          )
            return;
          const notificationOperatorId = operatorRef.current?.id;
          void request(
            active,
            `/operator-auth/notification?sessionId=${encodeURIComponent(active.sessionId)}&chatId=${encodeURIComponent(chatId)}`,
          )
            .then(async (response) => {
              const eligibility = response.ok
                ? ((await response.json()) as { allowed: boolean })
                : null;
              const currentOperator = operatorRef.current;
              const preferences = notificationPreferencesRef.current;
              if (
                !currentOperator ||
                !eligibility?.allowed ||
                currentOperator.id !== notificationOperatorId ||
                !notificationsRef.current ||
                !preferences.notifyMessages
              )
                return;
              const notificationId = String(
                data.id || data.messageId || data.waMessageId || eventId(),
              );
              if (notifiedIds.current.has(notificationId)) return;
              notifiedIds.current.add(notificationId);
              if (notifiedIds.current.size > 500)
                notifiedIds.current.delete(
                  notifiedIds.current.values().next().value!,
                );
              const sender =
                chatsRef.current.find((chat) => chat.id === chatId)?.name ||
                String(
                  data.chatName || data.author || data.from || "Novo contato",
                );
              const body = String(data.body || data.text || "Nova mensagem");
              playNotificationSound();
              showMessageAlert({
                id: notificationId,
                chatId,
                name: sender,
                body,
              });
              if (
                preferences.desktop &&
                window.isSecureContext &&
                typeof Notification !== "undefined" &&
                Notification.permission === "granted"
              )
                new Notification(sender, {
                  body: preferences.showPreview
                    ? body
                    : "Nova mensagem recebida",
                  tag: `atende-${chatId}-${notificationId}`,
                  renotify: true,
                });
            })
            .catch(() => undefined);
        }
        if (event.payload.event === "conversation.assigned") {
          const data = event.payload.data || {},
            currentOperator = operatorRef.current;
          const assigneeId = String(data.assigneeId || ""),
            assignedById = String(data.assignedById || "");
          if (
            !currentOperator ||
            assigneeId !== currentOperator.id ||
            assignedById === currentOperator.id
          )
            return;
          const chatId = String(data.chatId || "");
          if (!chatId) return;
          void refreshChatsRef.current(active).catch(() => undefined);
          const customer =
            chatsRef.current.find((chat) => chat.id === chatId)?.name ||
            "Novo atendimento";
          const assignedBy = String(data.assignedByName || "outro atendente");
          const body = `Atendimento encaminhado por ${assignedBy}.`;
          showMessageAlert({
            id: `assignment-${chatId}-${String(data.updatedAt || Date.now())}`,
            chatId,
            name: customer,
            body,
          });
          const preferences = notificationPreferencesRef.current;
          if (notificationsRef.current && preferences.notifyAssignments) {
            playNotificationSound();
            if (
              preferences.desktop &&
              window.isSecureContext &&
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            )
              new Notification("Novo atendimento atribuído", {
                body: preferences.showPreview
                  ? `${customer} · ${body}`
                  : "Você recebeu um novo atendimento.",
                tag: `atende-assignment-${chatId}-${String(data.updatedAt || Date.now())}`,
                renotify: true,
              });
          }
        }
        if (event.payload.event === "session.status")
          setStatus(
            String(event.payload.data?.status).toLowerCase() === "connected"
              ? "connected"
              : "ready",
          );
      },
    );
    socket.on("connect_error", () =>
      setNotice(
        "Não foi possível ouvir os eventos agora; tentando reconectar automaticamente.",
      ),
    );
    socketRef.current = socket;
    return () => {
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [
    config.apiKey,
    config.baseUrl,
    config.sessionId,
    operatorToken,
    showMessageAlert,
  ]);
  useEffect(() => {
    if (!config.apiKey || !config.sessionId) return;
    const interval = window.setInterval(() => {
      refreshChats().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(interval);
  }, [config.apiKey, config.baseUrl, config.sessionId, refreshChats]);
  useEffect(() => {
    const chatChanged = scrolledChatRef.current !== (selected?.id || "");
    if (chatChanged) {
      scrolledChatRef.current = selected?.id || "";
      keepAtBottomRef.current = true;
    }
    if (!keepAtBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages, selected?.id]);

  async function connect(active = config) {
    if (!active.apiKey) {
      setNotice("Informe a chave da API do OpenWA.");
      return;
    }
    setBusy(true);
    try {
      const health = await fetch(
        `${active.baseUrl.replace(/\/$/, "")}/api/health`,
      );
      if (!health.ok) throw new Error("O OpenWA respondeu com erro.");
      let sessionId = active.sessionId;
      if (!sessionId) {
        const response = await request(active, "/sessions?limit=100");
        const data = await response.json();
        const first = listFrom(data)[0];
        if (first) sessionId = String(first.id || first.sessionId);
      }
      const next = { ...active, sessionId };
      setConfig(next);
      persistConfig(next);
      if (sessionId) {
        const sessionResponse = await request(
          next,
          `/sessions/${encodeURIComponent(sessionId)}`,
        );
        if (!sessionResponse.ok)
          throw new Error(
            errorMessage(await sessionResponse.json().catch(() => null)),
          );
        const session = (await sessionResponse.json()) as { status?: string };
        if (
          ["failed", "disconnected", "created"].includes(
            String(session.status).toLowerCase(),
          )
        ) {
          setNotice("Restaurando a sessão existente do WhatsApp…");
          const restored = await request(
            next,
            `/sessions/${encodeURIComponent(sessionId)}/start`,
            { method: "POST" },
          );
          if (!restored.ok)
            throw new Error(
              errorMessage(await restored.json().catch(() => null)),
            );
        }
      }
      setStatus(sessionId ? "ready" : "offline");
      setNotice(
        sessionId
          ? "Conectado. Carregando suas conversas."
          : "Crie uma sessão para conectar o WhatsApp.",
      );
      if (sessionId) {
        await refreshChats(next);
        await refreshAccount(next);
      }
      setNotice("Conexão salva com sucesso.");
    } catch (error) {
      setStatus("offline");
      setNotice(
        error instanceof TypeError
          ? "Não foi possível acessar o OpenWA local."
          : error instanceof Error
            ? error.message
            : "Falha de conexão.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function createSession() {
    setBusy(true);
    try {
      const response = await request(config, "/sessions", {
        method: "POST",
        body: JSON.stringify({ name: `atende-${Date.now()}` }),
      });
      if (!response.ok)
        throw new Error(errorMessage(await response.json().catch(() => null)));
      const data = await response.json();
      const next = { ...config, sessionId: String(data.id || data.sessionId) };
      setConfig(next);
      persistConfig(next);
      await request(
        next,
        `/sessions/${encodeURIComponent(next.sessionId)}/start`,
        { method: "POST" },
      );
      const qrResponse = await request(
        next,
        `/sessions/${encodeURIComponent(next.sessionId)}/qr`,
      );
      const qrData = await qrResponse.json();
      setQr(String(qrData.qrCode || qrData.data || qrData));
      setStatus("ready");
      setNotice("Sessão criada. Leia o QR Code no WhatsApp da empresa.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível criar a sessão.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function chooseChat(chat: Chat) {
    if (
      selected?.id !== chat.id &&
      profileDirtyRef.current &&
      !window.confirm(
        "O perfil tem alterações não salvas. Deseja descartá-las e trocar de conversa?",
      )
    )
      return;
    setMessageAlerts((current) => current.filter((a) => a.chatId !== chat.id));
    selectedRef.current = chat;
    setTransferId("");
    void markRead(chat.id);
    setSelected(chat);
    setReplyingTo(null);
    setForwardTarget(null);
    setFlowMenuOpen(false);
    setEmojiOpen(false);
    setAssignment(null);
    setChats((current) =>
      current.map((item) =>
        item.id === chat.id ? { ...item, unread: 0 } : item,
      ),
    );
    void loadAssignment(chat);
    const cached = historyCacheRef.current.get(chat.id);
    if (cached) {
      setMessages(cached);
      setLoadingMessages(false);
      return;
    }
    setMessages([]);
    setLoadingMessages(true);
    try {
      await refreshMessages(chat, config, true);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar as mensagens.",
      );
    } finally {
      setLoadingMessages(false);
    }
  }
  function closeConversation() {
    if (
      profileDirtyRef.current &&
      !window.confirm("Descartar as alterações não salvas do perfil?")
    )
      return;
    setSelected(null);
    setReplyingTo(null);
    setForwardTarget(null);
    setFlowMenuOpen(false);
    setEmojiOpen(false);
  }
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (activityMenuOpen) {
        setActivityMenuOpen(false);
        return;
      }
      if (
        !selectedRef.current ||
        settingsOpen ||
        operatorOpen ||
        newChatOpen ||
        dashboardOpen ||
        teamChatOpen ||
        contactsOpen ||
        pendingPaste ||
        filterMenuOpen
      )
        return;
      if (flowMenuOpen || emojiOpen) {
        setFlowMenuOpen(false);
        setEmojiOpen(false);
        return;
      }
      if (forwardTarget) {
        if (!forwardBusy) setForwardTarget(null);
        return;
      }
      if (replyingTo) {
        setReplyingTo(null);
        return;
      }
      closeConversation();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [
    settingsOpen,
    operatorOpen,
    newChatOpen,
    dashboardOpen,
    teamChatOpen,
    contactsOpen,
    activityMenuOpen,
    pendingPaste,
    filterMenuOpen,
    flowMenuOpen,
    emojiOpen,
    forwardTarget,
    forwardBusy,
    replyingTo,
  ]);
  async function loadAssignment(chat: Chat, active = config) {
    if (!active.apiKey || !active.sessionId) return;
    try {
      const response = await request(
        active,
        `/sessions/${encodeURIComponent(active.sessionId)}/conversations/${encodeURIComponent(chat.id)}/assignment`,
      );
      if (!response.ok) return;
      const data = (await response.json()) as Assignment | null;
      if (selectedRef.current?.id === chat.id) setAssignment(data);
    } catch {
      /* A conversation can still be used if assignment data is temporarily unavailable. */
    }
  }
  async function saveAssignment(targetId?: string) {
    if (!selected || !operator) {
      setOperatorOpen(true);
      return;
    }
    setSavingAssignment(true);
    try {
      const response = await request(
        config,
        `/sessions/${encodeURIComponent(config.sessionId)}/conversations/${encodeURIComponent(selected.id)}/assignment`,
        {
          method: "PUT",
          body: JSON.stringify({
            assigneeName: operator.displayName,
            assigneeId: targetId || operator.id,
          }),
        },
      );
      if (!response.ok)
        throw new Error(errorMessage(await response.json().catch(() => null)));
      const owner = (await response.json()) as Assignment & {
        reopened?: boolean;
        profileData?: SupportOverview["contacts"][number]["data"];
      };
      setAssignment(owner);
      setAssignments((current) => ({ ...current, [selected.id]: owner }));
      setNotice("Conversa atribuída com sucesso.");
      if (owner.reopened && owner.profileData) {
        setOverview((current) => ({
          ...current,
          contacts: [
            ...current.contacts.filter(
              (contact) => contact.chatId !== selected.id,
            ),
            { chatId: selected.id, data: owner.profileData! },
          ],
        }));
        profileDirtyRef.current = false;
        setProfileReload((value) => value + 1);
        setNotice("Atendimento reaberto e encaminhado com sucesso.");
      }
      void refreshChats().catch(() => undefined);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível atribuir a conversa.",
      );
    } finally {
      setSavingAssignment(false);
    }
  }
  async function clearAssignment() {
    if (!selected) return;
    setSavingAssignment(true);
    try {
      const response = await request(
        config,
        `/sessions/${encodeURIComponent(config.sessionId)}/conversations/${encodeURIComponent(selected.id)}/assignment`,
        { method: "DELETE" },
      );
      if (!response.ok)
        throw new Error(errorMessage(await response.json().catch(() => null)));
      setAssignment(null);
      setNotice("Conversa removida da fila do atendente.");
      setAssignments((current) => {
        const next = { ...current };
        delete next[selected.id];
        return next;
      });
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível remover a atribuição.",
      );
    } finally {
      setSavingAssignment(false);
    }
  }
  async function finishTicket() {
    if (!selected || closingTickets.has(selected.id)) return;
    if (
      profileDirtyRef.current &&
      !window.confirm(
        "Há alterações não salvas no perfil. Deseja descartá-las e encerrar o atendimento?",
      )
    )
      return;
    const chatId = selected.id;
    setClosingTickets((current) => new Set(current).add(chatId));
    try {
      const response = await request(
        config,
        `/operator-auth/contacts/${encodeURIComponent(config.sessionId)}/${encodeURIComponent(chatId)}/close`,
        { method: "POST" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(errorMessage(result));
      refreshGeneration.current++;
      setAssignments((current) => {
        const next = { ...current };
        delete next[chatId];
        return next;
      });
      setOverview((current) => ({
        ...current,
        contacts: [
          ...current.contacts.filter((c) => c.chatId !== chatId),
          { chatId, data: result.data },
        ],
      }));
      if (selectedRef.current?.id === chatId) {
        setAssignment(null);
        profileDirtyRef.current = false;
        setProfileReload((value) => value + 1);
      }
      setNotice(
        "Atendimento encerrado. A atribuição foi removida e o painel será atualizado.",
      );
      void refreshChats().catch(() =>
        setNotice(
          "Atendimento encerrado. O painel será atualizado na próxima sincronização.",
        ),
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível encerrar o atendimento.",
      );
    } finally {
      setClosingTickets((current) => {
        const next = new Set(current);
        next.delete(chatId);
        return next;
      });
    }
  }
  async function submitOperator() {
    if (authBusy) return;
    setAuthBusy(true);
    const endpoint = registering ? "register" : "login";
    const body = registering
      ? {
          username: operatorUsername,
          displayName: operatorName,
          password: operatorPassword,
        }
      : { username: operatorUsername, password: operatorPassword };
    try {
      setOperatorError("");
      const response = await fetch(
        `${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/${endpoint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok)
        throw new Error(errorMessage(await response.json().catch(() => null)));
      const data = (await response.json()) as { user: Operator; token: string };
      setOperator(data.user);
      setOperatorToken(data.token);
      setOperatorName(data.user.displayName);
      persistOperator(data);
      setOperatorOpen(false);
      setNotice(`Você está conectado como ${data.user.displayName}.`);
    } catch (error) {
      const message =
        error instanceof TypeError
          ? "Não foi possível acessar o servidor. Confira se o computador do sistema está ligado e tente novamente."
          : error instanceof Error
            ? error.message
            : "Não foi possível entrar.";
      setOperatorError(message);
      setNotice(message);
    } finally {
      setAuthBusy(false);
      setOperatorPassword("");
    }
  }
  async function saveOperatorName() {
    if (!operator || !operatorName.trim()) return;
    try {
      const response = await fetch(
        `${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/me`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Atende-Token": operatorToken,
          },
          body: JSON.stringify({ displayName: operatorName.trim() }),
        },
      );
      if (!response.ok)
        throw new Error(errorMessage(await response.json().catch(() => null)));
      const user = (await response.json()) as Operator;
      setOperator(user);
      persistOperator({ user, token: operatorToken });
      setNotice("Nome do usuário atualizado.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o nome.",
      );
    }
  }
  async function sendMessage(approvedPaste = false) {
    if (!selected || !draft.trim()) return;
    if (operator?.role !== "admin" && operator?.canSend === false) {
      setNotice("Sua conta não tem permissão para enviar mensagens.");
      return;
    }
    if (!operatorToken || !operator) {
      setOperatorOpen(true);
      return;
    }
    if (pastedTextPending && !approvedPaste) {
      setPendingPaste({ kind: "text", text: draft.trim(), chatId: selected.id, chatName: selected.name });
      return;
    }
    const target = selected;
    const originalText = draft.trim();
    const replyTarget = replyingTo?.waMessageId;
    const signedText = `*${operator.displayName}:*\n\n${originalText}`;
    const optimisticId = `optimistic-${eventId()}`;
    const optimisticTimestamp = Date.now();
    const optimisticMessage: MessageWithTimestamp = {
      id: optimisticId,
      identityIds: [optimisticId],
      body: signedText,
      mine: true,
      time: messageDateTime(new Date(optimisticTimestamp)),
      timestamp: optimisticTimestamp,
      type: "text",
      ...(replyTarget ? { quotedMessage: { id: replyTarget, body: replyingTo?.body || "" } } : {}),
      source: "optimistic",
    };
    const optimisticList = mergeMessages([
      ...(historyCacheRef.current.get(target.id) || []),
      optimisticMessage,
    ]);
    historyCacheRef.current.set(target.id, optimisticList);
    if (selectedRef.current?.id === target.id) setMessages(optimisticList);
    setDraft("");
    setPastedTextPending(false);
    setReplyingTo(null);
    setEmojiOpen(false);
    try {
      const response = await request(
        config,
        `/sessions/${encodeURIComponent(config.sessionId)}/messages/send-text`,
        {
          method: "POST",
          body: JSON.stringify({ chatId: target.id, text: signedText, ...(replyTarget ? { quotedMessageId: replyTarget } : {}) }),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        messageId?: unknown;
        timestamp?: number;
        message?: string;
      } | null;
      if (!response.ok) throw new Error(errorMessage(result));
      const confirmedId = serializedMessageId(result?.messageId);
      const confirmedTimestamp =
        Number(result?.timestamp) > 0
          ? Number(result?.timestamp) * 1000
          : optimisticTimestamp;
      const confirmedList = mergeMessages(
        (historyCacheRef.current.get(target.id) || []).map((message) =>
          message.identityIds.includes(optimisticId)
            ? {
                ...message,
                id: confirmedId || message.id,
                waMessageId: confirmedId || message.waMessageId,
                identityIds: confirmedId
                  ? [
                      ...new Set([
                        ...message.identityIds,
                        ...messageIdentityIds(confirmedId),
                      ]),
                    ]
                  : message.identityIds,
                timestamp: confirmedTimestamp,
                time: messageDateTime(new Date(confirmedTimestamp)),
                source: "history" as const,
              }
            : message,
        ),
      );
      historyCacheRef.current.set(target.id, confirmedList);
      if (selectedRef.current?.id === target.id) setMessages(confirmedList);
      void refreshMessages(target).catch(() => undefined);
      void refreshChats().catch(() => undefined);
    } catch (error) {
      const withoutFailed = (
        historyCacheRef.current.get(target.id) || []
      ).filter((message) => !message.identityIds.includes(optimisticId));
      historyCacheRef.current.set(target.id, withoutFailed);
      if (selectedRef.current?.id === target.id) {
        setMessages(withoutFailed);
        setDraft((current) => current || originalText);
        if (replyTarget) setReplyingTo((current) => current || replyingTo);
      }
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar a mensagem.",
      );
    }
  }
  async function sendFlow(flow: ConversationFlow) {
    if (!selected || busy) return;
    if (operator?.role !== "admin" && operator?.canSend === false) {
      setNotice("Sua conta não tem permissão para enviar fluxos.");
      return;
    }
    if (!operatorToken || !operator) {
      setOperatorOpen(true);
      return;
    }
    const target = selected;
    const hour = new Date().getHours(),
      greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
    const variables: Record<string, string> = {
      "{{atendente}}": operator.displayName,
      "{{cliente}}": target.name || "cliente",
      "{{saudacao}}": greeting,
    };
    const fill = (value = "") => {
      let result = value;
      for (const [field, replacement] of Object.entries(variables))
        result = result.split(field).join(replacement);
      return result;
    };
    let assignedByFlow = false,
      closedByFlow = false,
      waitingForAnswer = false;
    const assignToCurrent = async () => {
      if (assignedByFlow) return;
      const startResponse = await request(
        config,
        `/operator-auth/contacts/${encodeURIComponent(config.sessionId)}/${encodeURIComponent(target.id)}/start`,
        { method: "POST" },
      );
      const started = (await startResponse.json()) as {
        data: SupportOverview["contacts"][number]["data"];
        assignment: Assignment;
        message?: string;
      };
      if (!startResponse.ok) throw new Error(errorMessage(started));
      assignedByFlow = true;
      setAssignments((current) => ({
        ...current,
        [target.id]: started.assignment,
      }));
      setOverview((current) => ({
        ...current,
        contacts: [
          ...current.contacts.filter((contact) => contact.chatId !== target.id),
          { chatId: target.id, data: started.data },
        ],
      }));
      if (selectedRef.current?.id === target.id) {
        setAssignment(started.assignment);
        profileDirtyRef.current = false;
        setProfileReload((value) => value + 1);
      }
    };
    const closeFromFlow = async () => {
      if (closedByFlow) return;
      const response = await request(
        config,
        `/operator-auth/contacts/${encodeURIComponent(config.sessionId)}/${encodeURIComponent(target.id)}/close`,
        { method: "POST" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(errorMessage(result));
      closedByFlow = true;
      refreshGeneration.current++;
      setAssignments((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      setOverview((current) => ({
        ...current,
        contacts: [
          ...current.contacts.filter((contact) => contact.chatId !== target.id),
          { chatId: target.id, data: result.data },
        ],
      }));
      if (selectedRef.current?.id === target.id) {
        setAssignment(null);
        profileDirtyRef.current = false;
        setProfileReload((value) => value + 1);
      }
    };
    setBusy(true);
    setFlowMenuOpen(false);
    setNotice(`Enviando o fluxo “${flow.name}”…`);
    try {
      if (flow.kind === "evaluation") {
        const evaluationResponse = await request(
          config,
          `/operator-auth/contacts/${encodeURIComponent(config.sessionId)}/${encodeURIComponent(target.id)}/evaluation`,
          { method: "POST" },
        );
        const closed = (await evaluationResponse.json()) as {
          data: SupportOverview["contacts"][number]["data"];
          message?: string;
        };
        if (!evaluationResponse.ok) throw new Error(errorMessage(closed));
        setAssignments((current) => {
          const next = { ...current };
          delete next[target.id];
          return next;
        });
        setOverview((current) => ({
          ...current,
          contacts: [
            ...current.contacts.filter(
              (contact) => contact.chatId !== target.id,
            ),
            { chatId: target.id, data: closed.data },
          ],
        }));
        if (selectedRef.current?.id === target.id) {
          setAssignment(null);
          profileDirtyRef.current = false;
          setProfileReload((value) => value + 1);
        }
        setNotice("Enquetes de avaliação enviadas e atendimento encerrado.");
        await refreshMessages(target, config, true);
        await refreshChats();
        return;
      }
      if (flow.kind === "start") {
        await assignToCurrent();
      }
      for (let stepIndex = 0; stepIndex < flow.steps.length; stepIndex += 1) {
        const step = flow.steps[stepIndex];
        const type = step.type || "message";
        if (type === "delay") {
          if ((step.delaySeconds || 0) > 0)
            await new Promise((resolve) =>
              setTimeout(resolve, (step.delaySeconds || 0) * 1000),
            );
          continue;
        }
        if ((step.delaySeconds || 0) > 0)
          await new Promise((resolve) =>
            setTimeout(resolve, (step.delaySeconds || 0) * 1000),
          );
        if (type === "action") {
          if (step.action === "assign-current") await assignToCurrent();
          else if (step.action === "close-ticket") await closeFromFlow();
          continue;
        }
        let path = "send-text",
          body: Record<string, unknown> = { chatId: target.id };
        if (type === "message")
          body.text = `*${operator.displayName}:*\n\n${fill(step.text)}`;
        else if (type === "poll") {
          path = "send-poll";
          body = {
            chatId: target.id,
            name: fill(step.question),
            options: (step.options || []).map(fill),
            allowMultipleAnswers: false,
          };
        } else {
          path = `send-${type}`;
          const caption = fill(step.caption);
          body = {
            chatId: target.id,
            base64: step.data,
            mimetype: step.mimetype || "application/octet-stream",
            filename: step.filename || "arquivo",
            ...(caption
              ? { caption: `*${operator.displayName}:*\n\n${caption}` }
              : {}),
          };
        }
        const response = await request(
          config,
          `/sessions/${encodeURIComponent(config.sessionId)}/messages/${path}`,
          { method: "POST", body: JSON.stringify(body) },
        );
        const sendResult = (await response.json().catch(() => null)) as {
          messageId?: string;
          message?: string;
        } | null;
        if (!response.ok) throw new Error(errorMessage(sendResult));
        if (type === "poll") {
          const remaining = flow.steps.slice(stepIndex + 1).map((next) => {
            if ((next.type || "message") === "message")
              return {
                ...next,
                text: `*${operator.displayName}:*\n\n${fill(next.text)}`,
              };
            if (next.type === "poll")
              return {
                ...next,
                question: fill(next.question),
                options: (next.options || []).map(fill),
              };
            if (
              ["image", "video", "audio", "document"].includes(next.type || "")
            ) {
              const caption = fill(next.caption);
              return {
                ...next,
                caption: caption
                  ? `*${operator.displayName}:*\n\n${caption}`
                  : "",
              };
            }
            return next;
          });
          const continuation = await request(
            config,
            `/operator-auth/contacts/${encodeURIComponent(config.sessionId)}/${encodeURIComponent(target.id)}/flow-continuation`,
            {
              method: "POST",
              body: JSON.stringify({
                steps: remaining,
                expectedOptions: (step.options || []).map(fill),
                pollMessageId: sendResult?.messageId,
              }),
            },
          );
          if (!continuation.ok)
            throw new Error(
              errorMessage(await continuation.json().catch(() => null)),
            );
          waitingForAnswer = true;
          break;
        }
      }
      setNotice(
        waitingForAnswer
          ? "Opções enviadas. Aguardando a resposta do cliente."
          : closedByFlow
            ? `Fluxo “${flow.name}” enviado e atendimento encerrado.`
            : assignedByFlow
              ? `Fluxo enviado e atendimento atribuído a ${operator.displayName}.`
              : `Fluxo “${flow.name}” enviado.`,
      );
      await refreshMessages(target, config, true);
      await refreshChats();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `O fluxo foi interrompido: ${error.message}`
          : "Não foi possível enviar o fluxo.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function sendMedia(file: File, voiceNote = false, target: Chat | null = selected) {
    if (!target) return false;
    if (operator?.role !== "admin" && operator?.canSend === false) {
      setNotice("Sua conta não tem permissão para enviar arquivos.");
      return false;
    }
    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () =>
          reject(new Error("Não foi possível ler o arquivo."));
        reader.readAsDataURL(file);
      });
      const mime = file.type || "application/octet-stream";
      let outgoingBase64 = base64;
      let outgoingMime = mime;
      const endpoint =
        voiceNote || mime.startsWith("audio/")
          ? "send-audio"
          : mime.startsWith("image/")
            ? "send-image"
            : mime.startsWith("video/")
              ? "send-video"
              : "send-document";
      const extension =
        (
          {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
            "application/pdf": "pdf",
            "application/msword": "doc",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
              "docx",
          } as Record<string, string>
        )[mime] || "bin";
      let outgoingFilename = file.name || `arquivo-colado.${extension}`;
      let ptt = false;

      if (voiceNote) {
        const conversion = await request(
          config,
          `/sessions/${encodeURIComponent(config.sessionId)}/media/convert/voice`,
          {
            method: "POST",
            body: JSON.stringify({ base64 }),
          },
        );
        const converted = (await conversion.json().catch(() => null)) as {
          base64?: string;
          mimetype?: string;
        } | null;
        if (!conversion.ok) throw new Error(errorMessage(converted));
        if (!converted?.base64)
          throw new Error("Não foi possível preparar o áudio para envio.");

        outgoingBase64 = converted.base64;
        outgoingMime = converted.mimetype || "audio/ogg; codecs=opus";
        outgoingFilename = "mensagem-de-voz.ogg";
        ptt = true;
      }

      const response = await request(
        config,
        `/sessions/${encodeURIComponent(config.sessionId)}/messages/${endpoint}`,
        {
          method: "POST",
          body: JSON.stringify({
            chatId: target.id,
            base64: outgoingBase64,
            mimetype: outgoingMime,
            filename: outgoingFilename,
            ...(endpoint === "send-audio" ? { ptt } : {}),
          }),
        },
      );
      if (!response.ok)
        throw new Error(errorMessage(await response.json().catch(() => null)));
      await refreshMessages(target, config, true);
      await refreshChats();
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o arquivo.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function sendFiles(files: File[], target: Chat | null = selected) {
    if (!target) {
      setNotice("Abra uma conversa antes de colar ou arrastar arquivos.");
      return;
    }
    const accepted = files.filter((file) => file.size > 0).slice(0, 10);
    if (!accepted.length) {
      setNotice("Nenhum arquivo válido foi encontrado.");
      return;
    }
    let sent = 0;
    for (const file of accepted) if (await sendMedia(file, false, target)) sent++;
    if (sent)
      setNotice(
        `${sent} ${sent === 1 ? "arquivo enviado" : "arquivos enviados"} com sucesso.`,
      );
  }
  async function confirmPendingPaste() {
    const pending = pendingPaste;
    if (!pending) return;
    if (!selected || selected.id !== pending.chatId) {
      setPendingPaste(null);
      setNotice("A conversa mudou. Cole novamente antes de enviar.");
      return;
    }
    if (pending.kind === "text") {
      if (draft.trim() !== pending.text) {
        setPendingPaste({ ...pending, text: draft.trim() });
        return;
      }
      setPendingPaste(null);
      await sendMessage(true);
      return;
    }
    setPendingPaste(null);
    await sendFiles(pending.files, selected);
  }
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (
        !selected ||
        settingsOpen ||
        operatorOpen ||
        newChatOpen ||
        dashboardOpen ||
        teamChatOpen ||
        contactsOpen ||
        forwardTarget ||
        pendingPaste
      )
        return;
      const itemFiles = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      const files = itemFiles.length
        ? itemFiles
        : Array.from(event.clipboardData?.files || []);
      if (!files.length) return;
      event.preventDefault();
      const validFiles = files.filter(file => file.size > 0);
      if (!validFiles.length) { setNotice("Nenhum arquivo válido foi encontrado."); return; }
      setPendingPaste({ kind: "files", files: validFiles.slice(0, 10), omittedFiles: Math.max(0, validFiles.length - 10), chatId: selected.id, chatName: selected.name });
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [
    selected,
    settingsOpen,
    operatorOpen,
    newChatOpen,
    dashboardOpen,
    teamChatOpen,
    contactsOpen,
    forwardTarget,
    pendingPaste,
    config,
    operator,
  ]);
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recordingChunksRef.current = [];
      discardRecordingRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        setRecordingPaused(false);
        const blob = new Blob(recordingChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (!discardRecordingRef.current && blob.size)
          void sendMedia(
            new File([blob], "mensagem-de-voz.webm", { type: blob.type }),
            true,
          );
      };
      recorder.start();
      setRecording(true);
      setNotice("Gravando áudio.");
    } catch {
      setNotice("Permita o uso do microfone para gravar um áudio.");
    }
  }
  function pauseOrResumeRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      setRecordingPaused(true);
    } else if (recorder.state === "paused") {
      recorder.resume();
      setRecordingPaused(false);
    }
  }
  function sendRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive")
      recorderRef.current.stop();
  }
  function discardRecording() {
    discardRecordingRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive")
      recorderRef.current.stop();
    else {
      setRecording(false);
      setRecordingPaused(false);
    }
  }
  async function startChat() {
    const countryCode = contactCountryCode.replace(/\D/g, "");
    const typedNumber = phone.replace(/\D/g, "");
    const nationalMin = ({55:10,1:10,351:9,34:9,54:10} as Record<string,number>)[contactCountryCode] || 9;
    const nationalMax = ({55:11,1:10,351:9,34:9,54:11} as Record<string,number>)[contactCountryCode] || 11;
    const number = phone.trim().startsWith("+") || (typedNumber.startsWith(countryCode) && typedNumber.length > nationalMax)
      ? typedNumber
      : `${countryCode}${typedNumber}`;
    const fullName = [contactFirstName.trim(), contactLastName.trim()].filter(Boolean).join(" ");
    if (savingContact) return;
    setContactFormError("");
    if (!contactFirstName.trim()) {
      setContactFormError("Informe o primeiro nome do contato.");
      return;
    }
    const nationalNumber = number.startsWith(countryCode) ? number.slice(countryCode.length) : "";
    if (!/^\d{10,15}$/.test(number) || nationalNumber.length < nationalMin || nationalNumber.length > nationalMax) {
      setContactFormError("Informe um número válido com DDD.");
      return;
    }
    if (!config.sessionId) {
      setContactFormError("Configure a conexão WhatsApp antes de cadastrar contatos.");
      return;
    }
    setSavingContact(true);
    try {
      const id = `${number}@c.us`,
        path = `/operator-auth/contacts/${encodeURIComponent(config.sessionId)}/${encodeURIComponent(id)}`;
      const current = await request(config, path);
      const profile = await current.json();
      if (!current.ok) throw new Error(errorMessage(profile));
      const response = await request(config, path, {
        method: "PUT",
        body: JSON.stringify({
          ...profile,
          data: {
            ...profile.data,
            name: fullName,
            phone: number,
          },
        }),
      });
      const saved = await response.json();
      if (!response.ok) throw new Error(errorMessage(saved));
      refreshGeneration.current++;
      setOverview((current) => ({
        ...current,
        contacts: [
          ...current.contacts.filter((c) => c.chatId !== id),
          { chatId: id, data: saved.data },
        ],
      }));
      setPhone("");
      setContactFirstName("");
      setContactLastName("");
      setContactCountryCode("55");
      setContactFormError("");
      setNewChatOpen(false);
      setContactsOpen(true);
      setDashboardOpen(false);
      setNotice("Contato salvo para toda a equipe.");
    } catch (error) {
      setContactFormError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o contato.",
      );
    } finally {
      setSavingContact(false);
    }
  }

  const contactRows = useMemo(() => {
    const hasName = (value?: string) => Boolean(value && /[\p{L}]/u.test(value));
    const displayName = (...values: (string | undefined)[]) => values.find(hasName)?.trim() || "Contato sem nome";
    const nameKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const hiddenIds = new Set(overview.contacts.filter(contact => contact.data.directoryHidden).map(contact => contact.chatId));
    const liveChatIds = new Set(chats.map(chat => chat.id));
    const rows = new Map(
      chats.filter(c => !hiddenIds.has(c.id)).map((c) => [
        c.id,
        {
          id: c.id,
          name: displayName(c.name),
          phone: c.phone,
          avatar: c.avatar,
          tags: [] as string[],
        },
      ]),
    );
    for (const contact of overview.contacts) {
      if (contact.data.directoryHidden || /@(g\.us|broadcast|newsletter)$/.test(contact.chatId)) continue;
      const old = rows.get(contact.chatId);
      rows.set(contact.chatId, {
        id: contact.chatId,
        name: displayName(contact.data.name, old?.name),
        phone: contact.data.phone || old?.phone,
        avatar:
          old?.avatar ||
          profilePicturesRef.current.get(contact.chatId) ||
          undefined,
        tags: (contact.data as { tags?: string[] }).tags || [],
      });
    }
    // A spreadsheet profile can be keyed by phone while the existing WhatsApp conversation uses a
    // privacy ID. Collapse only a unique, full-name match when the phone profile has no live chat;
    // a second real conversation must remain visible until it can be reconciled safely.
    const groups = new Map<string, Array<{ id: string; name: string; phone?: string; avatar?: string; tags: string[] }>>();
    for (const row of rows.values()) {
      const key = nameKey(row.name);
      if (key.length < 6 || !/[\p{L}]/u.test(key)) continue;
      groups.set(key, [...(groups.get(key) || []), row]);
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
  }, [chats, overview.contacts]);
  const forwardCandidates = useMemo(() => {
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
    const query = normalize(forwardSearch.trim());
    return contactRows.filter(contact => contact.id !== forwardTarget?.chatId && /@(c\.us|lid)$/.test(contact.id) && (!query || normalize(`${contact.name} ${contact.phone || ""} ${contact.id}`).includes(query)));
  }, [contactRows, forwardTarget?.chatId, forwardSearch]);
  function openForward(message: Message) {
    if (!selected || !message.waMessageId) return;
    if (operator?.role !== "admin" && operator?.canSend === false) {
      setNotice("Sua conta não tem permissão para encaminhar mensagens.");
      return;
    }
    setForwardTarget({ message, chatId: selected.id });
    setForwardSearch("");
    setForwardToIds([]);
    setForwardError("");
  }
  function toggleForwardRecipient(chatId: string) {
    if (!forwardToIds.includes(chatId) && forwardToIds.length >= 10) {
      setForwardError("Selecione no máximo 10 contatos por envio.");
      return;
    }
    setForwardToIds(current => current.includes(chatId) ? current.filter(id => id !== chatId) : [...current, chatId]);
    setForwardError("");
  }
  async function sendForward() {
    if (!forwardTarget?.message.waMessageId || !forwardToIds.length || forwardBusy) return;
    const target = forwardTarget;
    const recipients = [...forwardToIds];
    setForwardBusy(true);
    setForwardError("");
    let delivered = 0;
    const failed: { id: string; name: string; reason: string }[] = [];
    for (const toChatId of recipients) {
      try {
        const response = await request(config, `/sessions/${encodeURIComponent(config.sessionId)}/messages/forward`, {
          method: "POST",
          body: JSON.stringify({ fromChatId: target.chatId, toChatId, messageId: target.message.waMessageId }),
        });
        if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
        delivered++;
      } catch (error) {
        failed.push({ id: toChatId, name: contactRows.find(contact => contact.id === toChatId)?.name || toChatId, reason: error instanceof Error ? error.message : "Falha ao encaminhar" });
      }
    }
    if (delivered) void refreshChats().catch(() => undefined);
    if (failed.length) {
      setForwardToIds(failed.map(item => item.id));
      setForwardError(`${delivered} enviado(s). Falha para: ${failed.map(item => `${item.name} (${item.reason})`).join("; ")}. Apenas os contatos com falha continuam selecionados.`);
    } else {
      setForwardTarget(null);
      setNotice(`Mensagem encaminhada para ${delivered} contato${delivered === 1 ? "" : "s"}.`);
    }
    setForwardBusy(false);
  }
  const tagsByChat = useMemo(
    () => new Map(contactRows.map((contact) => [contact.id, contact.tags])),
    [contactRows],
  );
  const availableChatTags = useMemo(
    () =>
      [...new Set(contactRows.flatMap((contact) => contact.tags))].sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [contactRows],
  );
  const shownChats = useMemo(
    () =>
      chats.filter(
        (chat) =>
          (filter === "all" ||
            (filter === "unread" && chat.unread > 0) ||
            (filter === "mine" &&
              assignments[chat.id]?.assigneeId === operator?.id)) &&
          (!tagFilter || tagsByChat.get(chat.id)?.includes(tagFilter)) &&
          (chat.name.toLowerCase().includes(search.toLowerCase()) ||
            chat.id.includes(search)),
      ),
    [chats, filter, tagFilter, tagsByChat, search, assignments, operator?.id],
  );
  const connected = status === "connected" || status === "ready";

  async function setMyActivity(activityStatus: NonNullable<Operator["activityStatus"]>, activityNote = "") {
    if (!operatorToken || activityBusy) return;
    setActivityBusy(true);
    setActivityError("");
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/me/activity`, {
        method: "PUT", headers: { "Content-Type": "application/json", "X-Atende-Token": operatorToken },
        body: JSON.stringify({ status: activityStatus, note: activityNote }),
      });
      const data = await response.json() as Operator & { message?: string };
      if (!response.ok) throw new Error(data.message || "Não foi possível alterar sua atividade.");
      setOperator(data);
      persistOperator({ user: data, token: operatorToken });
      setActivityMenuOpen(false);
      setActivityNoteDraft("");
      void refreshChats().catch(() => undefined);
    } catch (error) { setActivityError(error instanceof Error ? error.message : "Não foi possível alterar sua atividade."); }
    finally { setActivityBusy(false); }
  }

  useEffect(() => {
    if (!activityMenuOpen || !operatorToken) return;
    const abort = new AbortController();
    setOnsiteLoading(true);
    fetch(`${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/me/onsite`, {
      headers: { "X-Atende-Token": operatorToken }, signal: abort.signal,
    }).then(async response => {
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
      return response.json() as Promise<typeof onsiteVisits>;
    }).then(visits => setOnsiteVisits(visits))
      .catch(error => { if (!abort.signal.aborted) setActivityError(error instanceof Error ? error.message : "Não foi possível carregar os atendimentos externos."); })
      .finally(() => { if (!abort.signal.aborted) setOnsiteLoading(false); });
    return () => abort.abort();
  }, [activityMenuOpen, operatorToken, config.baseUrl]);

  async function changeOnsiteVisit(id?: string) {
    if (!operatorToken || activityBusy) return;
    setActivityBusy(true);
    setActivityError("");
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/me/onsite${id ? `/${encodeURIComponent(id)}/finish` : ""}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Atende-Token": operatorToken },
        ...(!id ? { body: JSON.stringify({ clientName: onsiteClient.trim() }) } : {}),
      });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
      const visit = await response.json() as typeof onsiteVisits[number];
      setOnsiteVisits(current => id ? current.map(item => item.id === id ? visit : item) : [visit, ...current]);
      const me = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/me`, {headers:{"X-Atende-Token":operatorToken}});
      if (me.ok) {
        const user = await me.json() as Operator;
        setOperator(user);
        persistOperator({user,token:operatorToken});
      }
      setOnsiteClient("");
      void refreshChats().catch(() => undefined);
    } catch (error) { setActivityError(error instanceof Error ? error.message : "Não foi possível registrar o atendimento externo."); }
    finally { setActivityBusy(false); }
  }

  async function logout() {
    try {
      await fetch(
        `${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/logout`,
        { method: "POST", headers: { "X-Atende-Token": operatorToken } },
      );
    } catch {
      setNotice("Conta encerrada neste navegador.");
    }
    setMessageAlerts([]);
    persistOperator(null);
    setOperator(null);
    setOperatorToken("");
    setSelected(null);
    setMessages([]);
    setChats([]);
    setOperatorPassword("");
    setOperatorError("");
    socketRef.current?.disconnect();
    setOperatorOpen(false);
    setSettingsOpen(false);
  }
  if (!authLoaded)
    return (
      <div className="app-loading">
        <LoaderCircle className="wa-spin" /> Carregando seu espaço…
      </div>
    );
  if (!operator)
    return (
      <LoginScreen
        baseUrl={config.baseUrl}
        registering={registering}
        setRegistering={(value: boolean) => {
          setRegistering(value);
          setOperatorError("");
        }}
        username={operatorUsername}
        setUsername={setOperatorUsername}
        name={operatorName}
        setName={setOperatorName}
        password={operatorPassword}
        setPassword={setOperatorPassword}
        error={operatorError}
        busy={authBusy}
        submit={submitOperator}
      />
    );

  return (
    <main className="wa-app">
      <header className="workspace-topbar">
        <div className="workspace-brand">
          <span>
            <MessageCircle size={22} />
          </span>
          atende
        </div>
        <div className="workspace-account">
          <div className="activity-control" ref={activityControlRef}>
            <button type="button" className={`activity-toggle ${operator.activityStatus && operator.activityStatus !== "available" ? "away" : ""}`}
              aria-expanded={activityMenuOpen} onClick={() => { setActivityMenuOpen(value => !value); setActivityError(""); }}>
              <span className="activity-dot" />
              {operator.activityStatus === "break" ? "Pausa de 15 min" : operator.activityStatus === "meeting" ? "Em reunião" : operator.activityStatus === "away" ? "Ausente" : operator.activityStatus === "onsite" ? "Em cliente" : operator.activityStatus === "custom" ? operator.activityNote || "Outra atividade" : "Disponível"}
            </button>
            {activityMenuOpen && <div className="activity-menu">
              <div className="activity-menu-header"><strong>O que você está fazendo?</strong><button type="button" onClick={() => setActivityMenuOpen(false)} aria-label="Fechar atividades"><X size={16}/></button></div>
              <p>Durante uma atividade, você não recebe novos atendimentos nem avisos de mensagens.</p>
              {operator.activityStatus !== "onsite" && <>
              <button type="button" disabled={activityBusy} onClick={() => void setMyActivity("available")}>Disponível para atender</button>
              <button type="button" disabled={activityBusy} onClick={() => void setMyActivity("break")}>Descanso · 15 minutos</button>
              <button type="button" disabled={activityBusy} onClick={() => void setMyActivity("meeting")}>Em reunião</button>
              <button type="button" disabled={activityBusy} onClick={() => void setMyActivity("away")}>Fora da estação</button>
              <form onSubmit={event => { event.preventDefault(); void setMyActivity("custom", activityNoteDraft); }}>
                <label htmlFor="activity-note">Outra atividade</label>
                <div><input id="activity-note" maxLength={120} required value={activityNoteDraft} onChange={event => setActivityNoteDraft(event.target.value)} placeholder="Ex.: treinamento"/><button type="submit" disabled={activityBusy}>Informar</button></div>
              </form>
              </>}
              <div className="activity-onsite">
                <strong>Atendimento em cliente</strong>
                {onsiteLoading ? <p>Carregando atendimentos...</p> : onsiteVisits.find(visit => !visit.endedAt) ? (() => {
                  const visit = onsiteVisits.find(item => !item.endedAt)!;
                  return <><p><b>{visit.clientName}</b><br/>Início: {new Date(visit.startedAt).toLocaleString("pt-BR")}</p><button type="button" disabled={activityBusy} onClick={() => void changeOnsiteVisit(visit.id)}>Finalizar atendimento externo</button></>;
                })() : operator.activityStatus === "onsite" ? <p>Não foi possível identificar o atendimento em andamento. Atualize a página.</p> : <form onSubmit={event => { event.preventDefault(); void changeOnsiteVisit(); }}>
                  <label htmlFor="onsite-client">Cliente atendido</label>
                  <div><input id="onsite-client" maxLength={160} required value={onsiteClient} onChange={event => setOnsiteClient(event.target.value)} placeholder="Nome do cliente"/><button type="submit" disabled={activityBusy}>Iniciar</button></div>
                </form>}
              </div>
              {activityError && <small role="alert">{activityError}</small>}
            </div>}
          </div>
          <button
            className="notification-toggle"
            onClick={() => void enableNotifications()}
            title="Ativar som e notificações neste computador"
          >
            <Bell size={18} />
            <span>
              {notificationsEnabled
                ? "Notificações ativas"
                : "Ativar notificações"}
            </span>
          </button>
          <button onClick={() => setOperatorOpen(true)} title="Meu perfil">
            <span className="account-avatar">
              {initials(operator.displayName)}
            </span>
            <span>
              <b>{operator.displayName}</b>
              <small>
                {operator.role === "admin" ? "Administrador" : "Atendente"}
              </small>
            </span>
          </button>
        </div>
      </header>
      <section
        className={`wa-shell ${dashboardOpen || contactsOpen || teamChatOpen ? "dashboard-is-open" : ""}`}
      >
        <nav className="workspace-rail" aria-label="Navegação principal">
          <button
            className={!dashboardOpen && !contactsOpen && !teamChatOpen ? "active" : ""}
            onClick={() => {
              setFilter("all");
              setSettingsOpen(false);
              setDashboardOpen(false);
              setContactsOpen(false);
              setTeamChatOpen(false);
            }}
            title="Todas as conversas"
          >
            <Inbox size={22} />
            <span>Conversas</span>
          </button>
          <button
            className={contactsOpen ? "active" : ""}
            onClick={() => {
              setContactsOpen(true);
              setDashboardOpen(false);
              setTeamChatOpen(false);
            }}
            title="Contatos"
          >
            <UsersRound size={22} />
            <span>Contatos</span>
          </button>
          <button
            className={teamChatOpen ? "active" : ""}
            onClick={() => {
              setTeamRoom("group");
              setTeamChatOpen(true);
              setContactsOpen(false);
              setDashboardOpen(false);
            }}
            title="Chat interno da equipe"
          >
            <MessageCircle size={22} />
            <span>Equipe</span>
            {teamUnread > 0 && <b className="team-rail-unread" aria-label={`${teamUnread} mensagens internas não lidas`}>{teamUnread > 99 ? "99+" : teamUnread}</b>}
          </button>
          <button
            className={dashboardOpen ? "active" : ""}
            onClick={() => {
              if (profileDirtyRef.current) {
                setNotice(
                  "Salve as alterações do contato antes de abrir o dashboard.",
                );
                return;
              }
              setDashboardOpen(true);
              setContactsOpen(false);
              setTeamChatOpen(false);
            }}
            title="Dashboard dos chamados"
          >
            <UsersRound size={22} />
            <span>Painel</span>
          </button>
          <div className="rail-spacer" />
          <button onClick={() => setSettingsOpen(true)} title="Configurações">
            <Settings size={22} />
            <span>Ajustes</span>
          </button>
        </nav>
        {contactsOpen && !contactsReady && (
          <section className="contacts-loading" role="status" aria-live="polite" aria-busy="true">
            <div className="contacts-loading-card">
              <LoaderCircle className="wa-spin" size={34} aria-hidden="true" />
              <h1>Carregando contatos…</h1>
              <p>Preparando a lista e as etiquetas. Aguarde um instante.</p>
            </div>
          </section>
        )}
        {contactsOpen && contactsReady && (
          <ContactsPanel
            contacts={contactRows}
            canCreate={operator.role === "admin" || operator.canAssign === true}
            baseUrl={config.baseUrl}
            apiKey={config.apiKey}
            sessionId={config.sessionId}
            token={operatorToken}
            onImported={() => refreshChats()}
            onCreate={() => setNewChatOpen(true)}
            onOpen={(contact) => {
              setContactsOpen(false);
              void chooseChat(
                chats.find((c) => c.id === contact.id) || {
                  ...contact,
                  last: "",
                  time: "",
                  unread: 0,
                },
              );
            }}
          />
        )}
        {teamChatOpen && <TeamChat baseUrl={config.baseUrl} token={operatorToken} initialRoom={teamRoom} onRoomChange={setTeamRoom} />}
        {dashboardOpen && (
          <TicketDashboard
            warning={syncWarning}
            chats={chats}
            owners={assignments}
            overview={overview}
            onClose={() => setDashboardOpen(false)}
            onOpen={(id) => {
              const chat = chats.find((c) => c.id === id);
              if (chat) {
                setDashboardOpen(false);
                setDetailsOpen(true);
                void chooseChat(chat);
              }
            }}
          />
        )}
        <aside className="wa-sidebar">
          <div className="wa-search-bar">
            <label>
              <Search size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Buscar contato ou número"
                placeholder="Buscar contato ou número…"
              />
            </label>
            <div className="wa-filter-control" ref={filterPopoverRef}>
              <button
                className={tagFilter ? "active" : ""}
                onClick={() => {
                  setFilterMenuOpen((open) => !open);
                  if (filterMenuOpen) setFilterMenuPage("main");
                }}
                aria-label="Adicionar filtros"
                aria-expanded={filterMenuOpen}
              >
                <Filter size={18} />
                {tagFilter && <i aria-hidden="true" />}
              </button>
              {filterMenuOpen && (
                <section
                  className="wa-filter-popover"
                  aria-label="Filtros das conversas"
                >
                  <header>
                    {filterMenuPage === "tags" && (
                      <button
                        className="wa-filter-back"
                        onClick={() => setFilterMenuPage("main")}
                        aria-label="Voltar aos filtros"
                      >
                        <ArrowLeft size={16} />
                      </button>
                    )}
                    <span>
                      {filterMenuPage === "main"
                        ? "ADICIONAR FILTROS"
                        : "ETIQUETA"}
                    </span>
                    <button
                      className="wa-filter-close"
                      onClick={() => {
                        setFilterMenuOpen(false);
                        setFilterMenuPage("main");
                      }}
                      aria-label="Fechar filtros"
                    >
                      <X size={15} />
                    </button>
                  </header>
                  {filterMenuPage === "main" ? (
                    <button
                      className="wa-filter-option"
                      onClick={() => setFilterMenuPage("tags")}
                    >
                      <span>
                        <b>Etiqueta</b>
                        {tagFilter && <small>{tagFilter}</small>}
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  ) : (
                    <div className="wa-filter-tag-list">
                      <button
                        className={!tagFilter ? "selected" : ""}
                        onClick={() => {
                          setTagFilter("");
                          setFilterMenuOpen(false);
                          setFilterMenuPage("main");
                        }}
                      >
                        <span>Todas as etiquetas</span>
                        {!tagFilter && <Check size={16} />}
                      </button>
                      {availableChatTags.map((tag) => (
                        <button
                          key={tag}
                          className={tagFilter === tag ? "selected" : ""}
                          onClick={() => {
                            setTagFilter(tag);
                            setFilterMenuOpen(false);
                            setFilterMenuPage("main");
                          }}
                        >
                          <span>{tag}</span>
                          {tagFilter === tag && <Check size={16} />}
                        </button>
                      ))}
                      {!availableChatTags.length && (
                        <p>Nenhuma etiqueta cadastrada.</p>
                      )}
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
          <div className="wa-filters" aria-label="Filtrar conversas">
            {(
              [
                ["all", "Todas"],
                ["unread", "Não lidas"],
                ["mine", "Minhas"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                className={filter === value ? "active" : ""}
                onClick={() => setFilter(value)}
              >
                {label}
                {value === "unread" && chats.some((c) => c.unread > 0) && (
                  <span>{chats.filter((c) => c.unread > 0).length}</span>
                )}
              </button>
            ))}
            {tagFilter && (
              <button
                className="wa-applied-filter active"
                onClick={() => setTagFilter("")}
                title="Remover filtro de etiqueta"
              >
                Etiqueta: {tagFilter}
                <X size={12} />
              </button>
            )}
          </div>
          <div className="list-caption">
            <span>
              {shownChats.length} conversa{shownChats.length === 1 ? "" : "s"}
            </span>
            <span>MAIS RECENTES</span>
          </div>
          {syncWarning && (
            <p className="sync-warning" role="status">
              {syncWarning}
            </p>
          )}
          <div className="wa-chat-list">
            {shownChats.length ? (
              shownChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => chooseChat(chat)}
                  aria-pressed={selected?.id === chat.id}
                  className={`wa-chat ${selected?.id === chat.id ? "selected" : ""} ${chat.unread ? "has-unread" : ""}`}
                >
                  <ContactAvatar chat={chat} />
                  <span className="wa-chat-copy">
                    <span>
                      <b>{chat.name}</b>
                      <time className={chat.unread ? "unread-time" : ""}>
                        {chat.time}
                      </time>
                    </span>
                    <span>
                      <i>{chat.last}</i>
                      {assignments[chat.id] && (
                        <span
                          className="wa-owner-marker"
                          title={`Atribuído para ${assignments[chat.id].assigneeName}`}
                          aria-label={`Atribuído para ${assignments[chat.id].assigneeName}`}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="7" r="4" />
                            <path d="M4 21v-3a8 8 0 0 1 16 0v3Z" />
                          </svg>
                        </span>
                      )}
                      {chat.unread > 0 && (
                        <em>{chat.unread > 99 ? "99+" : chat.unread}</em>
                      )}
                    </span>
                    <span
                      className={`chat-owner-label ${assignments[chat.id] ? "assigned" : ""}`}
                    >
                      <UserRound size={11} />
                      {assignments[chat.id]?.assigneeName || "Sem responsável"}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <div className="wa-list-empty">
                <MessageCircle size={28} />
                <p>
                  {config.sessionId
                    ? "Nenhuma conversa encontrada."
                    : "Conecte o OpenWA para ver as conversas."}
                </p>
              </div>
            )}
          </div>
        </aside>
        <section
          className={`wa-conversation ${draggingFiles ? "is-file-dragging" : ""}`}
          onDragOver={(event) => {
            if (Array.from(event.dataTransfer.types).includes("Files")) {
              event.preventDefault();
              setDraggingFiles(true);
            }
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setDraggingFiles(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDraggingFiles(false);
            void sendFiles(Array.from(event.dataTransfer.files));
          }}
        >
          {draggingFiles && (
            <div className="wa-file-drop-overlay">
              <Paperclip size={34} />
              <b>Solte para enviar</b>
              <span>Imagens, PDFs, documentos e outros arquivos</span>
            </div>
          )}
          {selected ? (
            <>
              <header className="wa-conversation-header">
                <button
                  className="wa-back"
                  aria-label="Voltar às conversas"
                  onClick={closeConversation}
                >
                  <ArrowLeft size={21} />
                </button>
                <ContactAvatar chat={selected} />
                <div className="wa-contact-title">
                  <b>{selected.name}</b>
                  <small>
                    {assignment
                      ? `Em atendimento por ${assignment.assigneeName}`
                      : connected
                        ? "Sem atendente atribuído"
                        : "aguardando conexão"}
                  </small>
                </div>
                <div className="wa-top-actions">
                  {(operator?.role === "admin" || operator?.canAssign) && (
                    <button
                      className="finish-ticket"
                      onClick={() => void finishTicket()}
                      disabled={
                        closingTickets.has(selected.id) ||
                        overview.contacts.some(
                          (c) =>
                            c.chatId === selected.id &&
                            c.data.status === "closed",
                        )
                      }
                      title="Concluir atendimento e remover atribuição"
                    >
                      <CheckCheck size={18} />
                      <span>
                        {closingTickets.has(selected.id)
                          ? "Encerrando…"
                          : overview.contacts.some(
                                (c) =>
                                  c.chatId === selected.id &&
                                  c.data.status === "closed",
                              )
                            ? "Atendimento encerrado"
                            : "Encerrar atendimento"}
                      </span>
                    </button>
                  )}
                  <button
                    className="profile-toggle"
                    onClick={() => setDetailsOpen(!detailsOpen)}
                    aria-label="Mostrar ou ocultar perfil do contato"
                    aria-expanded={detailsOpen}
                  >
                    <PanelRight size={18} />
                    <span>Perfil</span>
                  </button>
                  <button
                    className="close-conversation"
                    onClick={closeConversation}
                    aria-label="Fechar conversa"
                    title="Fechar conversa (Esc)"
                  >
                    <X size={19} />
                  </button>
                </div>
              </header>
              <div
                ref={messageAreaRef}
                className="wa-message-area"
                onScroll={(event) => {
                  const area = event.currentTarget;
                  keepAtBottomRef.current =
                    area.scrollHeight - area.scrollTop - area.clientHeight <
                    100;
                }}
              >
                <p className="wa-encryption">
                  Histórico da conversa · Atendimento da equipe
                </p>
                {loadingMessages ? (
                  <p className="wa-no-messages">Carregando mensagens…</p>
                ) : messages.length ? (
                  messages.map((message) => {
                    const hasAttachment = Boolean(message.media);
                    const quotedId = message.quotedMessage?.id;
                    const quotedOriginal = quotedId
                      ? messages.find((candidate) => candidate.waMessageId === quotedId || candidate.identityIds?.includes(quotedId))
                      : undefined;
                    return (
                      <div
                        key={message.id}
                        id={`wa-message-${message.id}`}
                        className={`wa-message ${message.mine ? "mine" : ""}`}
                      >
                        <article>
                          {message.forwarded && <span className="wa-forwarded-label"><Reply size={13} />Encaminhada</span>}
                          {message.quotedMessage && <button type="button" className="wa-quoted-message" onClick={() => quotedOriginal && document.getElementById(`wa-message-${quotedOriginal.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} title={quotedOriginal ? "Ir para a mensagem original" : undefined}><b>{quotedOriginal ? quotedOriginal.mine ? "Você" : selected.name : "Mensagem respondida"}</b><span>{quotedOriginal?.body || message.quotedMessage.body || "Mensagem original"}</span></button>}
                          <MessageAttachment
                            message={message}
                            config={config}
                            chatId={selected.id}
                          />
                          {message.body &&
                            !(
                              hasAttachment &&
                              [
                                "Imagem",
                                "Vídeo",
                                "Áudio",
                                "Mensagem de voz",
                                "Figurinha",
                                "Documento",
                              ].includes(message.body)
                            ) && <MessageText text={message.body} />}
                          <footer>
                            {message.waMessageId && <button type="button" className="wa-message-reply" title="Responder a esta mensagem" aria-label="Responder a esta mensagem" onClick={() => { setReplyingTo(message); requestAnimationFrame(() => composerInputRef.current?.focus()); }}><Reply size={14} />Responder</button>}
                            {message.waMessageId && <button type="button" className="wa-message-forward" title="Encaminhar mensagem para contatos" aria-label="Encaminhar mensagem para contatos" onClick={() => openForward(message)}><Forward size={14} />Encaminhar</button>}
                            <span>{message.time}</span>
                            {message.mine && <CheckCheck size={15} />}
                          </footer>
                        </article>
                      </div>
                    );
                  })
                ) : (
                  <p className="wa-no-messages">
                    Nenhuma mensagem nesta conversa ainda.
                  </p>
                )}
                <div ref={bottomRef} />
              </div>
              {replyingTo && <div className="wa-reply-composer-preview"><Reply size={17}/><div><b>Respondendo à mensagem</b><span>{replyingTo.body || "Mídia"}</span></div><button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancelar resposta"><X size={17}/></button></div>}
              <footer className="wa-composer">
                <button
                  ref={flowToggleRef}
                  className={flowMenuOpen ? "active" : ""}
                  onClick={() => {
                    void loadFlows();
                    setFlowMenuOpen((open) => !open);
                    setEmojiOpen(false);
                  }}
                  aria-label="Enviar fluxo"
                  title="Fluxos de conversa"
                >
                  <GitBranch size={23} />
                </button>
                <button
                  ref={emojiToggleRef}
                  onClick={() => {
                    setEmojiOpen(!emojiOpen);
                    setFlowMenuOpen(false);
                  }}
                  aria-label="Emojis"
                >
                  <Smile size={25} />
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Anexar arquivo"
                >
                  <Paperclip size={24} />
                </button>
                <input
                  ref={fileInputRef}
                  className="wa-file-input"
                  type="file"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    if (files.length) void sendFiles(files);
                    event.currentTarget.value = "";
                  }}
                />
                {flowMenuOpen && (
                  <div className="wa-flow-menu" ref={flowMenuRef}>
                    <header>
                      <GitBranch size={17} />
                      <div>
                        <b>Fluxos de conversa</b>
                        <small>Escolha uma sequência para enviar</small>
                      </div>
                      <button type="button" onClick={() => setFlowMenuOpen(false)} aria-label="Fechar fluxos de conversa"><X size={16}/></button>
                    </header>
                    {flows.length ? (
                      flows.map((flow) => (
                        <button
                          key={flow.id}
                          disabled={busy}
                          onClick={() => void sendFlow(flow)}
                        >
                          <b>{flow.name}</b>
                          <span>
                            {flow.description ||
                              `${flow.steps.length} mensagem${flow.steps.length === 1 ? "" : "s"}`}
                          </span>
                          <em>{flow.steps.length}</em>
                        </button>
                      ))
                    ) : (
                      <p>Nenhum fluxo ativo. Crie um em Configurações.</p>
                    )}
                  </div>
                )}
                {emojiOpen && (
                  <div className="wa-emojis" ref={emojiMenuRef}>
                    {emojis.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => setDraft((value) => value + emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                {recording ? (
                  <>
                    <span className="wa-recording-label">
                      {recordingPaused ? "Pausado" : "Gravando áudio"}
                    </span>
                    <button
                      onClick={discardRecording}
                      aria-label="Excluir gravação"
                    >
                      <Trash2 size={21} />
                    </button>
                    <button
                      onClick={pauseOrResumeRecording}
                      aria-label={
                        recordingPaused ? "Retomar gravação" : "Pausar gravação"
                      }
                    >
                      {recordingPaused ? (
                        <Play size={21} />
                      ) : (
                        <Pause size={21} />
                      )}
                    </button>
                    <button
                      className="wa-send"
                      onClick={sendRecording}
                      aria-label="Enviar áudio"
                    >
                      <Send size={21} />
                    </button>
                  </>
                ) : (
                  <>
                    {quickReplyOpen && <div className="quick-reply-menu" id="quick-reply-options" role="listbox" aria-label="Mensagens rápidas">
                      <small>Mensagens rápidas · ↑ ↓ para escolher · Enter para inserir</small>
                      {quickReplyMatches.map((reply, index) => <button type="button" role="option" aria-selected={index === quickReplyIndex} id={`quick-reply-${reply.id}`} key={reply.id} className={index === quickReplyIndex ? "active" : ""} onMouseDown={event => event.preventDefault()} onClick={() => insertQuickReply(reply)}><b>/{reply.shortcut}</b><span>{reply.text}</span></button>)}
                      {!quickReplyMatches.length && <p>{quickReplies.length ? "Nenhuma mensagem com esse atalho." : "Cadastre mensagens em Configurações → Mensagens rápidas."}</p>}
                    </div>}
                    <textarea
                      ref={composerInputRef}
                      rows={2}
                      aria-label="Mensagem"
                      aria-controls={quickReplyOpen ? "quick-reply-options" : undefined}
                      aria-activedescendant={quickReplyOpen && quickReplyMatches[quickReplyIndex] ? `quick-reply-${quickReplyMatches[quickReplyIndex].id}` : undefined}
                      value={draft}
                      onChange={(event) => { setDraft(event.target.value); if (!event.target.value.trim()) setPastedTextPending(false); }}
                      onPaste={(event) => { if (!event.clipboardData.files.length && event.clipboardData.getData("text/plain")) setPastedTextPending(true); }}
                      onKeyDown={(event) => {
                        if (quickReplyOpen && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setQuickReplyDismissed(true); return; }
                        if (quickReplyOpen && quickReplyMatches.length && ["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key) && !event.shiftKey) {
                          event.preventDefault();
                          if (event.key === "ArrowDown" || event.key === "ArrowUp") setQuickReplyIndex(current => (current + (event.key === "ArrowDown" ? 1 : -1) + quickReplyMatches.length) % quickReplyMatches.length);
                          else insertQuickReply(quickReplyMatches[Math.min(quickReplyIndex, quickReplyMatches.length - 1)]);
                          return;
                        }
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void sendMessage();
                        }
                      }}
                      placeholder="Digite uma mensagem ou cole um arquivo"
                    />
                    {draft.trim() ? (
                      <button
                        className="wa-send"
                        aria-label="Enviar mensagem"
                        onClick={() => void sendMessage()}
                      >
                        <Send size={21} />
                      </button>
                    ) : (
                      <button
                        aria-label="Gravar áudio"
                        onClick={startRecording}
                      >
                        <Mic size={24} />
                      </button>
                    )}
                  </>
                )}
              </footer>
            </>
          ) : (
            <div className="wa-welcome">
              <div className="welcome-symbol">
                <MessageCircle size={48} strokeWidth={1.5} />
                <span>
                  <CheckCheck size={20} />
                </span>
              </div>
              <span className="section-kicker">BEM-VINDO AO SEU ESPAÇO</span>
              <h1>Cada conversa, mais próxima.</h1>
              <p>
                Escolha um contato ao lado para continuar o atendimento.
                <br />
                Sua equipe, suas conversas e os detalhes certos em um só lugar.
              </p>
              <div className="welcome-stats">
                <article>
                  <Inbox size={20} />
                  <strong>{chats.length}</strong>
                  <span>Conversas</span>
                </article>
                <article>
                  <Bell size={20} />
                  <strong>{chats.filter((c) => c.unread > 0).length}</strong>
                  <span>Não lidas</span>
                </article>
                <article>
                  <UserRound size={20} />
                  <strong>
                    {
                      chats.filter(
                        (c) => assignments[c.id]?.assigneeId === operator.id,
                      ).length
                    }
                  </strong>
                  <span>Com você</span>
                </article>
              </div>
              <button onClick={() => setContactsOpen(true)}>
                <UsersRound size={17} />
                Contatos
              </button>
              <small>Use os filtros para encontrar seus atendimentos.</small>
            </div>
          )}
        </section>
        {selected && (
          <aside
            className={`wa-details ${detailsOpen ? "profile-is-open" : "profile-is-closed"}`}
          >
            <header>
              <div>
                <span className="section-kicker">INFORMAÇÕES</span>
                <b>Perfil do contato</b>
              </div>
              <button
                onClick={() => setDetailsOpen(false)}
                aria-label="Fechar perfil"
              >
                <X size={20} />
              </button>
            </header>
            <section>
              <ContactAvatar chat={selected} className="wa-detail-avatar" />
              <b>{selected.name}</b>
              <small>{selected.phone || "Telefone não informado"}</small>
            </section>
            <section className="wa-assignment">
              <small>RESPONSÁVEL PELO ATENDIMENTO</small>
              <strong>
                {assignment?.assigneeName || "Nenhum atendente atribuído"}
              </strong>
              <p>
                {assignment
                  ? "Responsável por este atendimento"
                  : "Assuma para organizar o atendimento."}
              </p>
              <button
                className="wa-primary"
                disabled={savingAssignment || !operator}
                onClick={() => saveAssignment()}
              >
                {assignment ? "Assumir com minha conta" : "Assumir conversa"}
              </button>
              {(operator?.role === "admin" || operator?.canAssign) && (
                <div className="transfer-controls">
                  <label>
                    Encaminhar para
                    <select
                      aria-label="Atendente de destino"
                      value={transferId}
                      onChange={(e) => setTransferId(e.target.value)}
                    >
                      <option value="">Selecione um atendente</option>
                      {overview.agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="wa-primary"
                    disabled={!transferId || savingAssignment}
                    onClick={() => saveAssignment(transferId)}
                  >
                    Encaminhar atendimento
                  </button>
                </div>
              )}
              {assignment && (
                <button
                  className="wa-unassign"
                  disabled={savingAssignment}
                  onClick={clearAssignment}
                >
                  Remover atribuição
                </button>
              )}
            </section>
            <ContactProfile
              apiKey={config.apiKey}
              dirtyRef={profileDirtyRef}
              key={`${config.sessionId}:${selected.id}:${profileReload}`}
              baseUrl={config.baseUrl}
              token={operatorToken}
              sessionId={config.sessionId}
              chatId={selected.id}
              contactName={selected.name}
              contactPhone={selected.phone}
              onSaved={(data) => {
                refreshGeneration.current++;
                setChats((current) =>
                  current.map((c) =>
                    c.id === selected.id
                      ? {
                          ...c,
                          name: data.name || data.phone || "Contato",
                          phone: data.phone,
                        }
                      : c,
                  ),
                );
                setSelected((current) =>
                  current
                    ? {
                        ...current,
                        name: data.name || data.phone || "Contato",
                        phone: data.phone,
                      }
                    : null,
                );
                void refreshChats();
              }}
              canEdit={
                operator?.role === "admin" || operator?.canAssign === true
              }
            />
          </aside>
        )}
      </section>
      <div className="message-alerts" aria-live="polite">
        {teamAlerts.map(alert => <article key={alert.id}>
          <button className="message-alert-open" onClick={() => { setTeamRoom(alert.room); setTeamChatOpen(true); setContactsOpen(false); setDashboardOpen(false); setTeamAlerts(current => current.filter(item => item.id !== alert.id)); }}>
            <b>{alert.mentioned ? `${alert.senderName} mencionou você` : `Equipe · ${alert.senderName}`}</b>
            <span>{alert.body}</span>
          </button>
          <button aria-label="Dispensar notificação da equipe" onClick={() => setTeamAlerts(current => current.filter(item => item.id !== alert.id))}><X size={16} /></button>
        </article>)}
        {messageAlerts.map((alert) => (
          <article key={alert.id}>
            <button
              className="message-alert-open"
              onClick={() => {
                setContactsOpen(false);
                setDashboardOpen(false);
                void chooseChat(
                  chats.find((c) => c.id === alert.chatId) || {
                    id: alert.chatId,
                    name: alert.name,
                    last: alert.body,
                    time: "",
                    unread: 1,
                  },
                );
              }}
            >
              <b>{alert.name}</b>
              <span>{alert.body}</span>
            </button>
            <button
              aria-label="Dispensar notificação"
              onClick={() =>
                setMessageAlerts((current) =>
                  current.filter((a) => a.id !== alert.id),
                )
              }
            >
              <X size={16} />
            </button>
          </article>
        ))}
      </div>
      {notice && (
        <div className="workspace-feedback" role="status">
          <CircleAlert size={15} />
          <span>{notice}</span>
          <button aria-label="Dispensar aviso" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {pendingPaste && (
        <div className="wa-backdrop paste-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setPendingPaste(null); }}>
          <form className="forward-modal paste-modal" role="dialog" aria-modal="true" aria-labelledby="paste-confirm-title" onSubmit={event => { event.preventDefault(); void confirmPendingPaste(); }} onKeyDown={event => { if (event.key === "Escape" && !busy) setPendingPaste(null); }}>
            <header><div><h2 id="paste-confirm-title">Confirmar envio do conteúdo colado</h2><p>Confira antes de enviar para {pendingPaste.chatName}.</p></div><button type="button" onClick={() => setPendingPaste(null)} disabled={busy} aria-label="Fechar"><X size={20}/></button></header>
            {pendingPaste.kind === "text" ? <div className="paste-preview-text">{pendingPaste.text}</div> : <><ul className="paste-preview-files">{pendingPaste.files.map((file, index) => <PasteFilePreview key={`${file.name}-${index}`} file={file} index={index}/>)}</ul>{pendingPaste.omittedFiles > 0 && <p className="paste-omitted">Mais {pendingPaste.omittedFiles} arquivo(s) não serão enviados. O limite é 10 por vez.</p>}</>}
            <footer><button type="button" autoFocus onClick={() => setPendingPaste(null)} disabled={busy}>Cancelar</button><button type="submit" disabled={busy || (pendingPaste.kind === "text" && !draft.trim())}><Send size={16}/>Confirmar envio</button></footer>
          </form>
        </div>
      )}
      {forwardTarget && (
        <div className="wa-backdrop forward-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !forwardBusy) setForwardTarget(null); }}>
          <form className="forward-modal" role="dialog" aria-modal="true" aria-labelledby="forward-title" onSubmit={event => { event.preventDefault(); void sendForward(); }}>
            <header><div><h2 id="forward-title">Encaminhar mensagem</h2><p>Escolha até 10 contatos para receber a mensagem original.</p></div><button type="button" onClick={() => setForwardTarget(null)} disabled={forwardBusy} aria-label="Fechar"><X size={20}/></button></header>
            <div className="forward-preview"><Forward size={17}/><span>{forwardTarget.message.body || ({ image: "Foto", video: "Vídeo", audio: "Áudio", voice: "Áudio", document: "Arquivo" } as Record<string, string>)[forwardTarget.message.type] || "Mensagem"}</span></div>
            <label className="forward-search"><Search size={17}/><input autoFocus aria-label="Buscar contato para encaminhar" value={forwardSearch} onChange={event => setForwardSearch(event.target.value)} placeholder="Buscar contato ou número"/></label>
            {forwardToIds.length > 0 && <div className="forward-selected">{forwardToIds.map(id => <button key={id} type="button" disabled={forwardBusy} onClick={() => toggleForwardRecipient(id)}>{contactRows.find(contact => contact.id === id)?.name || id}<X size={13}/></button>)}</div>}
            <div className="forward-contact-list" role="group" aria-label="Contatos de destino">
              {forwardCandidates.slice(0,80).map(contact => <label key={contact.id} className="forward-contact"><input type="checkbox" disabled={forwardBusy} checked={forwardToIds.includes(contact.id)} onChange={() => toggleForwardRecipient(contact.id)}/><span className="forward-contact-avatar">{contact.name.charAt(0).toUpperCase()}</span><span className="forward-contact-name"><b>{contact.name}</b><small>{contact.phone || contact.id.replace(/@.*/, "")}</small></span></label>)}
              {!forwardCandidates.length && <p className="forward-empty">Nenhum contato encontrado.</p>}
              {forwardCandidates.length > 80 && <p className="forward-more">Mostrando os primeiros 80 contatos. Refine a busca para encontrar outros.</p>}
            </div>
            {forwardError && <p className="forward-error" role="alert">{forwardError}</p>}
            <footer><button type="button" onClick={() => setForwardTarget(null)} disabled={forwardBusy}>Cancelar</button><button type="submit" disabled={forwardBusy || !forwardToIds.length}><Forward size={17}/>{forwardBusy ? "Encaminhando…" : `Encaminhar para ${forwardToIds.length}`}</button></footer>
          </form>
        </div>
      )}
      {newChatOpen && (
        <div className="wa-backdrop">
          <form className="wa-modal new-contact-modal" role="dialog" aria-modal="true" aria-labelledby="new-contact-title" onSubmit={(event) => { event.preventDefault(); void startChat(); }}>
            <header>
              <h2 id="new-contact-title">Adicionar novo contato</h2>
              <button type="button" onClick={() => setNewChatOpen(false)} aria-label="Fechar">
                <X />
              </button>
            </header>
            <div className="new-contact-fields">
              <p>Por favor adicione o nome e número de WhatsApp do contato que você deseja criar.</p>
              <input autoFocus aria-label="Primeiro nome" autoComplete="given-name" maxLength={80} value={contactFirstName} onChange={(event) => setContactFirstName(event.target.value)} placeholder="Primeiro nome" />
              <input aria-label="Segundo nome" autoComplete="family-name" maxLength={80} value={contactLastName} onChange={(event) => setContactLastName(event.target.value)} placeholder="Segundo nome" />
              <div className="new-contact-phone"><select aria-label="Código do país" value={contactCountryCode} onChange={(event) => setContactCountryCode(event.target.value)}><option value="55">🇧🇷 +55</option><option value="1">🇺🇸 +1</option><option value="351">🇵🇹 +351</option><option value="34">🇪🇸 +34</option><option value="54">🇦🇷 +54</option></select><input aria-label="Número do WhatsApp com DDD" type="tel" inputMode="tel" autoComplete="tel-national" maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="DDD + número" /></div>
              {contactFormError && <p className="new-contact-error" role="alert">{contactFormError}</p>}
            </div>
            <button
              type="submit"
              className="wa-primary"
              disabled={savingContact}
            >
              {savingContact ? "Criando…" : "Criar contato"}
            </button>
          </form>
        </div>
      )}
      {(settingsOpen || operatorOpen) && operator && (
        <SettingsScreen
          token={operatorToken}
          user={operator}
          name={operatorName}
          setName={setOperatorName}
          saveName={saveOperatorName}
          logout={logout}
          config={config}
          setConfig={setConfig}
          connect={connect}
          busy={busy}
          qr={qr}
          createSession={createSession}
          notificationsEnabled={notificationsEnabled}
          enableNotifications={enableNotifications}
          notificationPreferences={notificationPreferences}
          updateNotificationPreferences={updateNotificationPreferences}
          testNotification={testNotification}
          notice={notice}
          close={() => {
            setSettingsOpen(false);
            setOperatorOpen(false);
          }}
        />
      )}
    </main>
  );
}
