"use client";

import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { ArrowLeft, CheckCheck, PanelRight, Paperclip, Reply, X } from "lucide-react";
import type { Chat, Message } from "../../conversation-model";
import type { Assignment } from "../ticket-actions";
import { ContactAvatar } from "./contact-avatar";
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
  thread: Omit<ComponentProps<typeof ConversationThread>, "selected">;
  composer: ComponentProps<typeof MessageComposer>;
  replyingTo: Message | null;
  onCancelReply: () => void;
  welcome: ComponentProps<typeof WorkspaceWelcome>;
};

export function ConversationPane({ selected, assignment, connected, canFinish, closing, closed, detailsOpen,
  onFinish, onToggleDetails, onClose, draggingFiles, setDraggingFiles, onFiles, thread, composer,
  replyingTo, onCancelReply, welcome }: Props) {
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
        <button className="wa-back" aria-label="Voltar às conversas" onClick={onClose}><ArrowLeft size={21} /></button>
        <ContactAvatar chat={selected} />
        <div className="wa-contact-title"><b>{selected.name}</b><small>{assignment
          ? `Em atendimento por ${assignment.assigneeName}`
          : connected ? "Sem atendente atribuído" : "aguardando conexão"}</small></div>
        <div className="wa-top-actions">
          {canFinish && <button className="finish-ticket" onClick={onFinish} disabled={closing || closed}
            title="Concluir atendimento e remover atribuição">
            <CheckCheck size={18} /><span>{closing ? "Encerrando…" : closed ? "Atendimento encerrado" : "Encerrar atendimento"}</span>
          </button>}
          <button className="profile-toggle" onClick={onToggleDetails} aria-label="Mostrar ou ocultar perfil do contato" aria-expanded={detailsOpen}>
            <PanelRight size={18} /><span>Perfil</span>
          </button>
          <button className="close-conversation" onClick={onClose} aria-label="Fechar conversa" title="Fechar conversa (Esc)"><X size={19} /></button>
        </div>
      </header>
      <ConversationThread selected={selected} {...thread} />
      {replyingTo && <div className="wa-reply-composer-preview"><Reply size={17} />
        <div><b>Respondendo à mensagem</b><span>{replyingTo.body || "Mídia"}</span></div>
        <button type="button" onClick={onCancelReply} aria-label="Cancelar resposta"><X size={17} /></button>
      </div>}
      <MessageComposer {...composer} />
    </> : <WorkspaceWelcome {...welcome} />}
  </section>;
}
