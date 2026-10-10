"use client";

import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { ApiConfig } from "../atende-api";
import { isGroupChat, type Chat } from "../conversation-model";
import type { SupportOverview } from "../dashboard-model";
import type { OperatorIdentity } from "../operator-activity";
import { assignConversation, closeTicket, readAssignment, removeAssignment, type Assignment } from "./ticket-actions";

type Setter<T> = Dispatch<SetStateAction<T>>;
type Options = {
  config: ApiConfig;
  selected: Chat | null;
  operator: OperatorIdentity | null;
  selectedRef: RefObject<Chat | null>;
  profileDirtyRef: RefObject<boolean>;
  refreshGenerationRef: RefObject<number>;
  setAssignment: Setter<Assignment | null>;
  setAssignments: Setter<Record<string, Assignment>>;
  setOverview: Setter<SupportOverview>;
  setProfileReload: Setter<number>;
  setNotice: Setter<string>;
  setOperatorOpen: Setter<boolean>;
  refreshChats: (active?: ApiConfig) => Promise<void>;
};

export function useTicketActions({ config, selected, operator, selectedRef, profileDirtyRef,
  refreshGenerationRef, setAssignment, setAssignments, setOverview, setProfileReload,
  setNotice, setOperatorOpen, refreshChats }: Options) {
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [closingTickets, setClosingTickets] = useState<Set<string>>(() => new Set());

  async function loadAssignment(chat: Chat, active = config) {
    if (isGroupChat(chat) || !active.apiKey || !active.sessionId) return;
    try {
      const assignment = await readAssignment(active, chat.id);
      if (assignment !== undefined && selectedRef.current?.id === chat.id) setAssignment(assignment);
    } catch {
      // A conversa continua disponível se a leitura da atribuição falhar.
    }
  }

  async function saveAssignment(targetId?: string) {
    if (!selected || !operator) { setOperatorOpen(true); return; }
    if (isGroupChat(selected)) return;
    setSavingAssignment(true);
    try {
      const owner = await assignConversation(config, selected.id, operator.displayName, targetId || operator.id);
      setAssignment(owner);
      setAssignments(current => ({ ...current, [selected.id]: owner }));
      setNotice("Conversa atribuída com sucesso.");
      if (owner.reopened && owner.profileData) {
        setOverview(current => ({
          ...current,
          contacts: [...current.contacts.filter(contact => contact.chatId !== selected.id),
            { chatId: selected.id, data: owner.profileData! }],
        }));
        profileDirtyRef.current = false;
        setProfileReload(value => value + 1);
        setNotice("Atendimento reaberto e encaminhado com sucesso.");
      }
      void refreshChats().catch(() => undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível atribuir a conversa.");
    } finally {
      setSavingAssignment(false);
    }
  }

  async function clearAssignment() {
    if (!selected || isGroupChat(selected)) return;
    setSavingAssignment(true);
    try {
      await removeAssignment(config, selected.id);
      setAssignment(null);
      setNotice("Conversa removida da fila do atendente.");
      setAssignments(current => {
        const next = { ...current };
        delete next[selected.id];
        return next;
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível remover a atribuição.");
    } finally {
      setSavingAssignment(false);
    }
  }

  async function finishTicket() {
    if (!selected || isGroupChat(selected) || closingTickets.has(selected.id)) return;
    if (profileDirtyRef.current && !window.confirm("Há alterações não salvas no perfil. Deseja descartá-las e encerrar o atendimento?")) return;
    const chatId = selected.id;
    setClosingTickets(current => new Set(current).add(chatId));
    try {
      const profileData = await closeTicket(config, chatId);
      refreshGenerationRef.current++;
      setAssignments(current => {
        const next = { ...current };
        delete next[chatId];
        return next;
      });
      setOverview(current => ({
        ...current,
        contacts: [...current.contacts.filter(contact => contact.chatId !== chatId), { chatId, data: profileData }],
      }));
      if (selectedRef.current?.id === chatId) {
        setAssignment(null);
        profileDirtyRef.current = false;
        setProfileReload(value => value + 1);
      }
      setNotice("Atendimento encerrado. A atribuição foi removida e o painel será atualizado.");
      void refreshChats().catch(() => setNotice("Atendimento encerrado. O painel será atualizado na próxima sincronização."));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível encerrar o atendimento.");
    } finally {
      setClosingTickets(current => {
        const next = new Set(current);
        next.delete(chatId);
        return next;
      });
    }
  }

  return { savingAssignment, closingTickets, loadAssignment, saveAssignment, clearAssignment, finishTicket };
}
