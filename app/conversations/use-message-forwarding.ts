"use client";

import { useMemo, useState } from "react";
import type { ApiConfig } from "../atende-api";
import type { Chat, Message } from "../conversation-model";
import { findForwardCandidates, type ContactRow } from "./contact-list";
import { forwardMessageToContacts } from "./conversation-forwarding";

type Options = {
  config: ApiConfig;
  selected: Chat | null;
  canSend: boolean;
  contacts: ContactRow[];
  refreshChats: (active?: ApiConfig) => Promise<void>;
  setNotice: (message: string) => void;
};

export function useMessageForwarding({ config, selected, canSend, contacts, refreshChats, setNotice }: Options) {
  const [target, setTarget] = useState<{ message: Message; chatId: string } | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const candidates = useMemo(
    () => findForwardCandidates(contacts, target?.chatId, search),
    [contacts, target?.chatId, search],
  );

  function open(message: Message) {
    if (!selected || !message.waMessageId) return;
    if (!canSend) {
      setNotice("Sua conta não tem permissão para encaminhar mensagens.");
      return;
    }
    setTarget({ message, chatId: selected.id });
    setSearch("");
    setSelectedIds([]);
    setError("");
  }

  function toggleRecipient(chatId: string) {
    if (!selectedIds.includes(chatId) && selectedIds.length >= 10) {
      setError("Selecione no máximo 10 contatos por envio.");
      return;
    }
    setSelectedIds(current => current.includes(chatId) ? current.filter(id => id !== chatId) : [...current, chatId]);
    setError("");
  }

  async function send() {
    const messageId = target?.message.waMessageId;
    if (!target || !messageId || !selectedIds.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const { delivered, failed } = await forwardMessageToContacts(
        config, target.chatId, messageId, [...selectedIds],
        toChatId => contacts.find(contact => contact.id === toChatId)?.name || toChatId,
      );
      if (delivered) void refreshChats().catch(() => undefined);
      if (failed.length) {
        setSelectedIds(failed.map(item => item.id));
        setError(`${delivered} enviado(s). Falha para: ${failed.map(item => `${item.name} (${item.reason})`).join("; ")}. Apenas os contatos com falha continuam selecionados.`);
      } else {
        setTarget(null);
        setNotice(`Mensagem encaminhada para ${delivered} contato${delivered === 1 ? "" : "s"}.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível encaminhar a mensagem.");
    } finally {
      setBusy(false);
    }
  }

  return { target, setTarget, search, setSearch, selectedIds, busy, error, candidates, open, toggleRecipient, send };
}
