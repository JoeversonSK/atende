"use client";

import type { RefObject } from "react";
import { CheckCheck, Forward, Reply } from "lucide-react";
import type { ApiConfig } from "../../atende-api";
import { isGroupChat, messageDisplayText, type Chat, type Message, type MessageContactCard } from "../../conversation-model";
import { MessageAttachment, MessageContactCards, MessageText } from "./message-content";

export function ConversationThread({
  selected, messages, loading, config, areaRef, bottomRef, keepAtBottomRef, onReply, onForward, onOpenContact,
}: {
  selected: Chat;
  messages: Message[];
  loading: boolean;
  config: ApiConfig;
  areaRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  keepAtBottomRef: RefObject<boolean>;
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onOpenContact?: (card: MessageContactCard) => void;
}) {
  return <div ref={areaRef} className="wa-message-area" onScroll={event => {
    const area = event.currentTarget;
    keepAtBottomRef.current = area.scrollHeight - area.scrollTop - area.clientHeight < 100;
  }}>
    <p className="wa-encryption">Histórico da conversa · Atendimento da equipe</p>
    {loading ? <p className="wa-no-messages">Carregando mensagens…</p> : messages.length ?
      messages.map(message => {
        const hasAttachment = Boolean(message.media);
        const quotedId = message.quotedMessage?.id;
        const quotedOriginal = quotedId
          ? messages.find(candidate => candidate.waMessageId === quotedId || candidate.identityIds?.includes(quotedId))
          : undefined;
        return <div key={message.id} id={`wa-message-${message.id}`}
          className={`wa-message ${message.mine ? "mine" : ""}`}>
          <article>
            {isGroupChat(selected) && message.senderName && !message.mine &&
              <strong className="wa-message-author">{message.senderName}</strong>}
            {message.forwarded && <span className="wa-forwarded-label"><Reply size={13} />Encaminhada</span>}
            {message.quotedMessage && <button type="button" className="wa-quoted-message"
              onClick={() => quotedOriginal && document.getElementById(`wa-message-${quotedOriginal.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
              title={quotedOriginal ? "Ir para a mensagem original" : undefined}>
              <b>{quotedOriginal ? quotedOriginal.mine ? "Você" : selected.name : "Mensagem respondida"}</b>
              <span>{quotedOriginal ? messageDisplayText(quotedOriginal) : message.quotedMessage.body || "Mensagem original"}</span>
            </button>}
            <MessageAttachment message={message} config={config} chatId={selected.id} />
            {message.contactCards?.length ? <MessageContactCards cards={message.contactCards} onOpenContact={onOpenContact} /> : null}
            {message.body && !message.contactCards?.length && !(hasAttachment && ["Imagem", "Vídeo", "Áudio", "Mensagem de voz", "Figurinha", "Documento"].includes(message.body)) &&
              <MessageText text={message.body} />}
            <footer>
              {message.waMessageId && <button type="button" className="wa-message-reply"
                title="Responder a esta mensagem" aria-label="Responder a esta mensagem" onClick={() => onReply(message)}>
                <Reply size={14} />Responder</button>}
              {message.waMessageId && <button type="button" className="wa-message-forward"
                title="Encaminhar mensagem para contatos" aria-label="Encaminhar mensagem para contatos"
                onClick={() => onForward(message)}><Forward size={14} />Encaminhar</button>}
              <span>{message.time}</span>{message.mine && <CheckCheck size={15} />}
            </footer>
          </article>
        </div>;
      }) : <p className="wa-no-messages">Nenhuma mensagem nesta conversa ainda.</p>}
    <div ref={bottomRef} />
  </div>;
}
