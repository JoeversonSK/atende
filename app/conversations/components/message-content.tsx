"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ContactRound, Phone, X } from "lucide-react";
import { request, type ApiConfig } from "../../atende-api";
import {
  listFrom,
  messageIdentityIds,
  serializedMessageId,
  toMessage,
  type Message,
  type MessageMedia,
} from "../../conversation-model";

export function MessageContactCards({
  cards,
  onOpenContact,
}: {
  cards: NonNullable<Message["contactCards"]>;
  onOpenContact?: (card: NonNullable<Message["contactCards"]>[number]) => void;
}) {
  return <div className="wa-contact-cards" aria-label="Contato compartilhado">
    {cards.map((card, index) => {
      const content = <>
        <span className="wa-contact-card-avatar"><ContactRound size={23} /></span>
        <span className="wa-contact-card-copy"><strong>{card.name}</strong>{card.phone && <small><Phone size={12} />{card.phone}</small>}</span>
      </>;
      return (card.phone || card.waid) && onOpenContact
        ? <button type="button" className="wa-contact-card" key={`${card.name}-${card.phone}-${index}`}
            onClick={() => onOpenContact(card)} aria-label={`Abrir conversa com ${card.name}`} title="Abrir conversa">
            {content}
          </button>
        : <div className="wa-contact-card" key={`${card.name}-${card.phone || "sem-telefone"}-${index}`}>{content}</div>;
    })}
    <small className="wa-contact-card-label">Contato compartilhado</small>
  </div>;
}

export function MessageText({ text }: { text: string }) {
  const parts: (string | { url: string })[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const raw = match[0];
    const trailing = raw.match(/[),.!?;:\]}]+$/)?.[0] || "";
    const url = trailing ? raw.slice(0, -trailing.length) : raw;
    if (url) parts.push({ url });
    if (trailing) parts.push(trailing);
    cursor = match.index + raw.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  const renderText = (value: string, key: string) => {
    const fragments: React.ReactNode[] = [];
    const bold = /\*([^*\n]+)\*/g;
    let start = 0;
    let boldMatch: RegExpExecArray | null;
    while ((boldMatch = bold.exec(value))) {
      if (boldMatch.index > start) fragments.push(value.slice(start, boldMatch.index));
      fragments.push(<strong key={`${key}-bold-${boldMatch.index}`}>{boldMatch[1]}</strong>);
      start = boldMatch.index + boldMatch[0].length;
    }
    if (start < value.length) fragments.push(value.slice(start));
    return fragments.length ? fragments : value;
  };

  return <p>{parts.map((part, index) => typeof part === "string"
    ? <span key={`text-${index}`}>{renderText(part, `text-${index}`)}</span>
    : <a className="wa-message-link" href={part.url} target="_blank" rel="noopener noreferrer" key={`${part.url}-${index}`}>{part.url}</a>)}</p>;
}

const mediaSource = (media: MessageMedia) => media.data
  ? /^https?:\/\//i.test(media.data) ? media.data : `data:${media.mimetype};base64,${media.data}`
  : "";

export function MessageAttachment({ message, config, chatId }: {
  message: Message;
  config: ApiConfig;
  chatId: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const inlineVideoRef = useRef<HTMLVideoElement>(null);
  const viewerVideoRef = useRef<HTMLVideoElement>(null);
  const [fetchedSource, setFetchedSource] = useState("");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const media = message.media;
  const source = media?.data ? mediaSource(media) : fetchedSource;
  const mime = media?.mimetype.toLowerCase() || "";
  const isImage = message.type === "image" || message.type === "sticker" || mime.startsWith("image/");
  const isVideo = message.type === "video" || message.type === "gif" || mime.startsWith("video/");
  const isAudio = ["audio", "voice", "ptt"].includes(message.type) || mime.startsWith("audio/");

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
    if (media.data) return;
    const element = host.current;
    if (!element) return;
    let active = true;
    let objectUrl = "";
    const load = async () => {
      try {
        const response = await request(config,
          `/sessions/${encodeURIComponent(config.sessionId)}/messages/${encodeURIComponent(chatId)}/${encodeURIComponent(message.id)}/media`);
        if (response.ok) {
          objectUrl = URL.createObjectURL(await response.blob());
          if (active) {
            setFetchedSource(objectUrl);
            setFailed(false);
          }
          return;
        }
        // Mensagens antigas podem ter somente o envelope de mídia. Recupera pelo histórico.
        const historyResponse = await request(config,
          `/sessions/${encodeURIComponent(config.sessionId)}/messages/${encodeURIComponent(chatId)}/history?limit=100&includeMedia=true`);
        if (!historyResponse.ok) throw new Error("Mídia indisponível");
        const wanted = new Set(message.identityIds?.length
          ? message.identityIds.flatMap(messageIdentityIds)
          : messageIdentityIds(message.id));
        const record = listFrom(await historyResponse.json()).find(item => {
          const ids = [item.waMessageId, item.messageId, item.id]
            .map(serializedMessageId).filter(Boolean).flatMap(messageIdentityIds);
          return ids.some(id => wanted.has(id));
        });
        const recovered = record ? toMessage(record, "history").media : undefined;
        if (!recovered?.data) throw new Error("Mídia indisponível");
        if (active) {
          setFetchedSource(mediaSource(recovered));
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      }
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    }, { rootMargin: "300px" });
    observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [chatId, config, media, message.id, message.identityIds, retry]);

  if (!media) return null;
  const visual = source && isImage ? (
    <button className="wa-image-expand" onClick={openViewer} aria-label="Ampliar imagem">
      <img className="wa-media-image" src={source} alt={message.type === "sticker" ? "Figurinha" : "Imagem"} />
    </button>
  ) : source && isVideo ? (
    <video ref={inlineVideoRef} className="wa-media-video" controls preload="metadata" playsInline
      src={source} onDoubleClick={openViewer} title="Clique duas vezes para ampliar" />
  ) : source && isAudio ? (
    <audio className="wa-media-audio" controls preload="metadata" src={source} />
  ) : source && message.type === "document" ? (
    <a className="wa-document" href={source} download={media.filename || "arquivo"}>
      Baixar {media.filename || "documento"}
    </a>
  ) : null;

  return <div ref={host} className="wa-media-container">
    {visual || <button className="wa-media-placeholder" onClick={() => setRetry(value => value + 1)}>
      {failed ? "Mídia indisponível · tentar novamente" : "Carregando mídia…"}
    </button>}
    {viewerOpen && source && (isImage || isVideo) && <div className="wa-media-viewer" role="dialog" aria-modal="true"
      aria-label={isVideo ? "Visualizador de vídeo" : "Visualizador de imagem"}
      onMouseDown={event => { if (event.target === event.currentTarget) closeViewer(); }}>
      <div className="wa-media-viewer-card">
        <header><strong>{media.filename || (isVideo ? "Vídeo" : "Imagem")}</strong>
          <button onClick={closeViewer} aria-label="Fechar visualizador"><X size={22} /></button></header>
        {isVideo ? <video ref={viewerVideoRef} controls autoPlay playsInline src={source} />
          : <img className="wa-media-viewer-image" src={source} alt="Imagem ampliada" />}
      </div>
    </div>}
  </div>;
}
