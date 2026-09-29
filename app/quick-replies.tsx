"use client";
import { useEffect, useState } from "react";
export type QuickReply = { id: string; shortcut: string; text: string };

export function QuickReplySettings({ baseUrl, token }: { baseUrl: string; token: string }) {
  const [items, setItems] = useState<QuickReply[]>([]);
  const [editing, setEditing] = useState<QuickReply>({ id: "", shortcut: "", text: "" });
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState("");
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/operator-auth`;
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${endpoint}/quick-replies`, { signal: abort.signal, headers: { "X-Atende-Token": token } })
      .then(async response => { if (!response.ok) throw new Error("Não foi possível carregar as mensagens rápidas."); return await response.json() as QuickReply[]; })
      .then(setItems).catch(error => { if (!abort.signal.aborted) setFeedback(error.message); });
    return () => abort.abort();
  }, [endpoint, token]);
  async function update(remove = false) {
    setBusy(true); setFeedback("");
    try {
      const response = await fetch(`${endpoint}/admin/quick-replies${editing.id ? `/${editing.id}` : ""}`, {
        method: remove ? "DELETE" : editing.id ? "PUT" : "POST",
        headers: { "X-Atende-Token": token, "Content-Type": "application/json" },
        ...(remove ? {} : { body: JSON.stringify({ shortcut: editing.shortcut, text: editing.text }) }),
      });
      const result = await response.json() as QuickReply & { message?: string | string[] };
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(" ") : result.message || "Não foi possível salvar.");
      setItems(current => [...current.filter(item => item.id !== editing.id), ...(remove ? [] : [result])].sort((a, b) => a.shortcut.localeCompare(b.shortcut)));
      setEditing({ id: "", shortcut: "", text: "" }); setFeedback(remove ? "Mensagem removida." : "Mensagem rápida salva para a equipe.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  return <><h2>Mensagens rápidas</h2><p>Cadastre atalhos para toda a equipe. Na conversa, digite / e escolha uma mensagem.</p>
    <section className="settings-card quick-reply-settings">
      <div className="quick-reply-list">{items.map(item => <button key={item.id} disabled={busy} onClick={() => setEditing(item)}><b>/{item.shortcut}</b><span>{item.text}</span></button>)}{!items.length && <p>Nenhuma mensagem rápida cadastrada.</p>}</div>
      <form onSubmit={event => { event.preventDefault(); void update(); }}>
        <h3>{editing.id ? "Editar mensagem" : "Nova mensagem"}</h3>
        <label>Nome do atalho<input required maxLength={60} pattern="[a-zA-Z0-9_-]+" placeholder="boasvindas" value={editing.shortcut} disabled={busy} onChange={event => setEditing({ ...editing, shortcut: event.target.value })}/><small>Use letras sem acento, números, hífen ou sublinhado. Exemplo: /boasvindas.</small></label>
        <label>Mensagem pronta<textarea required maxLength={10000} rows={6} value={editing.text} disabled={busy} onChange={event => setEditing({ ...editing, text: event.target.value })}/></label>
        <button className="solid-button" disabled={busy}>{busy ? "Salvando…" : "Salvar mensagem rápida"}</button>
        {editing.id && <><button type="button" className="back-link" disabled={busy} onClick={() => setEditing({ id: "", shortcut: "", text: "" })}>Nova mensagem</button><button type="button" className="back-link" disabled={busy} onClick={() => { if (window.confirm("Excluir esta mensagem rápida?")) void update(true); }}>Excluir mensagem</button></>}
      </form><p role="status">{feedback}</p>
    </section></>;
}
