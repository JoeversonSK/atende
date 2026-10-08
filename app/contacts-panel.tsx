"use client";

import { useMemo, useState } from "react";
import { Search, UserRound, UserPlus, MessageCircle, FileUp, Pencil, Trash2, Merge } from "lucide-react";
import { ContactImport } from "./contact-import";
import { ContactCnpjImport } from "./contact-cnpj-import";
import { ContactEditor } from "./contact-editor";

type Contact = { id: string; name: string; phone?: string; avatar?: string; tags?: string[] };
const CONTACTS_PER_PAGE = 100;
const normalizeContactSearch = (value: string) => value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

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
  const [page, setPage] = useState(1);
  const [missingOnly, setMissingOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"all" | "any">("all");
  const [tagSearch, setTagSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [cnpjImportOpen, setCnpjImportOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState("");
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState("");
  const [reconcileCases, setReconcileCases] = useState<{ name: string; phone: string; reason: string }[]>([]);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const contact of contacts) for (const value of new Set(contact.tags || [])) counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }, [contacts]);
  const tags = useMemo(() => [...tagCounts.keys()].sort((a, b) => a.localeCompare(b, "pt-BR")), [tagCounts]);
  const visibleTags = tags.filter(value => value.toLocaleLowerCase("pt-BR").includes(tagSearch.toLocaleLowerCase("pt-BR")));
  const indexedContacts = useMemo(() => contacts.map(contact => ({ contact, searchText: normalizeContactSearch(`${contact.name} ${contact.phone || "Não informado"}`) })), [contacts]);
  const query = normalizeContactSearch(search.trim());
  const missingCount = useMemo(() => contacts.filter(contact => !contact.phone).length, [contacts]);
  const shown = useMemo(() => {
    const hidden = new Set(hiddenIds);
    return indexedContacts.filter(({ contact, searchText }) =>
      !hidden.has(contact.id) &&
      (!missingOnly || !contact.phone) &&
      (selectedTags.length === 0 || (tagMode === "all"
        ? selectedTags.every(value => contact.tags?.includes(value))
        : selectedTags.some(value => contact.tags?.includes(value)))) &&
      searchText.includes(query),
    ).map(({ contact }) => contact);
  }, [indexedContacts, hiddenIds, missingOnly, selectedTags, tagMode, query]);
  const pageCount = Math.max(1, Math.ceil(shown.length / CONTACTS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageContacts = shown.slice((currentPage - 1) * CONTACTS_PER_PAGE, currentPage * CONTACTS_PER_PAGE);

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
    if (!window.confirm("Unificar os cadastros importados com conversas antigas que tenham exatamente o mesmo nome e uma correspondência única? Casos ambíguos ou com mensagens nos dois cadastros serão listados para revisão.")) return;
    setReconciling(true); setReconcileMessage(""); setReconcileCases([]);
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/operator-auth/contacts/${encodeURIComponent(sessionId)}/reconcile`, {
        method: "POST", headers: { "X-Atende-Token": token },
      });
      const body = await response.json() as { reconciled?: number; skipped?: number; phonesResolved?: number; phonesStillUnknown?: number; cases?: { name: string; phone: string; reason: string }[]; message?: string | string[] };
      if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(" ") : body.message || "Não foi possível unificar os contatos.");
      await onImported();
      setReconcileCases(Array.isArray(body.cases) ? body.cases : []);
      setReconcileMessage(`${body.phonesResolved || 0} telefones identificados no WhatsApp; ${body.reconciled || 0} contatos unificados.${body.skipped ? ` ${body.skipped} casos pendentes listados abaixo.` : ""}${body.phonesStillUnknown ? ` ${body.phonesStillUnknown} conversas ainda sem número confirmado.` : ""}`);
    } catch (error) { setReconcileMessage(error instanceof Error ? error.message : "Não foi possível unificar os contatos."); }
    finally { setReconciling(false); }
  }

  return <section className="contacts-panel" aria-label="Contatos">
    <header>
      {(deleteError || reconcileMessage) && <div>{deleteError && <p className="contact-delete-error" role="alert">{deleteError}</p>}{reconcileMessage && <p role="status">{reconcileMessage}</p>}</div>}
      <div className="contact-header-actions">
        {canCreate && <button className="contact-reconcile-trigger" onClick={() => void reconcile()} disabled={reconciling} title="Associe importações às conversas antigas quando houver correspondência única de nome"><Merge size={18}/>{reconciling ? "Unificando…" : "Unificar duplicados"}</button>}
        <button className="contact-import-trigger" onClick={() => setImportOpen(true)} disabled={!canCreate}><FileUp size={18}/>Importar planilha</button>
        <button className="contact-import-trigger" onClick={() => setCnpjImportOpen(true)} disabled={!canCreate}><FileUp size={18}/>Atualizar CNPJs</button>
        <button className="solid-button" onClick={onCreate} disabled={!canCreate}><UserPlus size={18}/>Criar contato</button>
      </div>
    </header>
    {reconcileCases.length > 0 && <details className="contact-reconcile-cases" open><summary>Contatos que precisam de revisão ({reconcileCases.length})</summary><ul>{reconcileCases.map((item, index) => <li key={`${item.phone}-${index}`}><strong>{item.name || "Contato sem nome"}</strong><span>{item.phone ? `+${item.phone.replace(/\D/g, "")}` : "Telefone não informado"}</span><small>{item.reason}</small></li>)}</ul></details>}
    <div className="contacts-layout">
      <aside>
        <h2>Etiquetas <span>{tags.length}</span></h2>
        <label className="contact-tag-search"><Search size={16}/><input aria-label="Buscar etiqueta" placeholder="Buscar etiqueta" value={tagSearch} onChange={event => setTagSearch(event.target.value)}/></label>
        <button type="button" className={!selectedTags.length ? "active" : ""} onClick={() => { setSelectedTags([]); setPage(1); }}>Todos os contatos <span>{contacts.length}</span></button>
        {selectedTags.length > 1 && <div className="contact-tag-mode" role="group" aria-label="Como combinar etiquetas">
          <span>Mostrar contatos com:</span>
          <div>
            <button type="button" className={tagMode === "all" ? "active" : ""} aria-pressed={tagMode === "all"} onClick={() => { setTagMode("all"); setPage(1); }}>Todas (E)</button>
            <button type="button" className={tagMode === "any" ? "active" : ""} aria-pressed={tagMode === "any"} onClick={() => { setTagMode("any"); setPage(1); }}>Qualquer uma (OU)</button>
          </div>
        </div>}
        {selectedTags.length > 0 && <p className="contact-tag-selection">{selectedTags.length === 1 ? "Etiqueta" : "Etiquetas"}: {selectedTags.join(", ")}</p>}
        <div className="contact-tag-options">{visibleTags.map(value => <button type="button" key={value} className={selectedTags.includes(value) ? "active" : ""} aria-pressed={selectedTags.includes(value)} onClick={() => { setSelectedTags(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]); setPage(1); }}><span>{selectedTags.includes(value) ? "✓ " : ""}{value}</span><span>{tagCounts.get(value)}</span></button>)}</div>
        {tags.length > 0 && !visibleTags.length && <p>Nenhuma etiqueta corresponde à busca.</p>}
        {!tags.length && <p>Nenhuma etiqueta cadastrada.</p>}
      </aside>
      <div className="contacts-main">
        <div className="contacts-search-row"><label className="contacts-search"><Search size={18}/><input aria-label="Buscar contatos" placeholder="Buscar contato, telefone ou Não informado" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }}/></label><button className={`contact-missing-filter${missingOnly ? " active" : ""}`} onClick={() => { setMissingOnly(current => !current); setPage(1); }}>Sem telefone <span>{missingCount}</span></button></div>
        <div className="contacts-table-wrap"><table>
          <thead><tr><th>Contato</th><th>WhatsApp</th><th>Etiquetas</th><th>Ações</th></tr></thead>
          <tbody>{pageContacts.map(contact => <tr key={contact.id}>
            <td><span className="contact-cell"><span className="contact-avatar">{contact.avatar ? <img src={contact.avatar} alt="" referrerPolicy="no-referrer"/> : <UserRound size={20}/>}</span><strong>{contact.name}</strong></span></td>
            <td>{contact.phone ? `+${contact.phone.replace(/\D/g, "")}` : "Não informado"}</td>
            <td><div className="contact-tag-list">{contact.tags?.length ? [...new Set(contact.tags)].sort((a, b) => a.localeCompare(b, "pt-BR")).map(value => <span className="contact-tag" key={value}>{value}</span>) : <span className="contact-no-tags">Sem etiquetas</span>}</div></td>
            <td><span className="contact-row-actions">
              {canCreate && <button className="contact-edit" aria-label={`Editar contato ${contact.name}`} onClick={() => setEditing(contact)}><Pencil size={16}/>Editar</button>}
              <button className="contact-open" aria-label={`Abrir conversa com ${contact.name}`} onClick={() => onOpen(contact)}><MessageCircle size={17}/>Abrir</button>
              {canCreate && <button className="contact-delete" aria-label={`Excluir contato ${contact.name}`} disabled={deleting === contact.id} onClick={() => void remove(contact)}><Trash2 size={16}/>{deleting === contact.id ? "Excluindo…" : "Excluir"}</button>}
            </span></td>
          </tr>)}</tbody>
        </table>{!shown.length && <p className="contacts-empty">Nenhum contato encontrado.</p>}</div>
        {shown.length > 0 && <nav className="contacts-pagination" aria-label="Páginas de contatos">
          <span>Exibindo {(currentPage - 1) * CONTACTS_PER_PAGE + 1}–{Math.min(currentPage * CONTACTS_PER_PAGE, shown.length)} de {shown.length} contatos</span>
          {pageCount > 1 && <div>
            <button type="button" disabled={currentPage === 1} onClick={() => setPage(1)}>Primeira</button>
            <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button>
            <span>Página {currentPage} de {pageCount}</span>
            <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Próxima</button>
            <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(pageCount)}>Última</button>
          </div>}
        </nav>}
      </div>
    </div>
    {importOpen && <ContactImport baseUrl={baseUrl} sessionId={sessionId} token={token} onComplete={onImported} onClose={() => setImportOpen(false)}/>}
    {cnpjImportOpen && <ContactCnpjImport baseUrl={baseUrl} sessionId={sessionId} token={token} onComplete={onImported} onClose={() => setCnpjImportOpen(false)}/>}
    {editing && <ContactEditor contact={editing} baseUrl={baseUrl} apiKey={apiKey} token={token} sessionId={sessionId} onClose={() => setEditing(null)} onSaved={() => { void onImported().catch(() => undefined); }}/>}
  </section>;
}
