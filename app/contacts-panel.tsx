"use client";

import { useMemo, useState } from "react";
import { Search, UserRound, UserPlus, MessageCircle, FileUp, Pencil } from "lucide-react";
import { ContactImport } from "./contact-import";
import { ContactEditor } from "./contact-editor";

type Contact = { id: string; name: string; phone?: string; avatar?: string; tags?: string[] };

export function ContactsPanel({ contacts, onCreate, onOpen, canCreate, baseUrl, apiKey, sessionId, token, onImported }: {
  contacts: Contact[];
  onCreate: () => void;
  onOpen: (contact: Contact) => void;
  canCreate: boolean;
  baseUrl: string;
  apiKey: string;
  sessionId: string;
  token: string;
  onImported: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const tags = useMemo(() => [...new Set(contacts.flatMap(contact => contact.tags || []))].sort(), [contacts]);
  const shown = contacts.filter(contact =>
    (!tag || contact.tags?.includes(tag)) &&
    `${contact.name} ${contact.phone || ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );

  return <section className="contacts-panel" aria-label="Contatos">
    <header>
      <div><h1>Contatos</h1><p>{contacts.length} contatos na central</p></div>
      <div className="contact-header-actions">
        <button className="contact-import-trigger" onClick={() => setImportOpen(true)} disabled={!canCreate}><FileUp size={18}/>Importar planilha</button>
        <button className="solid-button" onClick={onCreate} disabled={!canCreate}><UserPlus size={18}/>Criar contato</button>
      </div>
    </header>
    <div className="contacts-layout">
      <aside>
        <h2>Etiquetas</h2>
        <button className={!tag ? "active" : ""} onClick={() => setTag("")}>Todos os contatos</button>
        {tags.map(value => <button key={value} className={tag === value ? "active" : ""} onClick={() => setTag(value)}>{value}</button>)}
        {!tags.length && <p>Nenhuma etiqueta cadastrada.</p>}
      </aside>
      <div className="contacts-main">
        <label className="contacts-search"><Search size={18}/><input aria-label="Buscar contatos" placeholder="Buscar nome ou WhatsApp" value={search} onChange={event => setSearch(event.target.value)}/></label>
        <div className="contacts-table-wrap"><table>
          <thead><tr><th>Contato</th><th>WhatsApp</th><th>Etiquetas</th><th>Ações</th></tr></thead>
          <tbody>{shown.map(contact => <tr key={contact.id}>
            <td><span className="contact-cell"><span className="contact-avatar">{contact.avatar ? <img src={contact.avatar} alt="" referrerPolicy="no-referrer"/> : <UserRound size={20}/>}</span><strong>{contact.name}</strong></span></td>
            <td>{contact.phone ? `+${contact.phone.replace(/\D/g, "")}` : "Não informado"}</td>
            <td>{contact.tags?.map(value => <span className="contact-tag" key={value}>{value}</span>)}</td>
            <td><span className="contact-row-actions">
              {canCreate && <button className="contact-edit" aria-label={`Editar contato ${contact.name}`} onClick={() => setEditing(contact)}><Pencil size={16}/>Editar</button>}
              <button className="contact-open" aria-label={`Abrir conversa com ${contact.name}`} onClick={() => onOpen(contact)}><MessageCircle size={17}/>Abrir</button>
            </span></td>
          </tr>)}</tbody>
        </table>{!shown.length && <p className="contacts-empty">Nenhum contato encontrado.</p>}</div>
      </div>
    </div>
    {importOpen && <ContactImport baseUrl={baseUrl} sessionId={sessionId} token={token} onComplete={onImported} onClose={() => setImportOpen(false)}/>}
    {editing && <ContactEditor contact={editing} baseUrl={baseUrl} apiKey={apiKey} token={token} sessionId={sessionId} onClose={() => setEditing(null)} onSaved={() => { void onImported().catch(() => undefined); }}/>}
  </section>;
}
