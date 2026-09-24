"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { LoginScreen, SettingsScreen } from "./account-panels";
import { connectionOrigin } from "./connection-origin";
import { ContactsPanel } from "./contacts-panel";
import { ContactProfile } from "./contact-profile";
import { TicketDashboard, emptyOverview, type SupportOverview } from "./ticket-dashboard";
import { Bell, ChevronRight, Inbox, PanelRight, UserRound, UsersRound, Wifi, WifiOff } from "lucide-react";
import { Archive, ArrowLeft, CheckCheck, CircleAlert, Filter, LoaderCircle, MessageCircle, Mic, MoreVertical, Paperclip, Pause, Phone, Play, Plus, Search, Send, Settings, Smile, Smartphone, Trash2, Video, X } from "lucide-react";

type Config = { baseUrl: string; apiKey: string; sessionId: string };
type Chat = { id: string; name: string; phone?:string; last: string; time: string; unread: number };
type Message = { id: string; body: string; time: string; mine: boolean; type: string; media?: { data: string; mimetype: string } };
type MessageWithTimestamp = Message & { timestamp: number };
type Account = { name: string; phone: string };
type Assignment = { assigneeName: string; assigneeId?: string; updatedAt?: string };
type Operator = { id: string; username: string; displayName: string; role?: string; active?: boolean; canSend?: boolean; canAssign?: boolean };
const storageKey = "atende-openwa-config";
const operatorStorageKey = "atende-operator-account";
const emptyConfig: Config = { baseUrl: "http://127.0.0.1:2785", apiKey: "", sessionId: "" };
const emojis = ["😀", "😂", "😍", "🙏", "👍", "🎉", "❤️", "👋"];
const eventId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");
const messageDateTime = (date: Date | null) => date && !Number.isNaN(date.valueOf())
  ? `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
  : "";

const initials = (value: string) => value.split(" ").filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "WA";
function loadConfig(): Config {
  try {
    const saved = localStorage.getItem(storageKey) || sessionStorage.getItem(storageKey) || "{}";
    const config = { ...emptyConfig, ...JSON.parse(saved) };
    return { ...config, baseUrl: connectionOrigin(config.baseUrl, window.location.origin) };
  } catch { return { ...emptyConfig, baseUrl: window.location.origin }; }
}
function persistConfig(config: Config) {
  const saved = JSON.stringify(config);
  localStorage.setItem(storageKey, saved);
  sessionStorage.setItem(storageKey, saved);
}
function loadOperator(): { user: Operator; token: string } | null { try { return JSON.parse(localStorage.getItem(operatorStorageKey) || "null"); } catch { return null; } }
function persistOperator(value: { user: Operator; token: string } | null) { if (value) localStorage.setItem(operatorStorageKey, JSON.stringify(value)); else localStorage.removeItem(operatorStorageKey); }
function request(config: Config, path: string, init?: RequestInit) {
  return fetch(`${config.baseUrl.replace(/\/$/, "")}/api${path}`, { ...init, headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey, "X-Atende-Token": loadOperator()?.token || "", ...(init?.headers || {}) } });
}
function errorMessage(data: unknown) { return typeof data === "object" && data && "message" in data ? String((data as { message: unknown }).message) : "Não foi possível concluir esta ação."; }
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
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const message = value as Record<string, unknown>;
    return String(message.body || message.text || message.content || "Sem mensagens");
  }
  return "Sem mensagens";
}
function toChat(value: Record<string, unknown>): Chat {
  const id = String(value.id || value.chatId || value.remoteJid || "");
  const stamp = value.timestamp || value.lastMessageAt;
  const date = stamp ? new Date(typeof stamp === "number" ? stamp * (stamp < 10_000_000_000 ? 1000 : 1) : String(stamp)) : null;
  return { id, name: String(value.name || value.pushName || value.contactName || value.phone || id.replace(/@.*/, "")), last: preview(value.lastMessage || value.lastMessageBody), time: date && !Number.isNaN(date.valueOf()) ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "", unread: Number(value.unreadCount || value.unread || 0) };
}
function toMessage(value: Record<string, unknown>): MessageWithTimestamp {
  const stamp = value.timestamp || value.createdAt || value.messageTimestamp;
  const timestamp = stamp ? new Date(typeof stamp === "number" ? stamp * (stamp < 10_000_000_000 ? 1000 : 1) : String(stamp)).valueOf() : 0;
  const date = timestamp ? new Date(timestamp) : null;
  const type = String(value.type || "").toLowerCase();
  const fallback = ({ sticker: "Figurinha", image: "Imagem", video: "Vídeo", audio: "Áudio", voice: "Mensagem de voz", document: "Documento", location: "Localização", contact: "Contato" } as Record<string, string>)[type] || "";
  const mediaValue = value.media && typeof value.media === "object" ? value.media as Record<string, unknown> : null;
  const media = mediaValue && typeof mediaValue.data === "string" && typeof mediaValue.mimetype === "string" ? { data: mediaValue.data, mimetype: mediaValue.mimetype } : undefined;
  return { id: String(value.waMessageId || value.id || value.messageId || eventId()), body: String(value.body || value.text || value.content || fallback), mine: Boolean(value.fromMe) || String(value.direction).toLowerCase() === "outgoing", time: messageDateTime(date), timestamp, type, media };
}

export default function Home() {
  const [overview,setOverview]=useState<SupportOverview>(emptyOverview);
  const [closingTickets,setClosingTickets]=useState<Set<string>>(()=>new Set());
  const [profileReload,setProfileReload]=useState(0);
  const [dashboardOpen,setDashboardOpen]=useState(false);
  const [syncWarning,setSyncWarning]=useState("");
  const [transferId,setTransferId]=useState("");
  const readVersions=useRef(new Map<string,number>());
  const pendingReads=useRef(new Set<string>());
  const lastReadAttempt=useRef(new Map<string,number>());
  const refreshGeneration=useRef(0);
  const [config, setConfig] = useState<Config>(emptyConfig);
  const [status, setStatus] = useState<"unconfigured" | "offline" | "ready" | "connected">("unconfigured");
  const [notice, setNotice] = useState("");
  const [chats, setChats] = useState<Chat[]>([]);
  const [selected, setSelected] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const profileDirtyRef = useRef(false);
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});
  const [operator, setOperator] = useState<Operator | null>(null);
  const [operatorToken, setOperatorToken] = useState("");
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [operatorUsername, setOperatorUsername] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [operatorPassword, setOperatorPassword] = useState("");
  const [operatorError, setOperatorError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [account, setAccount] = useState<Account>({ name: "WhatsApp", phone: "" });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "mine" | "unassigned">("all");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [contactsOpen,setContactsOpen]=useState(false);
  const [savingContact,setSavingContact]=useState(false);
  const [messageAlerts,setMessageAlerts]=useState<{id:string;chatId:string;name:string;body:string}[]>([]);
  const notificationsRef=useRef(false);
  const notifiedIds=useRef(new Set<string>());
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const historyCacheRef = useRef(new Map<string, MessageWithTimestamp[]>());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chatsRef = useRef<Chat[]>([]);
  const selectedRef = useRef<Chat | null>(null);
  const refreshChatsRef = useRef<(active?: Config) => Promise<void>>(async () => undefined);
  const refreshMessagesRef = useRef<(chat: Chat, active?: Config, loadLiveHistory?: boolean) => Promise<void>>(async () => undefined);
  const operatorRef = useRef<Operator | null>(null);

  function playNotificationSound() {
    try {
      const context = audioContextRef.current;
      if (!context) return;
      const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.frequency.setValueAtTime(880, context.currentTime); gain.gain.setValueAtTime(0.07, context.currentTime);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.14);
    } catch { /* Sound is optional when a browser blocks audio playback. */ }
  }
  async function enableNotifications() {
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      await audioContextRef.current.resume();
      notificationsRef.current=true;setNotificationsEnabled(true);
      let permission: NotificationPermission = "default";
      if(window.isSecureContext && "Notification" in window) permission=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;
      playNotificationSound();
      setNotice(permission==="granted"?"Som e notificações ativados neste computador.":"Som e avisos no canto da tela ativados. Mantenha o sistema aberto. Notificações fora da página exigem HTTPS e permissão do navegador.");
    } catch { setNotice("Não foi possível ativar o som. Clique novamente em Notificações."); }
  }

  const refreshChats = useCallback(async (active = config) => {
    if (!active.apiKey || !active.sessionId) return;
    const generation=++refreshGeneration.current;
    const readSnapshot=new Map(readVersions.current);
    const [metaResponse,response]=await Promise.all([request(active,`/operator-auth/contacts/${encodeURIComponent(active.sessionId)}`),request(active, `/sessions/${encodeURIComponent(active.sessionId)}/chats?limit=1000`).catch(()=>null)]);
    if(!metaResponse.ok)throw new Error("Não foi possível atualizar os perfis dos contatos.");
    const meta=await metaResponse.json() as SupportOverview;
    const live=!!response?.ok;
    let data:Record<string,unknown>[] = live?listFrom(await response!.json()):meta.activity.map(a=>({id:a.chatId,name:a.name||"Contato sem nome",timestamp:Math.max(Number(a.incoming),Number(a.outgoing)),lastMessage:"Histórico salvo"}));
    while(live&&data.length>0&&data.length%1000===0){
      const page=await request(active,`/sessions/${encodeURIComponent(active.sessionId)}/chats?limit=1000&offset=${data.length}`);
      if(!page.ok)throw new Error("Não foi possível carregar todas as conversas.");
      const batch=listFrom(await page.json());data=[...data,...batch];if(batch.length<1000)break;
    }
    if(generation!==refreshGeneration.current)return;
    setSyncWarning(live?"":"WhatsApp ainda não sincronizado. Exibindo os dados salvos; novas mensagens e leitura dependem da reconexão.");
    if(live)setStatus("ready");
    if(!live&&chatsRef.current.length)data=chatsRef.current.map(c=>({id:c.id,name:c.name,phone:c.phone,lastMessage:c.last,unreadCount:c.unread}));
    setOverview(meta);
    const next=listFrom(data).filter(chat=>chat.isGroup!==true&&!/@(g\.us|broadcast|newsletter)$/.test(String(chat.id||""))).map(value=>{
      const chat=toChat(value), profile=meta.contacts.find(p=>p.chatId===chat.id)?.data;
      return {...chat,name:profile?.name||chat.name,phone:profile?.phone||String(value.phone||(/@(c\.us|s\.whatsapp\.net)$/.test(chat.id)?chat.id.split("@")[0]:"")),unread:pendingReads.current.has(chat.id)||readSnapshot.get(chat.id)!==readVersions.current.get(chat.id)?0:chat.unread};
    });
    setChats(next);
    setSelected(current=>current?next.find(c=>c.id===current.id)||current:null);
    const owners = await request(active, `/sessions/${encodeURIComponent(active.sessionId)}/conversations/assignments`);
    if (owners.ok) {
      const rows = await owners.json() as (Assignment & { chatId: string })[];
      if(generation!==refreshGeneration.current)return;
      setAssignments(Object.fromEntries(rows.map((row) => [row.chatId, row])));
      if(selectedRef.current)setAssignment(rows.find(row=>row.chatId===selectedRef.current?.id)||null);
    }
  }, [config]);

  async function markRead(chatId:string,active=config){
    if(pendingReads.current.has(chatId))return;
    lastReadAttempt.current.set(chatId,Date.now());
    pendingReads.current.add(chatId);readVersions.current.set(chatId,(readVersions.current.get(chatId)||0)+1);
    setChats(current=>current.map(c=>c.id===chatId?{...c,unread:0}:c));
    try{const response=await request(active,`/sessions/${encodeURIComponent(active.sessionId)}/chats/read`,{method:"POST",body:JSON.stringify({chatId})});const result=await response.json();if(!response.ok||!result.success)throw new Error("O WhatsApp não confirmou a leitura. Tente abrir a conversa novamente.");}
    catch(error){setNotice(error instanceof Error?error.message:"Erro ao sincronizar leitura.");}
    finally{pendingReads.current.delete(chatId);readVersions.current.set(chatId,(readVersions.current.get(chatId)||0)+1);void refreshChatsRef.current(active).catch(()=>undefined);}
  }

  useEffect(()=>{
    const acknowledge=()=>{const chat=chats.find(c=>c.id===selected?.id);if(chat?.unread&&Date.now()-(lastReadAttempt.current.get(chat.id)||0)>15000&&!dashboardOpen&&!settingsOpen&&!operatorOpen&&document.visibilityState==="visible"&&document.hasFocus())void markRead(chat.id);};
    acknowledge();window.addEventListener("focus",acknowledge);document.addEventListener("visibilitychange",acknowledge);
    return()=>{window.removeEventListener("focus",acknowledge);document.removeEventListener("visibilitychange",acknowledge);};
  },[chats,selected?.id,dashboardOpen,settingsOpen,operatorOpen]);

  const refreshMessages = useCallback(async (chat: Chat, active = config, loadLiveHistory = false) => {
    if (!active.apiKey || !active.sessionId || !chat.id) return;
    const localPath = `/sessions/${encodeURIComponent(active.sessionId)}/messages?chatId=${encodeURIComponent(chat.id)}&limit=100&inlineMedia=false`;
    const historyPath = `/sessions/${encodeURIComponent(active.sessionId)}/messages/${encodeURIComponent(chat.id)}/history?limit=2000&deep=true`;
    const response = await request(active, loadLiveHistory ? historyPath : localPath);
    if (!response.ok && loadLiveHistory) {
      const fallback = await request(active, localPath);
      if (!fallback.ok) throw new Error(errorMessage(await fallback.json().catch(() => null)));
      const data = await fallback.json();
      const fallbackMessages = listFrom(data, "messages").map(toMessage).filter((message) => message.body).sort((a, b) => a.timestamp - b.timestamp);
      historyCacheRef.current.set(chat.id, fallbackMessages);
      if(selectedRef.current?.id===chat.id)setMessages(fallbackMessages);
      setNotice("O histórico ao vivo não respondeu; exibindo as mensagens já salvas.");
      return;
    }
    if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
    const data = await response.json();
    const applyRecords = (records: Record<string, unknown>[], replace = false) => {
      const incoming = records.map(toMessage).filter((message) => message.body);
      const combined = replace ? incoming : [...(historyCacheRef.current.get(chat.id)||[]), ...incoming];
      const next = [...new Map(combined.map((message) => [message.id, message])).values()].sort((a, b) => a.timestamp - b.timestamp);
      historyCacheRef.current.set(chat.id, next);
      if(selectedRef.current?.id===chat.id)setMessages(next);
    };
    applyRecords(listFrom(data, loadLiveHistory ? undefined : "messages"), loadLiveHistory);
    if (loadLiveHistory) {
      request(active, `/sessions/${encodeURIComponent(active.sessionId)}/messages/${encodeURIComponent(chat.id)}/history?limit=100&includeMedia=true`)
        .then(async (mediaResponse) => { if (mediaResponse.ok) applyRecords(listFrom(await mediaResponse.json())); })
        .catch(() => undefined);
    }
  }, [config]);

  const refreshAccount = useCallback(async (active = config) => {
    if (!active.apiKey || !active.sessionId) return;
    const response = await request(active, "/sessions?limit=100");
    if (!response.ok) return;
    const session = listFrom(await response.json()).find((item) => String(item.id || item.sessionId) === active.sessionId);
    if (session) setAccount({ name: String(session.pushName || session.name || "WhatsApp"), phone: String(session.phone || "") });
  }, [config]);

  useEffect(() => {
    const saved = loadConfig();
    setDetailsOpen(window.innerWidth > 1250);
    const savedOperator = loadOperator();
    setAuthLoaded(true);
    setConfig(saved);
    if (savedOperator) {
      setOperatorToken(savedOperator.token);
      fetch(`${saved.baseUrl.replace(/\/$/, "")}/api/operator-auth/me`, { headers: { "X-Atende-Token": savedOperator.token } })
        .then(async response => { if (!response.ok) { persistOperator(null); setOperatorToken(""); return; } const user = await response.json() as Operator; setOperator(user); setOperatorName(user.displayName); })
        .catch(() => setOperatorError("Não foi possível acessar o servidor. Tente entrar novamente."));
    }
    else setOperatorOpen(true);
    if (saved.apiKey) setSettingsOpen(!saved.sessionId);
    return () => { socketRef.current?.disconnect(); };
  }, []);
  useEffect(() => {
    if (!operatorToken || (config.apiKey && !config.apiKey.startsWith("atende_"))) return;
    const credential = `atende_${operatorToken}`;
    if (config.apiKey === credential && config.sessionId) return;
    const controller = new AbortController();
    void fetch(`${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/connection`, { headers: { "X-Atende-Token": operatorToken }, signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(errorMessage(result));
        if (!controller.signal.aborted) { setConfig(current => ({ ...current, apiKey: credential, sessionId: result.sessionId })); setNotice("Carregando as conversas da equipe…"); }
      }).catch(error => { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Não foi possível carregar a conexão da equipe."); });
    return () => controller.abort();
  }, [operatorToken, config.baseUrl, config.apiKey, config.sessionId]);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => { operatorRef.current = operator; }, [operator]);
  useEffect(() => {
    if (!operatorToken) return;
    let live = true;
    async function refreshAccess() {
      try {
        const response = await request(config, "/operator-auth/me");
        if (!live) return;
        if (response.status === 401) {
          persistOperator(null); setOperator(null); setOperatorToken(""); setSelected(null); setMessages([]); setChats([]);
          socketRef.current?.disconnect();
          setOperatorError("Sua sessão expirou ou a conta foi desativada. Entre novamente.");
        } else if (response.ok) {
          const user = await response.json() as Operator;
          if (live) { setOperator(user); persistOperator({ user, token: operatorToken }); }
        }
      } catch { /* A network outage does not erase the saved session. */ }
    }
    const timer = window.setInterval(refreshAccess, 15000);
    return () => { live = false; window.clearInterval(timer); };
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
      socket.emit("message", { type: "subscribe", sessionId: active.sessionId, events: ["message.received", "message.sent", "session.status", "session.qr"], requestId: eventId() });
    });
    socket.on("message", (event: { type?: string; payload?: { event?: string; sessionId?: string; data?: Record<string, unknown> } }) => {
      if (event.type !== "event" || event.payload?.sessionId !== active.sessionId) return;
      if (event.payload.event === "session.qr") setQr(String(event.payload.data?.qrCode || ""));
      if (event.payload.event === "message.received" || event.payload.event === "message.sent") {
        refreshChatsRef.current(active).catch(() => undefined);
        const current = selectedRef.current;
        if (current) refreshMessagesRef.current(current, active).catch(() => undefined);
      }
      if (event.payload.event === "message.received") {
        const data = event.payload.data || {};
        const chatId = String(data.chatId || data.from || "");
        if (!chatId || /@(g\.us|broadcast|newsletter)$/.test(chatId) || data.isGroup === true) return;
        const notificationOperatorId=operatorRef.current?.id;
        void request(active, `/operator-auth/notification?sessionId=${encodeURIComponent(active.sessionId)}&chatId=${encodeURIComponent(chatId)}`)
          .then(async (response) => {
            const eligibility = response.ok ? await response.json() as { allowed: boolean } : null;
            const currentOperator = operatorRef.current;
            if (!currentOperator || !eligibility?.allowed || currentOperator.id!==notificationOperatorId || !notificationsRef.current) return;
            const notificationId=String(data.id||data.messageId||data.waMessageId||eventId());
            if(notifiedIds.current.has(notificationId))return;
            notifiedIds.current.add(notificationId);if(notifiedIds.current.size>500)notifiedIds.current.delete(notifiedIds.current.values().next().value!);
            const sender = chatsRef.current.find((chat) => chat.id === chatId)?.name || String(data.chatName || data.author || data.from || "Novo contato");
            const body = String(data.body || data.text || "Nova mensagem");
            playNotificationSound();
            setMessageAlerts(current=>[...current.filter(a=>a.chatId!==chatId),{id:notificationId,chatId,name:sender,body}].slice(-4));
            if (window.isSecureContext && typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(sender, { body, tag: `atende-${chatId}` });
          }).catch(() => undefined);
      }
      if (event.payload.event === "session.status") setStatus(String(event.payload.data?.status).toLowerCase() === "connected" ? "connected" : "ready");
    });
    socket.on("connect_error", () => setNotice("Não foi possível ouvir os eventos agora; tentando reconectar automaticamente."));
    socketRef.current = socket;
    return () => { socket.disconnect(); if (socketRef.current === socket) socketRef.current = null; };
  }, [config.apiKey, config.baseUrl, config.sessionId, operatorToken]);
  useEffect(() => {
    if (!config.apiKey || !config.sessionId) return;
    const interval = window.setInterval(() => { refreshChats().catch(() => undefined); }, 8000);
    return () => window.clearInterval(interval);
  }, [config.apiKey, config.baseUrl, config.sessionId, refreshChats]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "auto" }); }, [messages, selected]);

  async function connect(active = config) {
    if (!active.apiKey) { setNotice("Informe a chave da API do OpenWA."); return; }
    setBusy(true);
    try {
      const health = await fetch(`${active.baseUrl.replace(/\/$/, "")}/api/health`);
      if (!health.ok) throw new Error("O OpenWA respondeu com erro.");
      let sessionId = active.sessionId;
      if (!sessionId) {
        const response = await request(active, "/sessions?limit=100");
        const data = await response.json();
        const first = listFrom(data)[0];
        if (first) sessionId = String(first.id || first.sessionId);
      }
      const next = { ...active, sessionId };
      setConfig(next); persistConfig(next);
      if(sessionId){
        const sessionResponse=await request(next,`/sessions/${encodeURIComponent(sessionId)}`);
        if(!sessionResponse.ok)throw new Error(errorMessage(await sessionResponse.json().catch(()=>null)));
        const session=await sessionResponse.json() as {status?:string};
        if(["failed","disconnected","created"].includes(String(session.status).toLowerCase())){
          setNotice("Restaurando a sessão existente do WhatsApp…");
          const restored=await request(next,`/sessions/${encodeURIComponent(sessionId)}/start`,{method:"POST"});
          if(!restored.ok)throw new Error(errorMessage(await restored.json().catch(()=>null)));
        }
      }
      setStatus(sessionId ? "ready" : "offline");
      setNotice(sessionId ? "Conectado. Carregando suas conversas." : "Crie uma sessão para conectar o WhatsApp.");
      if (sessionId) { await refreshChats(next); await refreshAccount(next); }
      setNotice("Conexão salva com sucesso.");
    } catch (error) {
      setStatus("offline");
      setNotice(error instanceof TypeError ? "Não foi possível acessar o OpenWA local." : error instanceof Error ? error.message : "Falha de conexão.");
    } finally { setBusy(false); }
  }
  async function createSession() {
    setBusy(true);
    try {
      const response = await request(config, "/sessions", { method: "POST", body: JSON.stringify({ name: `atende-${Date.now()}` }) });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
      const data = await response.json();
      const next = { ...config, sessionId: String(data.id || data.sessionId) };
      setConfig(next); persistConfig(next);
      await request(next, `/sessions/${encodeURIComponent(next.sessionId)}/start`, { method: "POST" });
      const qrResponse = await request(next, `/sessions/${encodeURIComponent(next.sessionId)}/qr`);
      const qrData = await qrResponse.json();
      setQr(String(qrData.qrCode || qrData.data || qrData));
      setStatus("ready"); setNotice("Sessão criada. Leia o QR Code no WhatsApp da empresa.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível criar a sessão."); }
    finally { setBusy(false); }
  }
  async function chooseChat(chat: Chat) {
    if (selected?.id !== chat.id && profileDirtyRef.current && !window.confirm("O perfil tem alterações não salvas. Deseja descartá-las e trocar de conversa?")) return;
    setMessageAlerts(current=>current.filter(a=>a.chatId!==chat.id));
    selectedRef.current=chat;setTransferId("");void markRead(chat.id);
    setSelected(chat); setEmojiOpen(false); setConversationMenuOpen(false); setAssignment(null); setChats((current) => current.map((item) => item.id === chat.id ? { ...item, unread: 0 } : item)); void loadAssignment(chat);
    const cached = historyCacheRef.current.get(chat.id);
    if (cached) { setMessages(cached); setLoadingMessages(false); return; }
    setMessages([]); setLoadingMessages(true);
    try { await refreshMessages(chat, config, true); } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível carregar as mensagens."); }
    finally { setLoadingMessages(false); }
  }
  function closeConversation() {
    if (profileDirtyRef.current && !window.confirm("Descartar as alterações não salvas do perfil?")) return;
    setSelected(null);
  }
  async function loadAssignment(chat: Chat, active = config) {
    if (!active.apiKey || !active.sessionId) return;
    try {
      const response = await request(active, `/sessions/${encodeURIComponent(active.sessionId)}/conversations/${encodeURIComponent(chat.id)}/assignment`);
      if (!response.ok) return;
      const data = await response.json() as Assignment | null;
      if(selectedRef.current?.id===chat.id)setAssignment(data);
    } catch { /* A conversation can still be used if assignment data is temporarily unavailable. */ }
  }
  async function saveAssignment(targetId?:string) {
    if (!selected || !operator) { setOperatorOpen(true); return; }
    setSavingAssignment(true);
    try {
      const response = await request(config, `/sessions/${encodeURIComponent(config.sessionId)}/conversations/${encodeURIComponent(selected.id)}/assignment`, { method: "PUT", body: JSON.stringify({ assigneeName: operator.displayName, assigneeId: targetId || operator.id }) });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
      const owner = await response.json() as Assignment;
      setAssignment(owner); setAssignments((current) => ({ ...current, [selected.id]: owner })); setNotice("Conversa atribuída com sucesso.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível atribuir a conversa."); }
    finally { setSavingAssignment(false); }
  }
  async function clearAssignment() {
    if (!selected) return;
    setSavingAssignment(true);
    try {
      const response = await request(config, `/sessions/${encodeURIComponent(config.sessionId)}/conversations/${encodeURIComponent(selected.id)}/assignment`, { method: "DELETE" });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
      setAssignment(null); setNotice("Conversa removida da fila do atendente.");
      setAssignments((current) => { const next = { ...current }; delete next[selected.id]; return next; });
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível remover a atribuição."); }
    finally { setSavingAssignment(false); }
  }
  async function finishTicket() {
    if (!selected || closingTickets.has(selected.id)) return;
    if (profileDirtyRef.current && !window.confirm("Há alterações não salvas no perfil. Deseja descartá-las e encerrar o atendimento?")) return;
    const chatId=selected.id;
    setClosingTickets(current=>new Set(current).add(chatId));
    try {
      const response=await request(config,`/operator-auth/contacts/${encodeURIComponent(config.sessionId)}/${encodeURIComponent(chatId)}/close`,{method:"POST"});
      const result=await response.json();
      if(!response.ok)throw new Error(errorMessage(result));
      refreshGeneration.current++;
      setAssignments(current=>{const next={...current};delete next[chatId];return next;});
      setOverview(current=>({...current,contacts:[...current.contacts.filter(c=>c.chatId!==chatId),{chatId,data:result.data}]}));
      if(selectedRef.current?.id===chatId){setAssignment(null);profileDirtyRef.current=false;setProfileReload(value=>value+1);}
      setNotice("Atendimento encerrado. A atribuição foi removida e o painel será atualizado.");
      void refreshChats().catch(()=>setNotice("Atendimento encerrado. O painel será atualizado na próxima sincronização."));
    } catch(error){setNotice(error instanceof Error?error.message:"Não foi possível encerrar o atendimento.");}
    finally{setClosingTickets(current=>{const next=new Set(current);next.delete(chatId);return next;});}
  }
  async function submitOperator() {
    if (authBusy) return;
    setAuthBusy(true);
    const endpoint = registering ? "register" : "login";
    const body = registering ? { username: operatorUsername, displayName: operatorName, password: operatorPassword } : { username: operatorUsername, password: operatorPassword };
    try {
      setOperatorError("");
      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
      const data = await response.json() as { user: Operator; token: string };
      setOperator(data.user); setOperatorToken(data.token); setOperatorName(data.user.displayName); persistOperator(data); setOperatorOpen(false); setNotice(`Você está conectado como ${data.user.displayName}.`);
    } catch (error) { const message = error instanceof TypeError ? "Não foi possível acessar o servidor. Confira se o computador do sistema está ligado e tente novamente." : error instanceof Error ? error.message : "Não foi possível entrar."; setOperatorError(message); setNotice(message); }
    finally { setAuthBusy(false); setOperatorPassword(""); }
  }
  async function saveOperatorName() {
    if (!operator || !operatorName.trim()) return;
    try { const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/me`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Atende-Token": operatorToken }, body: JSON.stringify({ displayName: operatorName.trim() }) }); if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null))); const user = await response.json() as Operator; setOperator(user); persistOperator({ user, token: operatorToken }); setNotice("Nome do usuário atualizado."); } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível atualizar o nome."); }
  }
  async function sendMessage() {
    if (!selected || !draft.trim()) return;
    if (operator?.role !== "admin" && operator?.canSend === false) { setNotice("Sua conta não tem permissão para enviar mensagens."); return; }
    if (!operatorToken) { setOperatorOpen(true); return; }
    setBusy(true);
    try {
      const profile = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/me`, { headers: { "X-Atende-Token": operatorToken } });
      if (!profile.ok) { setOperatorOpen(true); throw new Error("Entre novamente na sua conta para enviar mensagens."); }
      const sender = await profile.json() as Operator;
      setOperator(sender);
      const signedText = `*${sender.displayName}:*\n\n${draft.trim()}`;
      const response = await request(config, `/sessions/${encodeURIComponent(config.sessionId)}/messages/send-text`, { method: "POST", body: JSON.stringify({ chatId: selected.id, text: signedText }) });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
      setDraft(""); setEmojiOpen(false); await refreshMessages(selected); await refreshChats();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível enviar a mensagem."); }
    finally { setBusy(false); }
  }
  async function sendMedia(file: File, voiceNote = false) {
    if (!selected) return;
    if (operator?.role !== "admin" && operator?.canSend === false) { setNotice("Sua conta não tem permissão para enviar arquivos."); return; }
    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.onerror = () => reject(new Error("Não foi possível ler o arquivo.")); reader.readAsDataURL(file); });
      const mime = file.type || "application/octet-stream";
      const endpoint = voiceNote || mime.startsWith("audio/") ? "send-audio" : mime.startsWith("image/") ? "send-image" : mime.startsWith("video/") ? "send-video" : "send-document";
      const response = await request(config, `/sessions/${encodeURIComponent(config.sessionId)}/messages/${endpoint}`, { method: "POST", body: JSON.stringify({ chatId: selected.id, base64, mimetype: mime, filename: file.name, ...(endpoint === "send-audio" ? { ptt: voiceNote && mime.includes("ogg") } : {}) }) });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null)));
      await refreshMessages(selected, config, true); await refreshChats();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível enviar o arquivo."); }
    finally { setBusy(false); }
  }
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream); recorderRef.current = recorder; recordingChunksRef.current = []; discardRecordingRef.current = false;
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data); };
      recorder.onstop = () => { stream.getTracks().forEach((track) => track.stop()); setRecording(false); setRecordingPaused(false); const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" }); if (!discardRecordingRef.current && blob.size) void sendMedia(new File([blob], "mensagem-de-voz.webm", { type: blob.type }), true); };
      recorder.start(); setRecording(true); setNotice("Gravando áudio.");
    } catch { setNotice("Permita o uso do microfone para gravar um áudio."); }
  }
  function pauseOrResumeRecording() { const recorder = recorderRef.current; if (!recorder) return; if (recorder.state === "recording") { recorder.pause(); setRecordingPaused(true); } else if (recorder.state === "paused") { recorder.resume(); setRecordingPaused(false); } }
  function sendRecording() { if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop(); }
  function discardRecording() { discardRecordingRef.current = true; if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop(); else { setRecording(false); setRecordingPaused(false); } }
  async function startChat() {
    const number = phone.replace(/\D/g, "");
    if (savingContact) return;
    if (!/^\d{10,15}$/.test(number)) { setNotice("Informe um número válido com DDI e DDD, entre 10 e 15 dígitos."); return; }
    if (!config.sessionId) { setNotice("Configure a conexão WhatsApp antes de cadastrar contatos."); return; }
    setSavingContact(true);
    try {
      const id=`${number}@c.us`,path=`/operator-auth/contacts/${encodeURIComponent(config.sessionId)}/${encodeURIComponent(id)}`;
      const current=await request(config,path);const profile=await current.json();
      if(!current.ok)throw new Error(errorMessage(profile));
      const response=await request(config,path,{method:"PUT",body:JSON.stringify({...profile,data:{...profile.data,name:contactName.trim()||profile.data.name||number,phone:number}})});
      const saved=await response.json();if(!response.ok)throw new Error(errorMessage(saved));
      refreshGeneration.current++;
      setOverview(current=>({...current,contacts:[...current.contacts.filter(c=>c.chatId!==id),{chatId:id,data:saved.data}]}));
      setPhone("");setContactName("");setNewChatOpen(false);setContactsOpen(true);setDashboardOpen(false);setNotice("Contato salvo para toda a equipe.");
    } catch(error){setNotice(error instanceof Error?error.message:"Não foi possível salvar o contato.");}
    finally{setSavingContact(false);}
  }

  const contactRows=useMemo(()=>{const rows=new Map(chats.map(c=>[c.id,{id:c.id,name:c.name,phone:c.phone,tags:[] as string[]}]));for(const contact of overview.contacts){if(/@(g\.us|broadcast|newsletter)$/.test(contact.chatId))continue;const old=rows.get(contact.chatId);rows.set(contact.chatId,{id:contact.chatId,name:contact.data.name||old?.name||"Contato",phone:contact.data.phone||old?.phone,tags:(contact.data as {tags?:string[]}).tags||[]});}return [...rows.values()].sort((a,b)=>a.name.localeCompare(b.name));},[chats,overview.contacts]);
  const shownChats = useMemo(() => chats.filter((chat) => (filter === "all" || (filter === "unread" && chat.unread > 0) || (filter === "mine" && assignments[chat.id]?.assigneeId === operator?.id) || (filter === "unassigned" && !assignments[chat.id])) && (chat.name.toLowerCase().includes(search.toLowerCase()) || chat.id.includes(search))), [chats, filter, search, assignments, operator?.id]);
  const connected = status === "connected" || status === "ready";

  async function logout() {
    try { await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/operator-auth/logout`, { method: "POST", headers: { "X-Atende-Token": operatorToken } }); }
    catch { setNotice("Conta encerrada neste navegador."); }
    setMessageAlerts([]);notificationsRef.current=false;setNotificationsEnabled(false);persistOperator(null); setOperator(null); setOperatorToken(""); setSelected(null); setMessages([]); setChats([]); setOperatorPassword(""); setOperatorError(""); socketRef.current?.disconnect(); setOperatorOpen(false); setSettingsOpen(false);
  }
  if (!authLoaded) return <div className="app-loading"><LoaderCircle className="wa-spin" /> Carregando seu espaço…</div>;
  if (!operator) return <LoginScreen baseUrl={config.baseUrl} registering={registering} setRegistering={(value: boolean) => { setRegistering(value); setOperatorError(""); }} username={operatorUsername} setUsername={setOperatorUsername} name={operatorName} setName={setOperatorName} password={operatorPassword} setPassword={setOperatorPassword} error={operatorError} busy={authBusy} submit={submitOperator} />;

  return <main className="wa-app">
    <header className="workspace-topbar"><div className="workspace-brand"><span><MessageCircle size={22}/></span>atende</div><div className="workspace-account"><button className="notification-toggle" onClick={()=>void enableNotifications()} title="Ativar som e notificações neste computador"><Bell size={18}/><span>{notificationsEnabled?"Notificações ativas":"Ativar notificações"}</span></button><button onClick={()=>setOperatorOpen(true)} title="Meu perfil"><span className="account-avatar">{initials(operator.displayName)}</span><span><b>{operator.displayName}</b><small>{operator.role==="admin"?"Administrador":"Atendente"}</small></span></button></div></header>
    <section className={`wa-shell ${dashboardOpen||contactsOpen?"dashboard-is-open":""}`}>
    <nav className="workspace-rail" aria-label="Navegação principal"><button className={!dashboardOpen&&!contactsOpen?"active":""} onClick={()=>{setFilter("all");setSettingsOpen(false);setDashboardOpen(false);setContactsOpen(false);}} title="Todas as conversas"><Inbox size={22}/><span>Conversas</span></button><button className={contactsOpen?"active":""} onClick={()=>{setContactsOpen(true);setDashboardOpen(false);}} title="Contatos"><UsersRound size={22}/><span>Contatos</span></button><button className={dashboardOpen?"active":""} onClick={()=>{if(profileDirtyRef.current){setNotice("Salve as alterações do contato antes de abrir o dashboard.");return;}setDashboardOpen(true);setContactsOpen(false);}} title="Dashboard dos chamados"><UsersRound size={22}/><span>Painel</span></button><div className="rail-spacer"/><button onClick={()=>setSettingsOpen(true)} title="Configurações"><Settings size={22}/><span>Ajustes</span></button></nav>{contactsOpen&&<ContactsPanel contacts={contactRows} canCreate={operator.role==="admin"||operator.canAssign===true} onCreate={()=>setNewChatOpen(true)} onOpen={contact=>{setContactsOpen(false);void chooseChat(chats.find(c=>c.id===contact.id)||{...contact,last:"",time:"",unread:0});}}/>}
    {dashboardOpen&&<TicketDashboard warning={syncWarning} chats={chats} owners={assignments} overview={overview} onClose={()=>setDashboardOpen(false)} onOpen={id=>{const chat=chats.find(c=>c.id===id);if(chat){setDashboardOpen(false);setDetailsOpen(true);void chooseChat(chat);}}}/>}
    <aside className="wa-sidebar">
      <header className="wa-sidebar-header"><div><span className="section-kicker">CAIXA DE ENTRADA</span><h1>Conversas <span>{chats.length}</span></h1></div><button className="new-conversation-button" onClick={()=>{setContactsOpen(true);setDashboardOpen(false);}} aria-label="Contatos" title="Contatos"><Plus size={21}/></button></header>
      <div className="wa-search-bar"><label><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Buscar contato ou número" placeholder="Buscar contato ou número…" /></label><button onClick={() => setFilter(filter === "all" ? "unread" : "all")} aria-label="Filtrar"><Filter size={18} /></button></div>
      <div className="wa-filters" aria-label="Filtrar conversas">{([["all","Todas"],["unread","Não lidas"],["mine","Minhas"],["unassigned","Sem responsável"]] as const).map(([value,label])=><button key={value} aria-pressed={filter===value} className={filter===value?"active":""} onClick={()=>setFilter(value)}>{label}{value==="unread"&&chats.some(c=>c.unread>0)&&<span>{chats.filter(c=>c.unread>0).length}</span>}</button>)}</div><div className="list-caption"><span>{shownChats.length} conversa{shownChats.length===1?"":"s"}</span><span>MAIS RECENTES</span></div>
      {syncWarning&&<p className="sync-warning" role="status">{syncWarning}</p>}<div className="wa-chat-list">{shownChats.length ? shownChats.map((chat) => <button key={chat.id} onClick={() => chooseChat(chat)} aria-pressed={selected?.id === chat.id} className={`wa-chat ${selected?.id === chat.id ? "selected" : ""} ${chat.unread ? "has-unread" : ""}`}><span className="wa-avatar wa-contact">{initials(chat.name)}</span><span className="wa-chat-copy"><span><b>{chat.name}</b><time className={chat.unread ? "unread-time" : ""}>{chat.time}</time></span><span><i>{chat.last}</i>{assignments[chat.id] && <span className="wa-owner-marker" title={`Atribuído para ${assignments[chat.id].assigneeName}`} aria-label={`Atribuído para ${assignments[chat.id].assigneeName}`}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="7" r="4" /><path d="M4 21v-3a8 8 0 0 1 16 0v3Z" /></svg></span>}{chat.unread > 0 && <em>{chat.unread > 99 ? "99+" : chat.unread}</em>}</span><span className={`chat-owner-label ${assignments[chat.id] ? "assigned" : ""}`}><UserRound size={11}/>{assignments[chat.id]?.assigneeName || "Sem responsável"}</span></span></button>) : <div className="wa-list-empty"><MessageCircle size={28} /><p>{config.sessionId ? "Nenhuma conversa encontrada." : "Conecte o OpenWA para ver as conversas."}</p></div>}</div>
    </aside>
    <section className="wa-conversation">{selected ? <><header className="wa-conversation-header"><button className="wa-back" aria-label="Voltar às conversas" onClick={closeConversation}><ArrowLeft size={21} /></button><span className="wa-avatar wa-contact">{initials(selected.name)}</span><div className="wa-contact-title"><b>{selected.name}</b><small>{assignment ? `Em atendimento por ${assignment.assigneeName}` : connected ? "Sem atendente atribuído" : "aguardando conexão"}</small></div><div className="wa-top-actions">{(operator?.role==="admin"||operator?.canAssign)&&<button className="finish-ticket" onClick={()=>void finishTicket()} disabled={closingTickets.has(selected.id)||overview.contacts.some(c=>c.chatId===selected.id&&c.data.status==="closed")} title="Concluir atendimento e remover atribuição"><CheckCheck size={18}/><span>{closingTickets.has(selected.id)?"Encerrando…":overview.contacts.some(c=>c.chatId===selected.id&&c.data.status==="closed")?"Atendimento encerrado":"Encerrar atendimento"}</span></button>}<button className="profile-toggle" onClick={()=>setDetailsOpen(!detailsOpen)} aria-label="Mostrar ou ocultar perfil do contato" aria-expanded={detailsOpen}><PanelRight size={18}/><span>Perfil</span></button><button onClick={() => setConversationMenuOpen((open) => !open)} aria-label="Opções"><MoreVertical size={20} /></button>{conversationMenuOpen && <div className="wa-conversation-menu"><button onClick={() => { setConversationMenuOpen(false); setLoadingMessages(true); refreshMessages(selected, config, true).catch(() => undefined).finally(() => setLoadingMessages(false)); }}>Carregar histórico completo</button><button onClick={() => { setConversationMenuOpen(false); closeConversation(); }}>Fechar conversa</button></div>}</div></header>
      <div className="wa-message-area"><p className="wa-encryption">Histórico da conversa · Atendimento da equipe</p>{loadingMessages ? <p className="wa-no-messages">Carregando mensagens…</p> : messages.length ? messages.map((message) => { const source = message.media ? `data:${message.media.mimetype};base64,${message.media.data}` : ""; const visual = message.media && (message.type === "image" || message.type === "sticker") ? <img className="wa-media-image" src={source} alt={message.type === "sticker" ? "Figurinha" : "Imagem recebida"} /> : message.media && message.type === "video" ? <video className="wa-media-video" controls preload="metadata" src={source} /> : message.media && (message.type === "audio" || message.type === "voice") ? <audio className="wa-media-audio" controls src={source} /> : message.media && message.type === "document" ? <a className="wa-document" href={source} download="arquivo">Baixar documento</a> : null; return <div key={message.id} className={`wa-message ${message.mine ? "mine" : ""}`}><article>{visual}{message.body && !(visual && ["Imagem", "Vídeo", "Áudio", "Mensagem de voz", "Figurinha", "Documento"].includes(message.body)) && <p>{message.body}</p>}<footer>{message.time}{message.mine && <CheckCheck size={15} />}</footer></article></div>; }) : <p className="wa-no-messages">Nenhuma mensagem nesta conversa ainda.</p>}<div ref={bottomRef} /></div>
      <footer className="wa-composer"><button onClick={() => setEmojiOpen(!emojiOpen)} aria-label="Emojis"><Smile size={25} /></button><button onClick={() => fileInputRef.current?.click()} aria-label="Anexar arquivo"><Paperclip size={24} /></button><input ref={fileInputRef} className="wa-file-input" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void sendMedia(file); event.currentTarget.value = ""; }} />{emojiOpen && <div className="wa-emojis">{emojis.map((emoji) => <button key={emoji} onClick={() => setDraft((value) => value + emoji)}>{emoji}</button>)}</div>}{recording ? <><span className="wa-recording-label">{recordingPaused ? "Pausado" : "Gravando áudio"}</span><button onClick={discardRecording} aria-label="Excluir gravação"><Trash2 size={21} /></button><button onClick={pauseOrResumeRecording} aria-label={recordingPaused ? "Retomar gravação" : "Pausar gravação"}>{recordingPaused ? <Play size={21} /> : <Pause size={21} />}</button><button className="wa-send" onClick={sendRecording} aria-label="Enviar áudio"><Send size={21} /></button></> : <><input disabled={busy} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="Digite uma mensagem" />{draft.trim() ? <button className="wa-send" aria-label="Enviar mensagem" disabled={busy} onClick={sendMessage}><Send size={21} /></button> : <button aria-label="Gravar áudio" onClick={startRecording}><Mic size={24} /></button>}</>}</footer>
    </> : <div className="wa-welcome"><div className="welcome-symbol"><MessageCircle size={48} strokeWidth={1.5}/><span><CheckCheck size={20}/></span></div><span className="section-kicker">BEM-VINDO AO SEU ESPAÇO</span><h1>Cada conversa, mais próxima.</h1><p>Escolha um contato ao lado para continuar o atendimento.<br/>Sua equipe, suas conversas e os detalhes certos em um só lugar.</p><div className="welcome-stats"><article><Inbox size={20}/><strong>{chats.length}</strong><span>Conversas</span></article><article><Bell size={20}/><strong>{chats.filter(c=>c.unread>0).length}</strong><span>Não lidas</span></article><article><UserRound size={20}/><strong>{chats.filter(c=>assignments[c.id]?.assigneeId===operator.id).length}</strong><span>Com você</span></article></div><button onClick={()=>setContactsOpen(true)}><UsersRound size={17}/>Contatos</button><small>Use os filtros para encontrar seus atendimentos.</small></div>}</section>
    {selected && <aside className={`wa-details ${detailsOpen ? "profile-is-open" : "profile-is-closed"}`}><header><div><span className="section-kicker">INFORMAÇÕES</span><b>Perfil do contato</b></div><button onClick={() => setDetailsOpen(false)} aria-label="Fechar perfil"><X size={20} /></button></header><section><span className="wa-detail-avatar">{initials(selected.name)}</span><b>{selected.name}</b><small>{selected.phone || "Telefone não informado"}</small></section><section className="wa-assignment"><small>RESPONSÁVEL PELO ATENDIMENTO</small><strong>{assignment?.assigneeName || "Nenhum atendente atribuído"}</strong><p>{assignment ? "Responsável por este atendimento" : "Assuma para organizar o atendimento."}</p><button className="wa-primary" disabled={savingAssignment || !operator} onClick={()=>saveAssignment()}>{assignment ? "Assumir com minha conta" : "Assumir conversa"}</button>{(operator?.role==="admin"||operator?.canAssign)&&<div className="transfer-controls"><label>Encaminhar para<select aria-label="Atendente de destino" value={transferId} onChange={e=>setTransferId(e.target.value)}><option value="">Selecione um atendente</option>{overview.agents.map(a=><option key={a.id} value={a.id}>{a.displayName}</option>)}</select></label><button className="wa-primary" disabled={!transferId||savingAssignment} onClick={()=>saveAssignment(transferId)}>Encaminhar atendimento</button></div>}{assignment && <button className="wa-unassign" disabled={savingAssignment} onClick={clearAssignment}>Remover atribuição</button>}</section><ContactProfile apiKey={config.apiKey} dirtyRef={profileDirtyRef} key={`${config.sessionId}:${selected.id}:${profileReload}`} baseUrl={config.baseUrl} token={operatorToken} sessionId={config.sessionId} chatId={selected.id} contactName={selected.name} contactPhone={selected.phone} onSaved={data=>{refreshGeneration.current++;setChats(current=>current.map(c=>c.id===selected.id?{...c,name:data.name||data.phone||"Contato",phone:data.phone}:c));setSelected(current=>current?{...current,name:data.name||data.phone||"Contato",phone:data.phone}:null);void refreshChats();}} canEdit={operator?.role === "admin" || operator?.canAssign === true} /></aside>}
  </section>
  <div className="message-alerts" aria-live="polite">{messageAlerts.map(alert=><article key={alert.id}><button className="message-alert-open" onClick={()=>{setContactsOpen(false);setDashboardOpen(false);void chooseChat(chats.find(c=>c.id===alert.chatId)||{id:alert.chatId,name:alert.name,last:alert.body,time:"",unread:1});}}><b>{alert.name}</b><span>{alert.body}</span></button><button aria-label="Dispensar notificação" onClick={()=>setMessageAlerts(current=>current.filter(a=>a.id!==alert.id))}><X size={16}/></button></article>)}</div>
  {notice && <div className="workspace-feedback" role="status"><CircleAlert size={15}/><span>{notice}</span><button aria-label="Dispensar aviso" onClick={()=>setNotice("")}><X size={15}/></button></div>}
  {newChatOpen && <div className="wa-backdrop"><section className="wa-modal" role="dialog" aria-modal="true"><header><h2>Criar contato</h2><button onClick={() => setNewChatOpen(false)}><X /></button></header><p>Use o número com DDI e DDD. Exemplo: 5511999999999.</p><label>Nome do contato<input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Opcional" /></label><label>Número do WhatsApp<input autoFocus value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="5511999999999" /></label><button className="wa-primary" onClick={startChat} disabled={savingContact||!phone.replace(/\D/g, "")}>{savingContact?"Salvando…":"Salvar contato"}</button></section></div>}
  {(settingsOpen || operatorOpen) && operator && <SettingsScreen token={operatorToken} user={operator} name={operatorName} setName={setOperatorName} saveName={saveOperatorName} logout={logout} config={config} setConfig={setConfig} connect={connect} busy={busy} qr={qr} createSession={createSession} notificationsEnabled={notificationsEnabled} enableNotifications={enableNotifications} notice={notice} close={() => { setSettingsOpen(false); setOperatorOpen(false); }} />}
  </main>;
}
