import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { io, type Socket } from "socket.io-client";
import { request, type ApiConfig } from "../atende-api";
import { eventId, type Chat } from "../conversation-model";
import type { OperatorIdentity } from "../operator-activity";
import type { NotificationPreferences } from "./workspace-storage";

type Status = "unconfigured" | "offline" | "ready" | "connected";
type MessageAlert = { id: string; chatId: string; name: string; body: string };
type Current<T> = { current: T };
type EventData = Record<string, unknown>;

export function useConversationEvents({
  config, operatorToken, chatsRef, selectedRef, operatorRef, refreshChatsRef,
  refreshMessagesRef, notificationsRef, notificationPreferencesRef,
  playNotificationSound, showMessageAlert, setQr, setStatus, setNotice,
}: {
  config: ApiConfig;
  operatorToken: string;
  chatsRef: Current<Chat[]>;
  selectedRef: Current<Chat | null>;
  operatorRef: Current<OperatorIdentity | null>;
  refreshChatsRef: Current<(active?: ApiConfig) => Promise<void>>;
  refreshMessagesRef: Current<(chat: Chat, active?: ApiConfig, live?: boolean) => Promise<void>>;
  notificationsRef: Current<boolean>;
  notificationPreferencesRef: Current<NotificationPreferences>;
  playNotificationSound: () => void;
  showMessageAlert: (alert: MessageAlert) => void;
  setQr: Dispatch<SetStateAction<string | null>>;
  setStatus: Dispatch<SetStateAction<Status>>;
  setNotice: Dispatch<SetStateAction<string>>;
}) {
  const socketRef = useRef<Socket | null>(null);
  const notifiedIds = useRef(new Set<string>());
  const { baseUrl, apiKey, sessionId } = config;

  useEffect(() => {
    if (!operatorToken || !apiKey || !sessionId) return;
    const active: ApiConfig = { baseUrl, apiKey, sessionId };
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
        events: ["message.received", "message.sent", "conversation.assigned", "session.status", "session.qr"],
        requestId: eventId(),
      });
    });

    const notifyIncoming = (data: EventData) => {
      const chatId = String(data.chatId || data.from || "");
      if (!chatId || /@(g\.us|broadcast|newsletter)$/.test(chatId) || data.isGroup === true) return;
      const notificationOperatorId = operatorRef.current?.id;
      void request(active,
        `/operator-auth/notification?sessionId=${encodeURIComponent(active.sessionId)}&chatId=${encodeURIComponent(chatId)}`)
        .then(async response => {
          const eligibility = response.ok ? await response.json() as { allowed: boolean } : null;
          const currentOperator = operatorRef.current;
          const preferences = notificationPreferencesRef.current;
          if (!currentOperator || !eligibility?.allowed ||
            currentOperator.id !== notificationOperatorId || !notificationsRef.current || !preferences.notifyMessages)
            return;
          const notificationId = String(data.id || data.messageId || data.waMessageId || eventId());
          if (notifiedIds.current.has(notificationId)) return;
          notifiedIds.current.add(notificationId);
          if (notifiedIds.current.size > 500)
            notifiedIds.current.delete(notifiedIds.current.values().next().value!);
          const sender = chatsRef.current.find(chat => chat.id === chatId)?.name ||
            String(data.chatName || data.author || data.from || "Novo contato");
          const body = String(data.body || data.text || "Nova mensagem");
          playNotificationSound();
          showMessageAlert({ id: notificationId, chatId, name: sender, body });
          if (preferences.desktop && window.isSecureContext &&
            typeof Notification !== "undefined" && Notification.permission === "granted")
            new Notification(sender, {
              body: preferences.showPreview ? body : "Nova mensagem recebida",
              tag: `atende-${chatId}-${notificationId}`,
            });
        })
        .catch(() => undefined);
    };

    const notifyAssignment = (data: EventData) => {
      const currentOperator = operatorRef.current;
      const assigneeId = String(data.assigneeId || "");
      const assignedById = String(data.assignedById || "");
      if (!currentOperator || assigneeId !== currentOperator.id || assignedById === currentOperator.id) return;
      const chatId = String(data.chatId || "");
      if (!chatId) return;
      scheduleEventRefresh();
      const customer = chatsRef.current.find(chat => chat.id === chatId)?.name || "Novo atendimento";
      const assignedBy = String(data.assignedByName || "outro atendente");
      const body = `Atendimento encaminhado por ${assignedBy}.`;
      showMessageAlert({
        id: `assignment-${chatId}-${String(data.updatedAt || Date.now())}`,
        chatId, name: customer, body,
      });
      const preferences = notificationPreferencesRef.current;
      if (notificationsRef.current && preferences.notifyAssignments) {
        playNotificationSound();
        if (preferences.desktop && window.isSecureContext &&
          typeof Notification !== "undefined" && Notification.permission === "granted")
          new Notification("Novo atendimento atribuído", {
            body: preferences.showPreview ? `${customer} · ${body}` : "Você recebeu um novo atendimento.",
            tag: `atende-assignment-${chatId}-${String(data.updatedAt || Date.now())}`,
          });
      }
    };

    socket.on("message", (event: {
      type?: string;
      payload?: { event?: string; sessionId?: string; data?: EventData };
    }) => {
      if (event.type !== "event" || event.payload?.sessionId !== active.sessionId) return;
      const eventName = event.payload.event;
      const data = event.payload.data || {};
      if (eventName === "session.qr") setQr(String(data.qrCode || ""));
      if (eventName === "message.received" || eventName === "message.sent") scheduleEventRefresh();
      if (eventName === "message.received") notifyIncoming(data);
      if (eventName === "conversation.assigned") notifyAssignment(data);
      if (eventName === "session.status")
        setStatus(String(data.status).toLowerCase() === "connected" ? "connected" : "ready");
    });
    socket.on("connect_error", () =>
      setNotice("Não foi possível ouvir os eventos agora; tentando reconectar automaticamente."));
    socketRef.current = socket;
    return () => {
      window.clearTimeout(eventRefreshTimer);
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [apiKey, baseUrl, sessionId, operatorToken, chatsRef,
    selectedRef, operatorRef, refreshChatsRef, refreshMessagesRef,
    notificationsRef, notificationPreferencesRef, playNotificationSound,
    showMessageAlert, setQr, setStatus, setNotice]);
  return socketRef;
}
