"use client";

import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { ApiConfig } from "../atende-api";
import type { Chat, Message, MessageWithTimestamp } from "../conversation-model";
import type { SupportOverview } from "../dashboard-model";
import { fetchMessageRecords, fetchRecentMediaRecords, reconcileMessageRecords } from "./conversation-history";
import { buildSyncedChats, confirmChatRead, fetchChatSnapshot, fetchProfilePictures } from "./conversation-sync";
import { listAssignments, type Assignment } from "./ticket-actions";

type Setter<T> = Dispatch<SetStateAction<T>>;
type Refs = {
  readVersionsRef: RefObject<Map<string, number>>;
  pendingReadsRef: RefObject<Set<string>>;
  lastReadAttemptRef: RefObject<Map<string, number>>;
  refreshGenerationRef: RefObject<number>;
  refreshInFlightRef: RefObject<Promise<void> | null>;
  refreshQueuedRef: RefObject<ApiConfig | null>;
  lastChatsRefreshRef: RefObject<number>;
  chatsRef: RefObject<Chat[]>;
  selectedRef: RefObject<Chat | null>;
  profilePicturesRef: RefObject<Map<string, string | null>>;
  historyCacheRef: RefObject<Map<string, MessageWithTimestamp[]>>;
  refreshChatsRef: RefObject<(active?: ApiConfig) => Promise<void>>;
  refreshMessagesRef: RefObject<(chat: Chat, active?: ApiConfig, loadLiveHistory?: boolean) => Promise<void>>;
};
type Options = Refs & {
  config: ApiConfig;
  operatorToken: string;
  chats: Chat[];
  selected: Chat | null;
  dashboardOpen: boolean;
  teamChatOpen: boolean;
  settingsOpen: boolean;
  operatorOpen: boolean;
  setStatus: Setter<"unconfigured" | "offline" | "ready" | "connected">;
  setSyncWarning: Setter<string>;
  setOverview: Setter<SupportOverview>;
  setChats: Setter<Chat[]>;
  setSelected: Setter<Chat | null>;
  setAssignments: Setter<Record<string, Assignment>>;
  setAssignment: Setter<Assignment | null>;
  setMessages: Setter<Message[]>;
  setNotice: Setter<string>;
};

export function useConversationSync({
  config, operatorToken, chats, selected, dashboardOpen, teamChatOpen, settingsOpen, operatorOpen,
  setStatus, setSyncWarning, setOverview, setChats, setSelected, setAssignments, setAssignment,
  setMessages, setNotice, readVersionsRef, pendingReadsRef, lastReadAttemptRef,
  refreshGenerationRef, refreshInFlightRef, refreshQueuedRef, lastChatsRefreshRef, chatsRef,
  selectedRef, profilePicturesRef, historyCacheRef, refreshChatsRef, refreshMessagesRef,
}: Options) {
  const loadChats = useCallback(async (active = config) => {
    if (!active.apiKey || !active.sessionId) return;
    const generation = ++refreshGenerationRef.current;
    const readSnapshot = new Map(readVersionsRef.current);
    const { overview: meta, records: fetchedRecords, live } = await fetchChatSnapshot(active);
    let data = fetchedRecords;
    if (generation !== refreshGenerationRef.current) return;
    setSyncWarning(live ? "" : "WhatsApp ainda não sincronizado. Exibindo os dados salvos; novas mensagens e leitura dependem da reconexão.");
    if (live) setStatus("ready");
    if (!live && chatsRef.current.length) data = chatsRef.current.map(chat => ({
      id: chat.id, name: chat.name, isGroup: chat.isGroup, phone: chat.phone,
      lastMessage: chat.last, unreadCount: chat.unread,
    }));
    setOverview(meta);
    const syncOptions = () => ({
      records: data, overview: meta, pictures: profilePicturesRef.current, readSnapshot,
      readVersions: readVersionsRef.current, pendingReads: pendingReadsRef.current,
    });
    let next = buildSyncedChats(syncOptions());
    if (live) {
      const missing = next.filter(chat => !profilePicturesRef.current.has(chat.id)).slice(0, 50);
      const pictures = await fetchProfilePictures(active, missing.map(chat => chat.id));
      if (pictures) {
        for (const chat of missing) profilePicturesRef.current.set(chat.id, pictures[chat.id] || null);
        next = buildSyncedChats(syncOptions());
      }
    }
    setChats(next);
    setSelected(current => current ? next.find(chat => chat.id === current.id) || current : null);
    const rows = await listAssignments(active);
    if (rows) {
      if (generation !== refreshGenerationRef.current) return;
      setAssignments(Object.fromEntries(rows.map(row => [row.chatId, row])));
      if (selectedRef.current) setAssignment(rows.find(row => row.chatId === selectedRef.current?.id) || null);
    }
    lastChatsRefreshRef.current = Date.now();
  }, [config, refreshGenerationRef, readVersionsRef, setSyncWarning, setStatus, chatsRef, setOverview,
    profilePicturesRef, pendingReadsRef, setChats, setSelected, setAssignments, selectedRef,
    setAssignment, lastChatsRefreshRef]);

  const refreshChats = useCallback((active = config): Promise<void> => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = active;
      return refreshInFlightRef.current;
    }
    const task = (async () => {
      let next: ApiConfig | null = active;
      let lastError: unknown = null;
      while (next) {
        try { await loadChats(next); lastError = null; }
        catch (error) { lastError = error; }
        next = refreshQueuedRef.current;
        refreshQueuedRef.current = null;
      }
      if (lastError) throw lastError;
    })();
    refreshInFlightRef.current = task;
    const clear = () => { if (refreshInFlightRef.current === task) refreshInFlightRef.current = null; };
    void task.then(clear, clear);
    return task;
  }, [config, loadChats, refreshInFlightRef, refreshQueuedRef]);

  const markRead = useCallback(async (chatId: string, active = config) => {
    if (pendingReadsRef.current.has(chatId)) return;
    lastReadAttemptRef.current.set(chatId, Date.now());
    pendingReadsRef.current.add(chatId);
    readVersionsRef.current.set(chatId, (readVersionsRef.current.get(chatId) || 0) + 1);
    setChats(current => current.map(chat => chat.id === chatId ? { ...chat, unread: 0 } : chat));
    try { await confirmChatRead(active, chatId); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Erro ao sincronizar leitura."); }
    finally {
      pendingReadsRef.current.delete(chatId);
      readVersionsRef.current.set(chatId, (readVersionsRef.current.get(chatId) || 0) + 1);
      void refreshChatsRef.current(active).catch(() => undefined);
    }
  }, [config, pendingReadsRef, lastReadAttemptRef, readVersionsRef, setChats, setNotice, refreshChatsRef]);

  useEffect(() => {
    const acknowledge = () => {
      const chat = chats.find(item => item.id === selected?.id);
      if (chat?.unread && Date.now() - (lastReadAttemptRef.current.get(chat.id) || 0) > 15000 &&
        !dashboardOpen && !teamChatOpen && !settingsOpen && !operatorOpen &&
        document.visibilityState === "visible" && document.hasFocus()) void markRead(chat.id);
    };
    acknowledge();
    window.addEventListener("focus", acknowledge);
    document.addEventListener("visibilitychange", acknowledge);
    return () => {
      window.removeEventListener("focus", acknowledge);
      document.removeEventListener("visibilitychange", acknowledge);
    };
  }, [chats, selected?.id, dashboardOpen, teamChatOpen, settingsOpen, operatorOpen, markRead, lastReadAttemptRef]);

  const refreshMessages = useCallback(async (chat: Chat, active = config, loadLiveHistory = false) => {
    if (!active.apiKey || !active.sessionId || !chat.id) return;
    const fetched = await fetchMessageRecords(active, chat.id, loadLiveHistory);
    if (fetched.fallback) {
      const saved = reconcileMessageRecords([], fetched.records, "database");
      historyCacheRef.current.set(chat.id, saved);
      if (selectedRef.current?.id === chat.id) setMessages(saved);
      setNotice("O histórico ao vivo não respondeu; exibindo as mensagens já salvas.");
      return;
    }
    const applyRecords = (records: Record<string, unknown>[], source: "database" | "history", replace = false) => {
      const next = reconcileMessageRecords(historyCacheRef.current.get(chat.id) || [], records, source, replace);
      historyCacheRef.current.set(chat.id, next);
      if (selectedRef.current?.id === chat.id) setMessages(next);
    };
    applyRecords(fetched.records, fetched.source, loadLiveHistory);
    if (loadLiveHistory) void fetchRecentMediaRecords(active, chat.id)
      .then(records => { if (records) applyRecords(records, "history"); })
      .catch(() => undefined);
  }, [config, historyCacheRef, selectedRef, setMessages, setNotice]);

  useEffect(() => { chatsRef.current = chats; }, [chats, chatsRef]);
  useEffect(() => { selectedRef.current = selected; }, [selected, selectedRef]);
  useEffect(() => {
    refreshChatsRef.current = refreshChats;
    refreshMessagesRef.current = refreshMessages;
  }, [refreshChats, refreshMessages, refreshChatsRef, refreshMessagesRef]);
  useEffect(() => {
    if (!operatorToken || !config.apiKey || !config.sessionId) return;
    const active = config;
    let current = true;
    queueMicrotask(() => { if (current) refreshChats(active).catch(() => undefined); });
    return () => { current = false; };
  }, [config, operatorToken, refreshChats]);

  return { refreshChats, refreshMessages, markRead };
}
