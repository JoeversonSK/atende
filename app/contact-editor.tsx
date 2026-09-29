"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { ContactProfile } from "./contact-profile";

type Contact = { id: string; name: string; phone?: string };

export function ContactEditor({ contact, baseUrl, apiKey, token, sessionId, onClose, onSaved }: {
  contact: Contact;
  baseUrl: string;
  apiKey: string;
  token: string;
  sessionId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dirtyRef = useRef(false);

  function close() {
    if (dirtyRef.current && !window.confirm("Há alterações sendo salvas. Deseja fechar mesmo assim?")) return;
    onClose();
  }

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (dirtyRef.current && !window.confirm("Há alterações sendo salvas. Deseja fechar mesmo assim?")) return;
        onClose();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  return <div className="contact-editor-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="contact-editor-dialog" role="dialog" aria-modal="true" aria-label={`Editar contato ${contact.name}`}>
      <header><div><h2>Editar contato</h2><p>{contact.name === "." ? contact.phone || "Contato sem nome" : contact.name}</p></div><button type="button" aria-label="Fechar" onClick={close}><X size={20}/></button></header>
      <div className="contact-editor-body">
        <ContactProfile
          baseUrl={baseUrl}
          apiKey={apiKey}
          token={token}
          sessionId={sessionId}
          chatId={contact.id}
          contactName={contact.name}
          contactPhone={contact.phone}
          canEdit
          dirtyRef={dirtyRef}
          onSaved={() => onSaved()}
        />
      </div>
    </section>
  </div>;
}
