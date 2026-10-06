"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { GitBranch, Mic, Paperclip, Pause, Play, Send, Smile, Trash2, X } from "lucide-react";
import type { ConversationFlow } from "../../flow-settings";
import type { QuickReply } from "../../quick-replies";

const emojis = ["😀", "😂", "😍", "🙏", "👍", "🎉", "❤️", "👋"];

type Props = {
  flowToggleRef: RefObject<HTMLButtonElement | null>;
  flowMenuOpen: boolean;
  setFlowMenuOpen: Dispatch<SetStateAction<boolean>>;
  loadFlows: () => Promise<void>;
  setEmojiOpen: Dispatch<SetStateAction<boolean>>;
  emojiToggleRef: RefObject<HTMLButtonElement | null>;
  emojiOpen: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  sendFiles: (files: File[]) => void;
  flowMenuRef: RefObject<HTMLDivElement | null>;
  flows: ConversationFlow[];
  busy: boolean;
  sendFlow: (flow: ConversationFlow) => void;
  emojiMenuRef: RefObject<HTMLDivElement | null>;
  setDraft: Dispatch<SetStateAction<string>>;
  recording: boolean;
  recordingPaused: boolean;
  discardRecording: () => void;
  pauseOrResumeRecording: () => void;
  sendRecording: () => void;
  quickReplyOpen: boolean;
  quickReplyMatches: QuickReply[];
  quickReplyIndex: number;
  quickReplies: QuickReply[];
  insertQuickReply: (reply: QuickReply) => void;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setPastedTextPending: Dispatch<SetStateAction<boolean>>;
  setQuickReplyDismissed: Dispatch<SetStateAction<boolean>>;
  setQuickReplyIndex: Dispatch<SetStateAction<number>>;
  sendMessage: (approvedPaste?: boolean) => Promise<void>;
  startRecording: () => Promise<void>;
};

export function MessageComposer({
  flowToggleRef, flowMenuOpen, setFlowMenuOpen, loadFlows, setEmojiOpen,
  emojiToggleRef, emojiOpen, fileInputRef, sendFiles, flowMenuRef, flows,
  busy, sendFlow, emojiMenuRef, setDraft, recording, recordingPaused,
  discardRecording, pauseOrResumeRecording, sendRecording, quickReplyOpen,
  quickReplyMatches, quickReplyIndex, quickReplies, insertQuickReply,
  composerInputRef, draft, setPastedTextPending, setQuickReplyDismissed,
  setQuickReplyIndex, sendMessage, startRecording,
}: Props) {
  return (
<footer className="wa-composer">
  <button
    ref={flowToggleRef}
    className={flowMenuOpen ? "active" : ""}
    onClick={() => {
      void loadFlows();
      setFlowMenuOpen((open) => !open);
      setEmojiOpen(false);
    }}
    aria-label="Enviar fluxo"
    title="Fluxos de conversa"
  >
    <GitBranch size={23} />
  </button>
  <button
    ref={emojiToggleRef}
    onClick={() => {
      setEmojiOpen(!emojiOpen);
      setFlowMenuOpen(false);
    }}
    aria-label="Emojis"
  >
    <Smile size={25} />
  </button>
  <button
    onClick={() => fileInputRef.current?.click()}
    aria-label="Anexar arquivo"
  >
    <Paperclip size={24} />
  </button>
  <input
    ref={fileInputRef}
    className="wa-file-input"
    type="file"
    multiple
    onChange={(event) => {
      const files = Array.from(event.target.files || []);
      if (files.length) void sendFiles(files);
      event.currentTarget.value = "";
    }}
  />
  {flowMenuOpen && (
    <div className="wa-flow-menu" ref={flowMenuRef}>
      <header>
        <GitBranch size={17} />
        <div>
          <b>Fluxos de conversa</b>
          <small>Escolha uma sequência para enviar</small>
        </div>
        <button type="button" onClick={() => setFlowMenuOpen(false)} aria-label="Fechar fluxos de conversa"><X size={16}/></button>
      </header>
      {flows.length ? (
        flows.map((flow) => (
          <button
            key={flow.id}
            disabled={busy}
            onClick={() => void sendFlow(flow)}
          >
            <b>{flow.name}</b>
            <span>
              {flow.description ||
                `${flow.steps.length} mensagem${flow.steps.length === 1 ? "" : "s"}`}
            </span>
            <em>{flow.steps.length}</em>
          </button>
        ))
      ) : (
        <p>Nenhum fluxo ativo. Crie um em Configurações.</p>
      )}
    </div>
  )}
  {emojiOpen && (
    <div className="wa-emojis" ref={emojiMenuRef}>
      {emojis.map((emoji) => (
        <button
          key={emoji}
          onClick={() => setDraft((value) => value + emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  )}
  {recording ? (
    <>
      <span className="wa-recording-label">
        {recordingPaused ? "Pausado" : "Gravando áudio"}
      </span>
      <button
        onClick={discardRecording}
        aria-label="Excluir gravação"
      >
        <Trash2 size={21} />
      </button>
      <button
        onClick={pauseOrResumeRecording}
        aria-label={
          recordingPaused ? "Retomar gravação" : "Pausar gravação"
        }
      >
        {recordingPaused ? (
          <Play size={21} />
        ) : (
          <Pause size={21} />
        )}
      </button>
      <button
        className="wa-send"
        onClick={sendRecording}
        aria-label="Enviar áudio"
      >
        <Send size={21} />
      </button>
    </>
  ) : (
    <>
      {quickReplyOpen && <div className="quick-reply-menu" id="quick-reply-options" role="listbox" aria-label="Mensagens rápidas">
        <small>Mensagens rápidas · ↑ ↓ para escolher · Enter para inserir</small>
        {quickReplyMatches.map((reply, index) => <button type="button" role="option" aria-selected={index === quickReplyIndex} id={`quick-reply-${reply.id}`} key={reply.id} className={index === quickReplyIndex ? "active" : ""} onMouseDown={event => event.preventDefault()} onClick={() => insertQuickReply(reply)}><b>/{reply.shortcut}</b><span>{reply.text}</span></button>)}
        {!quickReplyMatches.length && <p>{quickReplies.length ? "Nenhuma mensagem com esse atalho." : "Cadastre mensagens em Configurações → Mensagens rápidas."}</p>}
      </div>}
      <textarea
        ref={composerInputRef}
        rows={2}
        aria-label="Mensagem"
        aria-controls={quickReplyOpen ? "quick-reply-options" : undefined}
        aria-activedescendant={quickReplyOpen && quickReplyMatches[quickReplyIndex] ? `quick-reply-${quickReplyMatches[quickReplyIndex].id}` : undefined}
        value={draft}
        onChange={(event) => { setDraft(event.target.value); if (!event.target.value.trim()) setPastedTextPending(false); }}
        onPaste={(event) => { if (!event.clipboardData.files.length && event.clipboardData.getData("text/plain")) setPastedTextPending(true); }}
        onKeyDown={(event) => {
          if (quickReplyOpen && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setQuickReplyDismissed(true); return; }
          if (quickReplyOpen && quickReplyMatches.length && ["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key) && !event.shiftKey) {
            event.preventDefault();
            if (event.key === "ArrowDown" || event.key === "ArrowUp") setQuickReplyIndex(current => (current + (event.key === "ArrowDown" ? 1 : -1) + quickReplyMatches.length) % quickReplyMatches.length);
            else insertQuickReply(quickReplyMatches[Math.min(quickReplyIndex, quickReplyMatches.length - 1)]);
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void sendMessage();
          }
        }}
        placeholder="Digite uma mensagem ou cole um arquivo"
      />
      {draft.trim() ? (
        <button
          className="wa-send"
          aria-label="Enviar mensagem"
          onClick={() => void sendMessage()}
        >
          <Send size={21} />
        </button>
      ) : (
        <button
          aria-label="Gravar áudio"
          onClick={startRecording}
        >
          <Mic size={24} />
        </button>
      )}
    </>
  )}
</footer>

  );
}
