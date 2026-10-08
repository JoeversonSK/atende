"use client";

import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { ApiConfig } from "../atende-api";
import type { SupportOverview } from "../dashboard-model";
import { prepareNewContact, saveNewContact } from "./contact-creation";

type Options = {
  config: ApiConfig;
  refreshGenerationRef: RefObject<number>;
  setOverview: Dispatch<SetStateAction<SupportOverview>>;
  setNewChatOpen: Dispatch<SetStateAction<boolean>>;
  setContactsOpen: Dispatch<SetStateAction<boolean>>;
  setDashboardOpen: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useContactCreation({ config, refreshGenerationRef, setOverview, setNewChatOpen, setContactsOpen, setDashboardOpen, setNotice }: Options) {
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [countryCode, setCountryCode] = useState("55");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  async function start() {
    if (saving) return;
    setError("");
    let contact;
    try {
      contact = prepareNewContact(firstName, lastName, countryCode, phone);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Informe os dados do contato.");
      return;
    }
    if (!config.sessionId) {
      setError("Configure a conexão WhatsApp antes de cadastrar contatos.");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveNewContact(config, contact);
      refreshGenerationRef.current++;
      setOverview(current => ({
        ...current,
        contacts: [
          ...current.contacts.filter(item => item.chatId !== contact.id),
          { chatId: contact.id, data: saved },
        ],
      }));
      setPhone("");
      setFirstName("");
      setLastName("");
      setCountryCode("55");
      setError("");
      setNewChatOpen(false);
      setContactsOpen(true);
      setDashboardOpen(false);
      setNotice("Contato salvo para toda a equipe.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o contato.");
    } finally {
      setSaving(false);
    }
  }

  return { saving, firstName, setFirstName, lastName, setLastName, countryCode, setCountryCode, phone, setPhone, error, start };
}
