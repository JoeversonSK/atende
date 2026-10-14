"use client";

import { useState, type ComponentProps, type Dispatch, type SetStateAction } from "react";
import { ArrowLeft, CheckCheck, PanelRight, Paperclip, Reply, Search, X } from "lucide-react";
import { isGroupChat, type Chat, type Message } from "../../conversation-model";
import type { Assignment } from "../ticket-actions";
import { loadedSearchMessageId, type MessageSearchHit } from "../conversation-message-search";
import { ContactAvatar } from "./contact-avatar";
import { ConversationMessageSearch } from "./conversation-message-search";
import { ConversationThread } from "./conversation-thread";
import { MessageComposer } from "./message-composer";
import { WorkspaceWelcome } from "./workspace-chrome";

type Props = {
  selected: Chat | null;
  assignment: Assignment | null;
  connected: boolean;
  canFinish: boolean;
  closing: boolean;
  closed: boolean;
  detailsOpen: boolean;
  onFinish: () => void;
  onToggleDetails: () => void;
  onClose: () => void;
  draggingFiles: boolean;
  setDraggingFiles: Dispatch<SetStateAction<boolean>>;
  onFiles: (files: File[]) => void;
  thread: Omit<ComponentProps<typeof ConversationThread>, "selected" | "activeSearchMessageId">;
  composer: ComponentProps<typeof MessageComposer>;
  replyingTo: Message | null;
  onCancelReply: () => void;
  welcome: ComponentProps<typeof WorkspaceWelcome>;
};

export function ConversationPane({ selected, assignment, connected, canFinish, closing, closed, detailsOpen,
  onFinish, onToggleDetails, onClose, draggingFiles, setDraggingFiles, onFiles, thread, composer,
  replyingTo, onCancelReply, welcome }: Props) {
  const [searchChatId, setSearchChatId] = useState<string | null>(null);
  const [searchMatch, setSearchMatch] = useState<{ chatId: string; messageId: string } | null>(null);
  const searchOpen = Boolean(selected && searchChatId === selected.id);
  const activeSearchMessageId = selected && searchMatch?.chatId === selected.id ? searchMatch.messageId : null;

  function closeSearch() {
    setSearchChatId(null);
    setSearchMatch(null);
  }

  function selectSearchHit(hit: MessageSearchHit): boolean {
    if (!selected) return false;
    const messageId = loadedSearchMessageId(thread.messages, hit);
    setSearchMatch(messageId ? { chatId: selected.id, messageId } : null);
    if (!messageId) return false;
    requestAnimationFrame(() => document.getElementById(`wa-message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return true;
  }

  function closePane() {
    closeSearch();
    onClose();
  }

  return <section className={`wa-conversation ${draggingFiles ? "is-file-dragging" : ""}`}
    onDragOver={event => {
      if (Array.from(event.dataTransfer.types).includes("Files")) {
        event.preventDefault();
        setDraggingFiles(true);
      }
    }}
    onDragLeave={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFiles(false);
    }}
    onDrop={event => {
      event.preventDefault();
      setDraggingFiles(false);
      onFiles(Array.from(event.dataTransfer.files));
    }}>
    {draggingFiles && <div className="wa-file-drop-overlay">
      <Paperclip size={34} /><b>Solte para enviar</b><span>Imagens, PDFs, documentos e outros arquivos</span>
    </div>}
    {selected ? <>
      <header className="wa-conversation-header">
        <button className="wa-back" aria-label="Voltar às conversas" onClick={closePane}><ArrowLeft size={21} /></button>
        <ContactAvatar chat={selected} />
        <div className="wa-contact-title"><b>{selected.name}</b><small>{isGroupChat(selected) ? "Grupo do WhatsApp" : assignment
          ? assignment.state === "forwarded" ? `Encaminhado para ${assignment.assigneeName} · na fila de espera`
            : `Em atendimento por ${assignment.assigneeName}`
          : connected ? "Sem atendente atribuído" : "aguardando conexão"}</small></div>
        <div className="wa-top-actions">
          <button className="conversation-search-toggle" type="button" onClick={() => searchOpen ? closeSearch() : setSearchChatId(selected.id)}
            aria-label={searchOpen ? "Fechar busca na conversa" : "Buscar mensagens nesta conversa"}
            aria-expanded={searchOpen} title="Buscar mensagens nesta conversa"><Search size={18} /></button>
          {canFinish && <button className="finish-ticket" onClick={onFinish} disabled={closing || closed}
            title="Concluir atendimento e remover atribuição">
            <CheckCheck size={18} /><span>{closing ? "Encerrando…" : closed ? "Atendimento encerrado" : "Encerrar atendimento"}</span>
          </button>}
          <button className="profile-toggle" onClick={onToggleDetails} aria-label="Mostrar ou ocultar perfil do contato" aria-expanded={detailsOpen}>
            <PanelRight size={18} /><span>Perfil</span>
          </button>
          <button className="close-conversation" onClick={closePane} aria-label="Fechar conversa" title="Fechar conversa (Esc)"><X size={19} /></button>
        </div>
      </header>
      {searchOpen && <ConversationMessageSearch key={selected.id} chatId={selected.id} chatName={selected.name}
        config={thread.config} messages={thread.messages} onClose={closeSearch}
        onClearMatch={() => setSearchMatch(null)} onSelect={selectSearchHit} />}
      <ConversationThread selected={selected} {...thread} activeSearchMessageId={activeSearchMessageId} />
      {replyingTo && <div className="wa-reply-composer-preview"><Reply size={17} />
        <div><b>Respondendo à mensagem</b><span>{replyingTo.body || "Mídia"}</span></div>
        <button type="button" onClick={onCancelReply} aria-label="Cancelar resposta"><X size={17} /></button>
      </div>}
      <MessageComposer {...composer} />
    </> : <WorkspaceWelcome {...welcome} />}
  </section>;
}
