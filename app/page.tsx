"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { LoginScreen, SettingsScreen } from "./account-panels";
import { apiRequest, errorMessage, operatorJson, operatorRequest, request, type ApiConfig } from "./atende-api";
import { OperatorActivityControl, useOperatorActivity, type OperatorIdentity } from "./operator-activity";
import { useWorkspacePolling, type TeamAlertFeed } from "./workspace-polling";
import { ContactsPanel } from "./contacts-panel";
import { TeamChat } from "./team-chat";
import { eventId, listFrom, mergeMessages, messageDateTime, messageIdentityIds, serializedMessageId,
  type Chat, type Message, type MessageWithTimestamp } from "./conversation-model";
import { ContactAvatar } from "./conversations/components/contact-avatar";
import { ConversationSidebar } from "./conversations/components/conversation-sidebar";
import { ConversationProfile } from "./conversations/components/conversation-profile";
import { ConversationThread } from "./conversations/components/conversation-thread";
import { MessageComposer } from "./conversations/components/message-composer";
import { PasteFilePreview } from "./conversations/components/paste-file-preview";
import { availableContactTags, buildContactRows, findForwardCandidates } from "./conversations/contact-list";
import { buildSyncedChats, fetchChatSnapshot, fetchProfilePictures } from "./conversations/conversation-sync";
import { deliverMedia, deliverText } from "./conversations/message-delivery";
import { createFlowTemplate } from "./conversations/flow-variables";
import { fetchMessageRecords, fetchRecentMediaRecords, reconcileMessageRecords } from "./conversations/conversation-history";
import { defaultNotificationPreferences, emptyConfig, loadConfig, loadNotificationPreferences, loadOperator,
  notificationStorageKey, persistConfig, persistOperator, type NotificationPreferences } from "./conversations/workspace-storage";
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

type Config = ApiConfig;
type PendingPaste =
  | { kind: "files"; files: File[]; omittedFiles: number; chatId: string; chatName: string }
  | { kind: "text"; text: string; chatId: string; chatName: string };
type TeamAlert = { id: string; room: string; senderName: string; body: string; mentioned: boolean };
type Account = { name: string; phone: string };
type Assignment = {
  assigneeName: string;
  assigneeId?: string;
  updatedAt?: string;
};
type Operator = OperatorIdentity;
export type { NotificationPreferences } from "./conversations/workspace-storage";
type CustomNotificationSound = { filename: string; mimetype: string; base64: string };

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
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshQueued = useRef<Config | null>(null);
  const lastChatsRefresh = useRef(0);
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
  const activity = useOperatorActivity({
    baseUrl: config.baseUrl,
    token: operatorToken,
    onOperatorChange: user => { setOperator(user); persistOperator({ user, token: operatorToken }); },
    onRefresh: () => { void refreshChats().catch(() => undefined); },
  });
  const { menuOpen: activityMenuOpen, setMenuOpen: setActivityMenuOpen, controlRef: activityControlRef } = activity;
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
  const customSoundRef = useRef<CustomNotificationSound | null>(null);
  const activeCustomAudioRef = useRef<HTMLAudioElement | null>(null);
  const [customSound, setCustomSound] = useState<CustomNotificationSound | null>(null);
  const [customSoundBusy, setCustomSoundBusy] = useState(false);
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
  }, [settingsOpen, operatorOpen, newChatOpen, dashboardOpen, contactsOpen, teamChatOpen, setActivityMenuOpen]);

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
  }, [activityMenuOpen, flowMenuOpen, emojiOpen, setActivityMenuOpen, activityControlRef]);

  function playNotificationSound() {
    try {
      const context = audioContextRef.current;
      const preferences = notificationPreferencesRef.current;
      if (!preferences.sound || preferences.volume <= 0) return;
      if (preferences.soundType === "custom" && customSoundRef.current) {
        activeCustomAudioRef.current?.pause();
        const sound = customSoundRef.current;
        const audio = new Audio(`data:${sound.mimetype};base64,${sound.base64}`);
        audio.volume = preferences.volume / 100;
        activeCustomAudioRef.current = audio;
        audio.onended = () => { if (activeCustomAudioRef.current === audio) activeCustomAudioRef.current = null; };
        void audio.play().catch(() => undefined);
        return;
      }
      if (!context) return;
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
      } as Record<Exclude<NotificationPreferences["soundType"], "custom">, number[][]>;
      for (const [frequency, offset, duration] of patterns[
        preferences.soundType === "custom" ? "classic" : preferences.soundType
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
    if (operator?.id) localStorage.setItem(`${notificationStorageKey}:${operator.id}`, JSON.stringify(next));
  }
  async function uploadNotificationSound(file: File) {
    if (!operatorToken || customSoundBusy) return;
    if (!file.size || file.size > 2 * 1024 * 1024) { setNotice("Escolha um áudio de até 2 MB."); return; }
    setCustomSoundBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
        reader.readAsDataURL(file);
      });
      const result = await operatorJson<CustomNotificationSound>(config.baseUrl, operatorToken, "/me/notification-sound", {
        method: "PUT", body: JSON.stringify({ filename: file.name, mimetype: file.type, base64 }),
      });
      customSoundRef.current = result;
      setCustomSound(result);
      updateNotificationPreferences({ sound: true, soundType: "custom" });
      setNotice("Áudio personalizado salvo para sua conta.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível salvar o áudio."); }
    finally { setCustomSoundBusy(false); }
  }
  async function removeNotificationSound() {
    if (!operatorToken || customSoundBusy) return;
    setCustomSoundBusy(true);
    try {
      await operatorJson<{ success: boolean }>(config.baseUrl, operatorToken, "/me/notification-sound", { method: "DELETE" });
      activeCustomAudioRef.current?.pause();
      customSoundRef.current = null;
      setCustomSound(null);
      if (notificationPreferencesRef.current.soundType === "custom") updateNotificationPreferences({ soundType: "classic" });
      setNotice("Áudio personalizado removido da sua conta.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível remover o áudio."); }
    finally { setCustomSoundBusy(false); }
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
    if (!operator?.id || !operatorToken) { activeCustomAudioRef.current?.pause(); customSoundRef.current = null; setCustomSound(null); return; }
    activeCustomAudioRef.current?.pause();
    customSoundRef.current = null;
    setCustomSound(null);
    const saved = loadNotificationPreferences(operator.id);
    notificationPreferencesRef.current = saved;
    notificationsRef.current = saved.enabled;
    setNotificationPreferences(saved);
    setNotificationsEnabled(saved.enabled);
    const abort = new AbortController();
    operatorJson<CustomNotificationSound | null>(config.baseUrl, operatorToken, "/me/notification-sound", { signal: abort.signal })
      .then(sound => {
        customSoundRef.current = sound;
        setCustomSound(sound);
        if (!sound && saved.soundType === "custom") updateNotificationPreferences({ soundType: "classic" });
        if (sound && !localStorage.getItem(`${notificationStorageKey}:${operator.id}`)) updateNotificationPreferences({ soundType: "custom" });
      })
      .catch(() => { if (!abort.signal.aborted) setNotice("Não foi possível carregar o áudio personalizado."); });
    return () => abort.abort();
  }, [operator?.id, operatorToken, config.baseUrl]);
  const loadFlows = useCallback(async () => {
    if (!operatorToken) return;
    try {
      const data = await operatorJson<ConversationFlow[]>(config.baseUrl, operatorToken, "/flows");
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
    operatorJson<QuickReply[]>(config.baseUrl, operatorToken, "/quick-replies", { signal: abort.signal })
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

  useWorkspacePolling({
    baseUrl: config.baseUrl,
    token: operatorToken,
    apiKey: config.apiKey,
    sessionId: config.sessionId,
    onTeamReset: () => { setTeamUnread(0); setTeamAlerts([]); },
    onTeamFeed: (result: TeamAlertFeed) => {
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
    },
    onOperator: value => {
      const user = value as Operator;
      setOperator(user);
      persistOperator({ user, token: operatorToken });
    },
    onSessionExpired: () => {
      persistOperator(null);
      setOperator(null);
      setOperatorToken("");
      setSelected(null);
      setMessages([]);
      setChats([]);
      socketRef.current?.disconnect();
      setOperatorError("Sua sessão expirou ou a conta foi desativada. Entre novamente.");
    },
    onReconcile: () => {
      const interval = socketRef.current?.connected ? 60000 : 15000;
      if (Date.now() - lastChatsRefresh.current < interval) return;
      void refreshChatsRef.current().catch(() => undefined);
    },
  });

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

  const loadChats = useCallback(
    async (active = config) => {
      if (!active.apiKey || !active.sessionId) return;
      const generation = ++refreshGeneration.current;
      const readSnapshot = new Map(readVersions.current);
      const { overview: meta, records: fetchedRecords, live } =
        await fetchChatSnapshot(active);
      let data = fetchedRecords;
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
      const syncOptions = () => ({
        records: data,
        overview: meta,
        pictures: profilePicturesRef.current,
        readSnapshot,
        readVersions: readVersions.current,
        pendingReads: pendingReads.current,
      });
      let next = buildSyncedChats(syncOptions());
      if (live) {
        const missing = next.filter(chat => !profilePicturesRef.current.has(chat.id)).slice(0, 50);
        const pictures = await fetchProfilePictures(active, missing.map(chat => chat.id));
        if (pictures) {
          for (const chat of missing)
            profilePicturesRef.current.set(chat.id, pictures[chat.id] || null);
          next = buildSyncedChats(syncOptions());
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
      lastChatsRefresh.current = Date.now();
    },
    [config],
  );

  const refreshChats = useCallback((active = config): Promise<void> => {
    if (refreshInFlight.current) {
      refreshQueued.current = active;
      return refreshInFlight.current;
    }
    const task = (async () => {
      let next: Config | null = active;
      let lastError: unknown = null;
      while (next) {
        try {
          await loadChats(next);
          lastError = null;
        } catch (error) {
          lastError = error;
        }
        next = refreshQueued.current;
        refreshQueued.current = null;
      }
      if (lastError) throw lastError;
    })();
    refreshInFlight.current = task;
    const clear = () => {
      if (refreshInFlight.current === task) refreshInFlight.current = null;
    };
    void task.then(clear, clear);
    return task;
  }, [config, loadChats]);

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
      const result = await response.json() as { success?: boolean };
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
      const fetched = await fetchMessageRecords(active, chat.id, loadLiveHistory);
      if (fetched.fallback) {
        const saved = reconcileMessageRecords([], fetched.records, "database");
        historyCacheRef.current.set(chat.id, saved);
        if (selectedRef.current?.id === chat.id) setMessages(saved);
        setNotice("O histórico ao vivo não respondeu; exibindo as mensagens já salvas.");
        return;
      }
      const applyRecords = (
        records: Record<string, unknown>[],
        source: "database" | "history",
        replace = false,
      ) => {
        const next = reconcileMessageRecords(
          historyCacheRef.current.get(chat.id) || [], records, source, replace,
        );
        historyCacheRef.current.set(chat.id, next);
        if (selectedRef.current?.id === chat.id) setMessages(next);
      };
      applyRecords(fetched.records, fetched.source, loadLiveHistory);
      if (loadLiveHistory)
        void fetchRecentMediaRecords(active, chat.id)
          .then(records => { if (records) applyRecords(records, "history"); })
          .catch(() => undefined);
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
      operatorRequest(saved.baseUrl, savedOperator.token, "/me")
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
    void operatorRequest(config.baseUrl, operatorToken, "/connection", { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { sessionId?: string };
        if (!response.ok) throw new Error(errorMessage(result));
        if (!controller.signal.aborted) {
          setConfig((current) => ({
            ...current,
            apiKey: credential,
            sessionId: result.sessionId || current.sessionId,
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
    let eventRefreshTimer = 0;
    let hasConnected = false;
    const scheduleEventRefresh = () => {
      if (eventRefreshTimer) return;
      eventRefreshTimer = window.setTimeout(() => {
        eventRefreshTimer = 0;
        void refreshChatsRef.current(active).catch(() => undefined);
        const current = selectedRef.current;
        if (current)
          void refreshMessagesRef.current(current, active).catch(() => undefined);
      }, 350);
    };
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
      if (hasConnected) scheduleEventRefresh();
      hasConnected = true;
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
          scheduleEventRefresh();
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
          scheduleEventRefresh();
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
      window.clearTimeout(eventRefreshTimer);
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
      const health = await apiRequest(active.baseUrl, "/health");
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
      const data = await response.json() as { id?: string; sessionId?: string };
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
      const qrData = await qrResponse.json() as { qrCode?: string; data?: string } | string;
      setQr(typeof qrData === "string" ? qrData : String(qrData.qrCode || qrData.data || qrData));
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
    setActivityMenuOpen,
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
      const result = await response.json() as { data: SupportOverview["contacts"][number]["data"] };
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
      const data = await operatorJson<{ user: Operator; token: string }>(config.baseUrl, "", `/${endpoint}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
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
      const user = await operatorJson<Operator>(config.baseUrl, operatorToken, "/me", {
        method: "PUT",
        body: JSON.stringify({ displayName: operatorName.trim() }),
      });
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
      const result = await deliverText(config, target.id, signedText, replyTarget);
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
    const profile = overview.contacts.find(contact => contact.chatId === target.id)?.data;
    const fill = createFlowTemplate(operator.displayName, target, profile);
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
      const result = await response.json() as { data: SupportOverview["contacts"][number]["data"] };
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
      await deliverMedia(config, target.id, file, voiceNote);
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
      const profile = await current.json() as {
        revision?: number;
        data: SupportOverview["contacts"][number]["data"];
      };
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
      const saved = await response.json() as { data: SupportOverview["contacts"][number]["data"] };
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

  const contactRows = useMemo(
    () => buildContactRows(chats, overview.contacts),
    [chats, overview.contacts],
  );
  const forwardCandidates = useMemo(
    () => findForwardCandidates(contactRows, forwardTarget?.chatId, forwardSearch),
    [contactRows, forwardTarget?.chatId, forwardSearch],
  );
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
    () => availableContactTags(contactRows),
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

  async function logout() {
    try {
      await operatorRequest(config.baseUrl, operatorToken, "/logout", { method: "POST" });
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
          <OperatorActivityControl operator={operator} activity={activity} controlRef={activityControlRef} />
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
          <button className="workspace-profile" onClick={() => setOperatorOpen(true)} title="Meu perfil">
            <span className="preview-avatar" aria-hidden="true">{operator.displayName?.slice(0, 1).toUpperCase()}</span>
            <b>{operator.displayName}</b>
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
        <ConversationSidebar
          search={search}
          setSearch={setSearch}
          filter={filter}
          setFilter={setFilter}
          tagFilter={tagFilter}
          setTagFilter={setTagFilter}
          filterMenuOpen={filterMenuOpen}
          setFilterMenuOpen={setFilterMenuOpen}
          filterMenuPage={filterMenuPage}
          setFilterMenuPage={setFilterMenuPage}
          filterPopoverRef={filterPopoverRef}
          availableChatTags={availableChatTags}
          shownChats={shownChats}
          chats={chats}
          selectedId={selected?.id}
          assignments={assignments}
          syncWarning={syncWarning}
          hasSession={Boolean(config.sessionId)}
          onChooseChat={chooseChat}
        />
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
              <ConversationThread
                selected={selected}
                messages={messages}
                loading={loadingMessages}
                config={config}
                areaRef={messageAreaRef}
                bottomRef={bottomRef}
                keepAtBottomRef={keepAtBottomRef}
                onReply={message => {
                  setReplyingTo(message);
                  requestAnimationFrame(() => composerInputRef.current?.focus());
                }}
                onForward={openForward}
              />
              {replyingTo && <div className="wa-reply-composer-preview"><Reply size={17}/><div><b>Respondendo à mensagem</b><span>{replyingTo.body || "Mídia"}</span></div><button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancelar resposta"><X size={17}/></button></div>}
              <MessageComposer
                flowToggleRef={flowToggleRef}
                flowMenuOpen={flowMenuOpen}
                setFlowMenuOpen={setFlowMenuOpen}
                loadFlows={loadFlows}
                setEmojiOpen={setEmojiOpen}
                emojiToggleRef={emojiToggleRef}
                emojiOpen={emojiOpen}
                fileInputRef={fileInputRef}
                sendFiles={files => { void sendFiles(files); }}
                flowMenuRef={flowMenuRef}
                flows={flows}
                busy={busy}
                sendFlow={flow => { void sendFlow(flow); }}
                emojiMenuRef={emojiMenuRef}
                setDraft={setDraft}
                recording={recording}
                recordingPaused={recordingPaused}
                discardRecording={discardRecording}
                pauseOrResumeRecording={pauseOrResumeRecording}
                sendRecording={sendRecording}
                quickReplyOpen={quickReplyOpen}
                quickReplyMatches={quickReplyMatches}
                quickReplyIndex={quickReplyIndex}
                quickReplies={quickReplies}
                insertQuickReply={insertQuickReply}
                composerInputRef={composerInputRef}
                draft={draft}
                setPastedTextPending={setPastedTextPending}
                setQuickReplyDismissed={setQuickReplyDismissed}
                setQuickReplyIndex={setQuickReplyIndex}
                sendMessage={sendMessage}
                startRecording={startRecording}
              />
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
        {selected && <ConversationProfile
          selected={selected}
          detailsOpen={detailsOpen}
          setDetailsOpen={setDetailsOpen}
          assignment={assignment}
          savingAssignment={savingAssignment}
          operator={operator}
          saveAssignment={targetId => { void saveAssignment(targetId); }}
          clearAssignment={() => { void clearAssignment(); }}
          transferId={transferId}
          setTransferId={setTransferId}
          agents={overview.agents}
          config={config}
          profileDirtyRef={profileDirtyRef}
          profileReload={profileReload}
          operatorToken={operatorToken}
          onContactSaved={data => {
            refreshGeneration.current++;
            setChats(current => current.map(chat => chat.id === selected.id
              ? { ...chat, name: data.name || data.phone || "Contato", phone: data.phone }
              : chat));
            setSelected(current => current
              ? { ...current, name: data.name || data.phone || "Contato", phone: data.phone }
              : null);
            void refreshChats();
          }}
        />}
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
          connect={connect}
          busy={busy}
          qr={qr}
          createSession={createSession}
          notificationsEnabled={notificationsEnabled}
          enableNotifications={enableNotifications}
          notificationPreferences={notificationPreferences}
          updateNotificationPreferences={updateNotificationPreferences}
          customSound={customSound}
          customSoundBusy={customSoundBusy}
          uploadNotificationSound={uploadNotificationSound}
          removeNotificationSound={removeNotificationSound}
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
