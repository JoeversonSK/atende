"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Send, UsersRound } from "lucide-react";

type Room = { id: string; displayName: string; lastMessage: string | null; lastAt: string | null; unread: number };
type Member = { id: string; displayName: string };
type TeamMessage = { id: string; senderId: string; senderName: string; recipientId: string | null; body: string; createdAt: string };
type RoomsResponse = { userId: string; members: Member[]; rooms: Room[] };

const mergeMessages = (existing: TeamMessage[], incoming: TeamMessage[]) => {
  const byId = new Map([...existing, ...incoming].map(message => [message.id, message]));
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
};
const clock = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";

export function TeamChat({ baseUrl, token }: { baseUrl: string; token: string }) {
  const [room, setRoom] = useState("group");
  const [data, setData] = useState<RoomsResponse>({ userId: "", members: [], rooms: [] });
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef(room);
  roomRef.current = room;
  const root = `${baseUrl.replace(/\/$/, "")}/api/operator-auth/team-chat`;

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${root}${path}`, {
      ...init,
      headers: { "X-Atende-Token": token, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(Array.isArray(body?.message) ? body.message.join(" ") : body?.message || "Não foi possível carregar o chat interno.");
    return body as T;
  }, [root, token]);

  const refreshRooms = useCallback(async () => {
    const next = await api<RoomsResponse>("/rooms");
    setData(next);
    if (next.rooms.some(item => item.id === roomRef.current && item.unread > 0)) {
      await api("/read", { method: "POST", body: JSON.stringify({ room: roomRef.current }) });
      setData(current => ({ ...current, rooms: current.rooms.map(item => item.id === roomRef.current ? { ...item, unread: 0 } : item) }));
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    let firstLoad = true;
    setMessages([]);
    setLoading(true);
    setHasOlder(false);
    setError("");
    const refresh = async () => {
      try {
        const nearBottom = !scrollRef.current || scrollRef.current.scrollHeight - scrollRef.current.clientHeight - scrollRef.current.scrollTop < 100;
        const [items] = await Promise.all([
          api<TeamMessage[]>(`/messages?room=${encodeURIComponent(room)}`),
          refreshRooms(),
        ]);
        if (!cancelled) {
          setMessages(current => mergeMessages(current, items));
          if (firstLoad) { setHasOlder(items.length === 100); firstLoad = false; }
          setLoading(false);
          if (nearBottom) window.requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end" }));
        }
      } catch (cause) {
        if (!cancelled) { setError(cause instanceof Error ? cause.message : "Falha ao carregar mensagens."); setLoading(false); }
      }
    };
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [api, refreshRooms, room]);

  useEffect(() => { if (!loading) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [room, loading]);

  async function loadOlder() {
    if (!messages.length || loadingOlder) return;
    setLoadingOlder(true);
    const oldHeight = scrollRef.current?.scrollHeight || 0;
    try {
      const items = await api<TeamMessage[]>(`/messages?room=${encodeURIComponent(room)}&before=${encodeURIComponent(messages[0].id)}`);
      setMessages(current => mergeMessages(items, current));
      setHasOlder(items.length === 100);
      window.requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop += scrollRef.current.scrollHeight - oldHeight; });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar histórico."); }
    finally { setLoadingOlder(false); }
  }

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    try {
      const sent = await api<TeamMessage>("/messages", { method: "POST", body: JSON.stringify({ room, body }) });
      setMessages(current => mergeMessages(current, [sent]));
      setDraft("");
      await refreshRooms();
      window.requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível enviar a mensagem."); }
    finally { setBusy(false); }
  }

  const currentRoom = data.rooms.find(item => item.id === room);
  return <section className="team-chat" aria-label="Chat interno">
    <aside className="team-chat-rooms">
      <header><span className="section-kicker">EQUIPE</span><h1>Chat interno</h1><small>Mensagens entre usuários do sistema</small></header>
      <div className="team-chat-room-list">
        {data.rooms.map(item => <button key={item.id} className={`team-chat-room${room === item.id ? " active" : ""}`} onClick={() => setRoom(item.id)}>
          <span className="team-chat-avatar">{item.id === "group" ? <UsersRound size={19} /> : item.displayName.trim().charAt(0).toUpperCase()}</span>
          <span className="team-chat-room-text"><b>{item.displayName}</b><small>{item.lastMessage || (item.id === "group" ? "Todos os usuários ativos" : "Inicie uma conversa")}</small></span>
          <span className="team-chat-room-meta"><small>{clock(item.lastAt)}</small>{item.unread > 0 && <b>{item.unread}</b>}</span>
        </button>)}
      </div>
    </aside>
    <div className="team-chat-main">
      <header className="team-chat-main-header"><span className="team-chat-avatar">{room === "group" ? <UsersRound size={19} /> : (currentRoom?.displayName || "").charAt(0).toUpperCase()}</span><div><b>{currentRoom?.displayName || "Conversa"}</b><small>{room === "group" ? `${data.members.length} usuários ativos` : "Conversa individual"}</small></div></header>
      <div className="team-chat-history" ref={scrollRef}>
        {hasOlder && <button className="team-chat-older" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}</button>}
        {loading ? <p className="team-chat-empty">Carregando mensagens…</p> : !messages.length ? <p className="team-chat-empty"><MessageCircle size={27} />Ainda não há mensagens nesta conversa.</p> : messages.map(message => <article key={message.id} className={`team-chat-message${message.senderId === data.userId ? " mine" : ""}`}><b>{message.senderId === data.userId ? "Você" : message.senderName}</b><p>{message.body}</p><time>{clock(message.createdAt)}</time></article>)}
        <div ref={bottomRef} />
      </div>
      {error && <p className="team-chat-error" role="alert">{error}</p>}
      <div className="team-chat-composer"><textarea aria-label="Mensagem para a equipe" placeholder="Escreva uma mensagem para a equipe…" maxLength={4000} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /><button aria-label="Enviar mensagem" disabled={busy || !draft.trim()} onClick={() => void send()}><Send size={19} /></button></div>
    </div>
  </section>;
}
