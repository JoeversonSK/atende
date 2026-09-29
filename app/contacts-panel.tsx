"use client";

import { useMemo, useState } from "react";
import { Search, UserRound, UserPlus, MessageCircle, FileUp, Pencil, Trash2, Merge } from "lucide-react";
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
  const [deleting, setDeleting] = useState("");
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState("");
  const tags = useMemo(() => [...new Set(contacts.flatMap(contact => contact.tags || []))].sort(), [contacts]);
  const shown = contacts.filter(contact =>
    !hiddenIds.includes(contact.id) &&
    (!tag || contact.tags?.includes(tag)) &&
    `${contact.name} ${contact.phone || ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );

  async function remove(contact: Contact) {
    if (!window.confirm(`Excluir ${contact.name} da lista de contatos do Atende? O histórico da conversa e a agenda do WhatsApp serão preservados.`)) return;
    setDeleting(contact.id); setDeleteError("");
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/operator-auth/contacts/${encodeURIComponent(sessionId)}/${encodeURIComponent(contact.id)}`, {
        method: "DELETE", headers: { "X-Atende-Token": token },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string | string[] };
        throw new Error(Array.isArray(body.message) ? body.message.join(" ") : body.message || "Não foi possível excluir o contato.");
      }
      setHiddenIds(current => [...current, contact.id]);
      await onImported().catch(() => undefined);
    } catch (error) { setDeleteError(error instanceof Error ? error.message : "Não foi possível excluir o contato."); }
    finally { setDeleting(""); }
  }

  async function reconcile() {
    if (!window.confirm("Unificar os cadastros importados com conversas antigas que tenham exatamente o mesmo nome completo? Casos com nomes repetidos ou mensagens nos dois cadastros serão ignorados.")) return;
    setReconciling(true); setReconcileMessage("");
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/operator-auth/contacts/${encodeURIComponent(sessionId)}/reconcile`, {
        method: "POST", headers: { "X-Atende-Token": token },
      });
      const body = await response.json() as { reconciled?: number; skipped?: number; message?: string | string[] };
      if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(" ") : body.message || "Não foi possível unificar os contatos.");
      await onImported();
      setReconcileMessage(`${body.reconciled || 0} contatos unificados.${body.skipped ? ` ${body.skipped} casos ambíguos precisam de revisão manual.` : ""}`);
    } catch (error) { setReconcileMessage(error instanceof Error ? error.message : "Não foi possível unificar os contatos."); }
    finally { setReconciling(false); }
  }

  return <section className="contacts-panel" aria-label="Contatos">
    <header>
      <div><h1>Contatos</h1><p>{contacts.length - hiddenIds.filter(id => contacts.some(contact => contact.id === id)).length} contatos na central</p>{deleteError && <p className="contact-delete-error" role="alert">{deleteError}</p>}{reconcileMessage && <p role="status">{reconcileMessage}</p>}</div>
      <div className="contact-header-actions">
        {canCreate && <button className="contact-reconcile-trigger" onClick={() => void reconcile()} disabled={reconciling} title="Associe importações às conversas antigas quando houver correspondência única de nome"><Merge size={18}/>{reconciling ? "Unificando…" : "Unificar duplicados"}</button>}
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
              {canCreate && <button className="contact-delete" aria-label={`Excluir contato ${contact.name}`} disabled={deleting === contact.id} onClick={() => void remove(contact)}><Trash2 size={16}/>{deleting === contact.id ? "Excluindo…" : "Excluir"}</button>}
            </span></td>
          </tr>)}</tbody>
        </table>{!shown.length && <p className="contacts-empty">Nenhum contato encontrado.</p>}</div>
      </div>
    </div>
    {importOpen && <ContactImport baseUrl={baseUrl} sessionId={sessionId} token={token} onComplete={onImported} onClose={() => setImportOpen(false)}/>}
    {editing && <ContactEditor contact={editing} baseUrl={baseUrl} apiKey={apiKey} token={token} sessionId={sessionId} onClose={() => setEditing(null)} onSaved={() => { void onImported().catch(() => undefined); }}/>}
  </section>;
}
