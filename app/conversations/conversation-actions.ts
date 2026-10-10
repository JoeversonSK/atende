import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ApiConfig } from "../atende-api";
import { eventId, isGroupChat, type Chat, type Message, type MessageWithTimestamp } from "../conversation-model";
import type { SupportOverview } from "../dashboard-model";
import type { ConversationFlow } from "../flow-settings";
import type { OperatorIdentity } from "../operator-activity";
import type { PendingPaste } from "./components/conversation-dialogs";
import { appendOptimisticText, confirmOptimisticText, discardOptimisticText } from "./conversation-history";
import { executeConversationFlow } from "./flow-execution";
import { createFlowTemplate } from "./flow-variables";
import { deliverMedia, deliverText, signOutgoingText } from "./message-delivery";
import type { Assignment } from "./ticket-actions";

type Setter<T> = Dispatch<SetStateAction<T>>;

type Options = {
  config: ApiConfig;
  operator: OperatorIdentity | null;
  operatorToken: string;
  selected: Chat | null;
  draft: string;
  pastedTextPending: boolean;
  pendingPaste: PendingPaste | null;
  replyingTo: Message | null;
  overview: SupportOverview;
  busy: boolean;
  historyCacheRef: RefObject<Map<string, MessageWithTimestamp[]>>;
  selectedRef: RefObject<Chat | null>;
  refreshGenerationRef: RefObject<number>;
  profileDirtyRef: RefObject<boolean>;
  setMessages: Setter<Message[]>;
  updateDraft: Setter<string>;
  setPastedTextPending: Setter<boolean>;
  setPendingPaste: Setter<PendingPaste | null>;
  setReplyingTo: Setter<Message | null>;
  setEmojiOpen: Setter<boolean>;
  setNotice: Setter<string>;
  setOperatorOpen: Setter<boolean>;
  setBusy: Setter<boolean>;
  setFlowMenuOpen: Setter<boolean>;
  setAssignments: Setter<Record<string, Assignment>>;
  setOverview: Setter<SupportOverview>;
  setAssignment: Setter<Assignment | null>;
  setProfileReload: Setter<number>;
  refreshMessages: (chat: Chat, active?: ApiConfig, loadLiveHistory?: boolean) => Promise<void>;
  refreshChats: (active?: ApiConfig) => Promise<void>;
};

export function useConversationActions({
  config, operator, operatorToken, selected, draft, pastedTextPending, pendingPaste, replyingTo,
  overview, busy, historyCacheRef, selectedRef, refreshGenerationRef, profileDirtyRef,
  setMessages, updateDraft, setPastedTextPending, setPendingPaste, setReplyingTo, setEmojiOpen,
  setNotice, setOperatorOpen, setBusy, setFlowMenuOpen, setAssignments, setOverview,
  setAssignment, setProfileReload, refreshMessages, refreshChats,
}: Options) {
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
    const signedText = signOutgoingText(operator.displayName, originalText);
    const optimisticId = `optimistic-${eventId()}`;
    const optimisticTimestamp = Date.now();
    const pendingList = appendOptimisticText(
      historyCacheRef.current.get(target.id) || [], signedText, optimisticId, optimisticTimestamp,
      replyTarget ? { id: replyTarget, body: replyingTo?.body || "" } : undefined,
    );
    historyCacheRef.current.set(target.id, pendingList);
    if (selectedRef.current?.id === target.id) setMessages(pendingList);
    updateDraft("");
    setPastedTextPending(false);
    setReplyingTo(null);
    setEmojiOpen(false);
    try {
      const result = await deliverText(config, target.id, signedText, replyTarget);
      const confirmedList = confirmOptimisticText(
        historyCacheRef.current.get(target.id) || [], optimisticId, result, optimisticTimestamp,
      );
      historyCacheRef.current.set(target.id, confirmedList);
      if (selectedRef.current?.id === target.id) setMessages(confirmedList);
      // A mensagem enviada ao grupo já está confirmada na tela. O evento do
      // WhatsApp sincroniza o histórico; evitar uma segunda leitura aqui impede
      // que a conversa extensa pareça recarregar logo após o envio.
      if (!isGroupChat(target)) void refreshMessages(target).catch(() => undefined);
      void refreshChats().catch(() => undefined);
    } catch (error) {
      const withoutFailed = discardOptimisticText(historyCacheRef.current.get(target.id) || [], optimisticId);
      historyCacheRef.current.set(target.id, withoutFailed);
      if (selectedRef.current?.id === target.id) {
        setMessages(withoutFailed);
        updateDraft(current => current || originalText);
        if (replyTarget) setReplyingTo(current => current || replyingTo);
      }
      setNotice(error instanceof Error ? error.message : "Não foi possível enviar a mensagem.");
    }
  }

  async function sendFlow(flow: ConversationFlow, selectedCnpjs?: string[]) {
    if (!selected || busy) return;
    if (isGroupChat(selected)) {
      setNotice("Fluxos de atendimento não estão disponíveis para grupos.");
      return;
    }
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
    const updateClosedProfile = (data: SupportOverview["contacts"][number]["data"], evaluation: boolean) => {
      if (!evaluation) refreshGenerationRef.current++;
      setAssignments(current => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      setOverview(current => ({
        ...current,
        contacts: [...current.contacts.filter(contact => contact.chatId !== target.id), { chatId: target.id, data }],
      }));
      if (selectedRef.current?.id === target.id) {
        setAssignment(null);
        profileDirtyRef.current = false;
        setProfileReload(value => value + 1);
      }
    };
    setBusy(true);
    setFlowMenuOpen(false);
    setNotice("Enviando o fluxo “" + flow.name + "”…");
    try {
      const result = await executeConversationFlow({
        config, flow, chatId: target.id, operatorName: operator.displayName, fill, selectedCnpjs,
        onAssigned: started => {
          setAssignments(current => ({ ...current, [target.id]: started.assignment }));
          setOverview(current => ({
            ...current,
            contacts: [...current.contacts.filter(contact => contact.chatId !== target.id), { chatId: target.id, data: started.data }],
          }));
          if (selectedRef.current?.id === target.id) {
            setAssignment(started.assignment);
            profileDirtyRef.current = false;
            setProfileReload(value => value + 1);
          }
        },
        onClosed: updateClosedProfile,
      });
      if (result.evaluation) {
        setNotice("Enquetes de avaliação enviadas e atendimento encerrado.");
        await refreshMessages(target, config, true);
        await refreshChats();
        return;
      }
      setNotice(result.waitingForAnswer ? "Opções enviadas. Aguardando a resposta do cliente."
        : result.closedByFlow ? "Fluxo “" + flow.name + "” enviado e atendimento encerrado."
        : result.assignedByFlow ? "Fluxo enviado e atendimento atribuído a " + operator.displayName + "."
        : "Fluxo “" + flow.name + "” enviado.");
      await refreshMessages(target, config, true);
      await refreshChats();
    } catch (error) {
      setNotice(error instanceof Error ? "O fluxo foi interrompido: " + error.message : "Não foi possível enviar o fluxo.");
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
      setNotice(error instanceof Error ? error.message : "Não foi possível enviar o arquivo.");
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
    const accepted = files.filter(file => file.size > 0).slice(0, 10);
    if (!accepted.length) {
      setNotice("Nenhum arquivo válido foi encontrado.");
      return;
    }
    let sent = 0;
    for (const file of accepted) if (await sendMedia(file, false, target)) sent++;
    if (sent) setNotice(`${sent} ${sent === 1 ? "arquivo enviado" : "arquivos enviados"} com sucesso.`);
  }

  async function confirmPendingPaste() {
    if (!pendingPaste) return;
    if (!selected || selected.id !== pendingPaste.chatId) {
      setPendingPaste(null);
      setNotice("A conversa mudou. Cole novamente antes de enviar.");
      return;
    }
    if (pendingPaste.kind === "text") {
      if (draft.trim() !== pendingPaste.text) {
        setPendingPaste({ ...pendingPaste, text: draft.trim() });
        return;
      }
      setPendingPaste(null);
      await sendMessage(true);
      return;
    }
    setPendingPaste(null);
    await sendFiles(pendingPaste.files, selected);
  }

  return { sendMessage, sendFlow, sendMedia, sendFiles, confirmPendingPaste };
}
