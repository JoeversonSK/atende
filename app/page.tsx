"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { LoginScreen, SettingsScreen } from "./account-panels";
import { operatorJson, operatorRequest, type ApiConfig } from "./atende-api";
import { authenticateOperator, logoutOperator, updateOperatorName } from "./operator-account";
import { useOperatorActivity, type OperatorIdentity } from "./operator-activity";
import { useWorkspacePolling, type TeamAlertFeed } from "./workspace-polling";
import { ContactsPanel } from "./contacts-panel";
import { TeamChat } from "./team-chat";
import { type Chat, type Message, type MessageWithTimestamp } from "./conversation-model";
import { ConversationSidebar } from "./conversations/components/conversation-sidebar";
import { WorkspaceRail, WorkspaceTopbar, type WorkspaceSection } from "./conversations/components/workspace-chrome";
import { WorkspaceAlerts, type TeamAlert } from "./conversations/components/workspace-alerts";
import { ConversationPane } from "./conversations/components/conversation-pane";
import { ConversationProfile } from "./conversations/components/conversation-profile";
import { ForwardMessageDialog, NewContactDialog, PasteConfirmationDialog, type PendingPaste } from "./conversations/components/conversation-dialogs";
import { availableContactTags, buildContactRows } from "./conversations/contact-list";
import { useContactCreation } from "./conversations/use-contact-creation";
import { useConversationActions } from "./conversations/conversation-actions";
import { useConversationSync } from "./conversations/use-conversation-sync";
import { useMessageForwarding } from "./conversations/use-message-forwarding";
import { emptyConfig, loadConfig, loadOperator, persistOperator } from "./conversations/workspace-storage";
import { useNotificationSettings } from "./conversations/use-notification-settings";
import { useConversationEvents } from "./conversations/use-conversation-events";
import { useVoiceRecorder } from "./conversations/use-voice-recorder";
import { useWorkspaceConnection } from "./conversations/use-workspace-connection";
import { type Assignment } from "./conversations/ticket-actions";
import { useTicketActions } from "./conversations/use-ticket-actions";
import type { ConversationFlow } from "./flow-settings";
import type { QuickReply } from "./quick-replies";
import {
  TicketDashboard,
  emptyOverview,
  type SupportOverview,
} from "./ticket-dashboard";
import {
  LoaderCircle,
} from "lucide-react";

type Config = ApiConfig;
type Operator = OperatorIdentity;
export type { NotificationPreferences } from "./conversations/workspace-storage";

export default function Home() {
  const [overview, setOverview] = useState<SupportOverview>(emptyOverview);
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
  const contactRows = useMemo(() => buildContactRows(chats, overview.contacts), [chats, overview.contacts]);
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
  const [loadingMessages, setLoadingMessages] = useState(false);
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
  const hasQuickReplyQuery = quickReplyQuery !== null;
  const quickReplyMatches = quickReplyQuery === null ? [] : quickReplies.filter(reply => reply.shortcut.startsWith(quickReplyQuery));
  const quickReplyOpen = hasQuickReplyQuery && !quickReplyDismissed;
  function updateDraft(value: SetStateAction<string>) {
    setDraft(value);
    setQuickReplyIndex(0);
    setQuickReplyDismissed(false);
  }
  function insertQuickReply(reply: QuickReply) {
    updateDraft(reply.text); setPastedTextPending(false); setQuickReplyDismissed(true);
    requestAnimationFrame(() => { composerInputRef.current?.focus(); composerInputRef.current?.setSelectionRange(reply.text.length, reply.text.length); });
  }
  const [busy, setBusy] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contactsReady, setContactsReady] = useState(false);
  const [messageAlerts, setMessageAlerts] = useState<
    { id: string; chatId: string; name: string; body: string }[]
  >([]);
  const {
    notificationsRef, notificationPreferencesRef, notificationsEnabled,
    notificationPreferences, customSound, customSoundBusy, playNotificationSound,
    updateNotificationPreferences, uploadNotificationSound, removeNotificationSound,
    enableNotifications, testNotification,
  } = useNotificationSettings({ operatorId: operator?.id, operatorToken, baseUrl: config.baseUrl, setNotice });
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiToggleRef = useRef<HTMLButtonElement>(null);
  const emojiMenuRef = useRef<HTMLDivElement>(null);
  const [flows, setFlows] = useState<ConversationFlow[]>([]);
  const [flowMenuOpen, setFlowMenuOpen] = useState(false);
  const flowToggleRef = useRef<HTMLButtonElement>(null);
  const flowMenuRef = useRef<HTMLDivElement>(null);
  const { recording, recordingPaused, startRecording,
    pauseOrResumeRecording, sendRecording, discardRecording } = useVoiceRecorder({
      onVoice: file => { void actions.sendMedia(file, true); }, setNotice,
    });
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messageAreaRef = useRef<HTMLDivElement | null>(null);
  const keepAtBottomRef = useRef(true);
  const scrolledChatRef = useRef("");
  const historyCacheRef = useRef(new Map<string, MessageWithTimestamp[]>());
  const profilePicturesRef = useRef(new Map<string, string | null>());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);
  const chatsRef = useRef<Chat[]>([]);
  const selectedRef = useRef<Chat | null>(null);
  const refreshChatsRef = useRef<(active?: Config) => Promise<void>>(
    async () => undefined,
  );
  const refreshMessagesRef = useRef<
    (chat: Chat, active?: Config, loadLiveHistory?: boolean) => Promise<void>
  >(async () => undefined);
  const operatorRef = useRef<Operator | null>(null);
  const contactCreation = useContactCreation({
    config, refreshGenerationRef: refreshGeneration, setOverview, setNewChatOpen, setContactsOpen,
    setDashboardOpen, setNotice,
  });
  const { refreshChats, refreshMessages, markRead } = useConversationSync({
    config, operatorToken, chats, selected, dashboardOpen, teamChatOpen, settingsOpen, operatorOpen,
    setStatus, setSyncWarning, setOverview, setChats, setSelected, setAssignments, setAssignment,
    setMessages, setNotice, readVersionsRef: readVersions, pendingReadsRef: pendingReads,
    lastReadAttemptRef: lastReadAttempt, refreshGenerationRef: refreshGeneration,
    refreshInFlightRef: refreshInFlight, refreshQueuedRef: refreshQueued,
    lastChatsRefreshRef: lastChatsRefresh, chatsRef, selectedRef, profilePicturesRef,
    historyCacheRef, refreshChatsRef, refreshMessagesRef,
  });
  const forwarding = useMessageForwarding({
    config, selected, canSend: operator?.role === "admin" || operator?.canSend !== false,
    contacts: contactRows, refreshChats, setNotice,
  });
  const { target: forwardTarget, setTarget: setForwardTarget, busy: forwardBusy } = forwarding;
  const { qr, setQr, connect, createSession } = useWorkspaceConnection({
    config, operatorToken, setConfig, setStatus, setNotice, setBusy, refreshChats,
  });
  const ticketActions = useTicketActions({
    config, selected, operator, selectedRef, profileDirtyRef,
    refreshGenerationRef: refreshGeneration, setAssignment, setAssignments,
    setOverview, setProfileReload, setNotice, setOperatorOpen, refreshChats,
  });

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
    const frame = window.requestAnimationFrame(() => {
      setActivityMenuOpen(false);
      setFlowMenuOpen(false);
      setEmojiOpen(false);
      setFilterMenuOpen(false);
    });
    return () => window.cancelAnimationFrame(frame);
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
    if (!operatorToken || !hasQuickReplyQuery) return;
    const abort = new AbortController();
    operatorJson<QuickReply[]>(config.baseUrl, operatorToken, "/quick-replies", { signal: abort.signal })
      .then(setQuickReplies).catch(error => { if (!abort.signal.aborted) setNotice(error.message); });
    return () => abort.abort();
  }, [config.baseUrl, operatorToken, hasQuickReplyQuery]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void loadFlows(); });
    return () => { active = false; };
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
    [setMessageAlerts],
  );

  const socketRef = useConversationEvents({
    config, operatorToken, chatsRef, selectedRef, operatorRef,
    refreshChatsRef, refreshMessagesRef, notificationsRef, notificationPreferencesRef,
    playNotificationSound, showMessageAlert, setQr, setStatus, setNotice,
  });

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
      const frame = window.requestAnimationFrame(() => setContactsReady(false));
      return () => window.cancelAnimationFrame(frame);
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

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const saved = loadConfig();
      setDetailsOpen(window.innerWidth > 1250);
      const savedOperator = loadOperator();
      setAuthLoaded(true);
      setConfig(saved);
      if (savedOperator) {
        setOperatorToken(savedOperator.token);
        operatorRequest(saved.baseUrl, savedOperator.token, "/me")
          .then(async (response) => {
            if (!active) return;
            if (!response.ok) {
              persistOperator(null);
              setOperatorToken("");
              return;
            }
            const user = (await response.json()) as Operator;
            if (active) {
              setOperator(user);
              setOperatorName(user.displayName);
            }
          })
          .catch(() => {
            if (active) setOperatorError("Não foi possível acessar o servidor. Tente entrar novamente.");
          });
      } else setOperatorOpen(true);
      if (saved.apiKey) setSettingsOpen(!saved.sessionId);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    operatorRef.current = operator;
  }, [operator]);
  useEffect(() => {
    const chatChanged = scrolledChatRef.current !== (selected?.id || "");
    if (chatChanged) {
      scrolledChatRef.current = selected?.id || "";
      keepAtBottomRef.current = true;
    }
    if (!keepAtBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages, selected?.id]);

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
    void ticketActions.loadAssignment(chat);
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
  const closeConversation = useCallback(() => {
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
  }, [setSelected, setReplyingTo, setForwardTarget, setFlowMenuOpen, setEmojiOpen]);
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
    setForwardTarget,
    closeConversation,
  ]);
  async function submitOperator() {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      setOperatorError("");
      const data = await authenticateOperator(config.baseUrl, registering,
        operatorUsername, operatorName, operatorPassword);
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
      const user = await updateOperatorName(config.baseUrl, operatorToken, operatorName);
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
  const actions = useConversationActions({
    config, operator, operatorToken, selected, draft, pastedTextPending, pendingPaste,
    replyingTo, overview, busy, historyCacheRef, selectedRef,
    refreshGenerationRef: refreshGeneration, profileDirtyRef,
    setMessages, updateDraft, setPastedTextPending, setPendingPaste,
    setReplyingTo, setEmojiOpen, setNotice, setOperatorOpen, setBusy,
    setFlowMenuOpen, setAssignments, setOverview, setAssignment, setProfileReload,
    refreshMessages, refreshChats,
  });
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
      await logoutOperator(config.baseUrl, operatorToken);
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
  function openSection(section: WorkspaceSection) {
    if (section === "settings") { setSettingsOpen(true); return; }
    if (section === "dashboard" && profileDirtyRef.current) {
      setNotice("Salve as alterações do contato antes de abrir o dashboard.");
      return;
    }
    if (section === "conversations") setFilter("all");
    if (section === "team") setTeamRoom("group");
    setSettingsOpen(false);
    setDashboardOpen(section === "dashboard");
    setContactsOpen(section === "contacts");
    setTeamChatOpen(section === "team");
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
      <WorkspaceTopbar operator={operator} activity={activity} notificationsEnabled={notificationsEnabled}
        enableNotifications={() => { void enableNotifications(); }} onProfile={() => setOperatorOpen(true)} />
      <section
        className={`wa-shell ${dashboardOpen || contactsOpen || teamChatOpen ? "dashboard-is-open" : ""}`}
      >
        <WorkspaceRail section={dashboardOpen ? "dashboard" : contactsOpen ? "contacts" : teamChatOpen ? "team" : "conversations"}
          teamUnread={teamUnread} onSelect={openSection} />
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
        <ConversationPane
          selected={selected}
          assignment={assignment}
          connected={connected}
          canFinish={operator.role === "admin" || operator.canAssign === true}
          closing={Boolean(selected && ticketActions.closingTickets.has(selected.id))}
          closed={Boolean(selected && overview.contacts.some(contact => contact.chatId === selected.id && contact.data.status === "closed"))}
          detailsOpen={detailsOpen}
          onFinish={() => { void ticketActions.finishTicket(); }}
          onToggleDetails={() => setDetailsOpen(open => !open)}
          onClose={closeConversation}
          draggingFiles={draggingFiles}
          setDraggingFiles={setDraggingFiles}
          onFiles={files => { void actions.sendFiles(files); }}
          thread={{
            messages, loading: loadingMessages, config, areaRef: messageAreaRef, bottomRef, keepAtBottomRef,
            onReply: message => {
              setReplyingTo(message);
              requestAnimationFrame(() => composerInputRef.current?.focus());
            },
            onForward: forwarding.open,
          }}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          composer={{
            flowToggleRef, flowMenuOpen, setFlowMenuOpen, loadFlows, setEmojiOpen,
            emojiToggleRef, emojiOpen, fileInputRef, sendFiles: files => { void actions.sendFiles(files); },
            flowMenuRef, flows, busy, sendFlow: flow => { void actions.sendFlow(flow); },
            emojiMenuRef, setDraft: updateDraft, recording, recordingPaused,
            discardRecording, pauseOrResumeRecording, sendRecording,
            quickReplyOpen, quickReplyMatches, quickReplyIndex, quickReplies, insertQuickReply,
            composerInputRef, draft, setPastedTextPending, setQuickReplyDismissed,
            setQuickReplyIndex, sendMessage: actions.sendMessage, startRecording,
          }}
          welcome={{ chats, assignments, operatorId: operator.id, onContacts: () => setContactsOpen(true) }}
        />
        {selected && <ConversationProfile
          selected={selected}
          detailsOpen={detailsOpen}
          setDetailsOpen={setDetailsOpen}
          assignment={assignment}
          savingAssignment={ticketActions.savingAssignment}
          operator={operator}
          saveAssignment={targetId => { void ticketActions.saveAssignment(targetId); }}
          clearAssignment={() => { void ticketActions.clearAssignment(); }}
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
      <WorkspaceAlerts teamAlerts={teamAlerts} messageAlerts={messageAlerts} notice={notice}
        onOpenTeam={alert => {
          setTeamRoom(alert.room);
          setTeamChatOpen(true);
          setContactsOpen(false);
          setDashboardOpen(false);
          setTeamAlerts(current => current.filter(item => item.id !== alert.id));
        }}
        onDismissTeam={id => setTeamAlerts(current => current.filter(item => item.id !== id))}
        onOpenMessage={alert => {
          setContactsOpen(false);
          setDashboardOpen(false);
          void chooseChat(chats.find(chat => chat.id === alert.chatId) || {
            id: alert.chatId, name: alert.name, last: alert.body, time: "", unread: 1,
          });
        }}
        onDismissMessage={id => setMessageAlerts(current => current.filter(alert => alert.id !== id))}
        onDismissNotice={() => setNotice("")} />
      {pendingPaste && <PasteConfirmationDialog
        pending={pendingPaste}
        draft={draft}
        busy={busy}
        onCancel={() => setPendingPaste(null)}
        onConfirm={() => { void actions.confirmPendingPaste(); }}
      />}
      {forwardTarget && <ForwardMessageDialog
        message={forwardTarget.message}
        busy={forwardBusy}
        search={forwarding.search}
        onSearch={forwarding.setSearch}
        selectedIds={forwarding.selectedIds}
        contacts={contactRows}
        candidates={forwarding.candidates}
        error={forwarding.error}
        onToggle={forwarding.toggleRecipient}
        onCancel={() => setForwardTarget(null)}
        onSend={() => { void forwarding.send(); }}
      />}
      {newChatOpen && <NewContactDialog
        firstName={contactCreation.firstName}
        onFirstName={contactCreation.setFirstName}
        lastName={contactCreation.lastName}
        onLastName={contactCreation.setLastName}
        countryCode={contactCreation.countryCode}
        onCountryCode={contactCreation.setCountryCode}
        phone={contactCreation.phone}
        onPhone={contactCreation.setPhone}
        error={contactCreation.error}
        saving={contactCreation.saving}
        onClose={() => setNewChatOpen(false)}
        onSubmit={() => { void contactCreation.start(); }}
      />}
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
