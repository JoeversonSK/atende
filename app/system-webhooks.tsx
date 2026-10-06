"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FlaskConical, Plus, Save, Trash2, X } from "lucide-react";
import { operatorRequest } from "./atende-api";

type Hook = { id: string; url: string; events: string[]; active: boolean; retryCount: number; filters?: unknown; lastTriggeredAt?: string | null };
type Draft = { id?: string; url: string; events: string[]; active: boolean; retryCount: number; secret: string; headersJson: string; filtersJson: string };
const labels: Record<string, string> = {
  "message.received": "Mensagem recebida", "message.sent": "Mensagem enviada", "message.ack": "Confirmação de mensagem", "message.failed": "Falha de mensagem", "message.revoked": "Mensagem apagada", "message.reaction": "Reação", "message.edited": "Mensagem editada",
  "status.received": "Status recebido", "session.status": "Estado da conexão", "session.qr": "QR Code", "session.authenticated": "Sessão autenticada", "session.disconnected": "Sessão desconectada", "session.reconnect_loop": "Reconexão", "session.restriction": "Restrição da sessão", "presence.update": "Presença",
  "group.join": "Entrada no grupo", "group.leave": "Saída do grupo", "group.update": "Alteração no grupo", "group.join_request": "Pedido para entrar", "call.received": "Chamada recebida", "call.accepted": "Chamada aceita", "call.rejected": "Chamada recusada", "call.missed": "Chamada perdida",
  "contact.created": "Contato criado", "contact.updated": "Contato atualizado", "conversation.assigned": "Atendimento atribuído", "conversation.closed": "Atendimento concluído", "team.message.sent": "Mensagem na equipe", "operator.activity.changed": "Atividade do usuário", "automation.completed": "Automação executada",
};
const internalEvents = new Set(["contact.created", "contact.updated", "conversation.assigned", "conversation.closed", "team.message.sent", "operator.activity.changed", "automation.completed"]);
const empty = (): Draft => ({ url: "", events: ["message.received"], active: true, retryCount: 3, secret: "", headersJson: "", filtersJson: "" });
const messageOf = (value: unknown) => { const data = value as { message?: string | string[]; error?: string } | null; return Array.isArray(data?.message) ? data.message.join(" ") : data?.message || data?.error || "Não foi possível concluir a operação."; };

export function SystemWebhookSettings({ baseUrl, token }: { baseUrl: string; token: string }) {
  const path = "/admin/system-webhooks";
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const load = useCallback(async () => {
    try {
      const [listResponse, catalogResponse] = await Promise.all([
        operatorRequest(baseUrl, token, path),
        operatorRequest(baseUrl, token, `${path}/catalog`),
      ]);
      const [list, catalog] = await Promise.all([listResponse.json(), catalogResponse.json()]);
      if (!listResponse.ok) throw new Error(messageOf(list));
      if (!catalogResponse.ok) throw new Error(messageOf(catalog));
      setHooks(Array.isArray(list) ? list : []);
      setEvents(Array.isArray(catalog.events) ? catalog.events : []);
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível carregar os webhooks."); }
  }, [baseUrl, token]);
  useEffect(() => { void load(); }, [load]);
  const change = (patch: Partial<Draft>) => setDraft(current => current ? { ...current, ...patch } : null);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true); setFeedback("");
    try {
      const payload: Record<string, unknown> = { url: draft.url, events: draft.events, active: draft.active, retryCount: draft.retryCount };
      if (draft.secret) payload.secret = draft.secret;
      if (draft.headersJson.trim()) payload.headers = JSON.parse(draft.headersJson);
      if (draft.filtersJson.trim()) payload.filters = JSON.parse(draft.filtersJson);
      else if (draft.id) payload.filters = null;
      const response = await operatorRequest(baseUrl, token, draft.id ? `${path}/${draft.id}` : path, { method: draft.id ? "PUT" : "POST", body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(messageOf(data));
      setDraft(null); setFeedback("Webhook salvo."); await load();
    } catch (error) { setFeedback(error instanceof SyntaxError ? "Confira o JSON dos cabeçalhos ou filtros." : error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  async function action(hook: Hook, kind: "test" | "delete" | "toggle") {
    if (kind === "delete" && !confirm("Excluir este webhook?")) return;
    setBusy(true); setFeedback("");
    try {
      const response = await operatorRequest(baseUrl, token, `${path}/${hook.id}${kind === "test" ? "/test" : ""}`, {
        method: kind === "test" ? "POST" : kind === "delete" ? "DELETE" : "PUT",
        ...(kind === "toggle" ? { body: JSON.stringify({ active: !hook.active }) } : {}),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(messageOf(data));
      setFeedback(kind === "test" ? "Teste entregue ao destino." : kind === "delete" ? "Webhook excluído." : "Estado atualizado.");
      if (kind !== "test") await load();
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível concluir a operação."); }
    finally { setBusy(false); }
  }
  const grouped: [string, string[]][] = [["Central de atendimento", events.filter(event => internalEvents.has(event))], ["Mensagens e WhatsApp", events.filter(event => !internalEvents.has(event))]];
  return <section className="system-webhooks">
    <div className="settings-section-heading"><div><h3>Integrações HTTP</h3><p>Envie eventos da central ou do WhatsApp para qualquer sistema com endpoint HTTP ou HTTPS. O corpo é JSON e inclui os dados disponíveis do evento.</p></div><button className="solid-button" onClick={() => setDraft(empty())}><Plus size={16}/>Novo destino</button></div>
    <p className="form-help">Alguns eventos contêm dados pessoais. A opção “Todos os eventos” também inclui o QR Code da sessão; use apenas destinos confiáveis.</p>
    <details className="automation-field-guide"><summary>Ver dados disponíveis nos eventos da central</summary><div><span><b>Contato</b><code>chatId, contactProfile, revision, actorId</code></span><span><b>Atendimento</b><code>chatId, assignee, contactProfile, actorId</code></span><span><b>Equipe</b><code>room, message</code></span><span><b>Atividade</b><code>operatorId, operatorName, status, note, until, visit</code></span><span><b>Automação</b><code>automationId, name, mode, spreadsheetId, result</code></span><span><b>Perfil do contato</b><code>name, phone, email, company, document, address, tags, custom</code></span></div></details>
    <div className="webhook-grid">{hooks.map(hook => <article className="settings-card webhook-card" key={hook.id}><header><div><h3>{new URL(hook.url).hostname}</h3><p className="webhook-url">{hook.url}</p></div><span className={`webhook-badge ${hook.active ? "" : "off"}`}>{hook.active ? "Ativo" : "Pausado"}</span></header><div className="webhook-tags">{hook.events.includes("*") ? <span>Todos os eventos</span> : hook.events.slice(0, 4).map(event => <span key={event}>{labels[event] || event}</span>)}{hook.events.length > 4 && <span>+{hook.events.length - 4}</span>}</div><footer><button disabled={busy} onClick={() => void action(hook, "test")}><FlaskConical size={15}/>Testar</button><button disabled={busy} onClick={() => setDraft({ id: hook.id, url: hook.url, events: hook.events, active: hook.active, retryCount: hook.retryCount, secret: "", headersJson: "", filtersJson: hook.filters ? JSON.stringify(hook.filters, null, 2) : "" })}>Editar</button><button disabled={busy} onClick={() => void action(hook, "toggle")}>{hook.active ? "Pausar" : "Ativar"}</button><button className="danger" disabled={busy} onClick={() => void action(hook, "delete")}><Trash2 size={15}/>Excluir</button></footer></article>)}{!hooks.length && <div className="settings-card webhook-empty"><h3>Nenhuma integração HTTP</h3><p>Crie um destino para receber os eventos escolhidos.</p></div>}</div>
    {draft && <div className="webhook-modal-backdrop"><form className="webhook-modal system-webhook-modal" onSubmit={event => void save(event)}><header><div><h3>{draft.id ? "Editar integração" : "Nova integração"}</h3><p>Selecione eventos e o destino que receberá o JSON.</p></div><button type="button" onClick={() => setDraft(null)} aria-label="Fechar"><X size={19}/></button></header><div className="webhook-form-scroll"><section><h4>Destino</h4><label>URL HTTP ou HTTPS<input required type="url" value={draft.url} onChange={event => change({ url: event.target.value })} placeholder="https://seu-sistema.com/webhook"/></label><div className="webhook-form-grid"><label>Chave de assinatura (opcional)<input type="password" minLength={16} maxLength={255} value={draft.secret} onChange={event => change({ secret: event.target.value })} placeholder={draft.id ? "Deixe vazio para manter a atual" : "Mínimo de 16 caracteres"}/></label><label>Tentativas após falha<select value={draft.retryCount} onChange={event => change({ retryCount: Number(event.target.value) })}>{[0, 1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div><p className="form-help">A assinatura é enviada em <code>X-OpenWA-Signature</code>. Segredos e cabeçalhos não são exibidos novamente após salvar.</p></section><section><h4>Eventos</h4><label className="team-check"><input type="checkbox" checked={draft.active} onChange={event => change({ active: event.target.checked })}/>Integração ativa</label><label className="team-check"><input type="checkbox" checked={draft.events.includes("*")} onChange={event => change({ events: event.target.checked ? ["*"] : ["message.received"] })}/>Todos os eventos disponíveis</label>{!draft.events.includes("*") && grouped.map(([title, options]) => <div key={title}><h4>{title}</h4><div className="webhook-field-options">{options.map(value => <label key={value} className={draft.events.includes(value) ? "selected" : ""}><input type="checkbox" checked={draft.events.includes(value)} onChange={() => change({ events: draft.events.includes(value) ? draft.events.filter(item => item !== value) : [...draft.events, value] })}/><span>{labels[value] || value}</span></label>)}</div></div>)}</section><section><h4>Configuração avançada</h4><p className="form-help">Opcional: cabeçalhos para autenticação do destino e filtros no formato JSON do mecanismo de webhooks. O evento é enviado com <code>event</code>, <code>timestamp</code>, <code>sessionId</code> e <code>data</code>.</p><label>Cabeçalhos JSON<textarea rows={3} value={draft.headersJson} onChange={event => change({ headersJson: event.target.value })} placeholder={'{"Authorization":"Bearer ..."}'}/></label><label>Filtros JSON<textarea rows={4} value={draft.filtersJson} onChange={event => change({ filtersJson: event.target.value })} placeholder={'{"conditions":[{"field":"body","operator":"contains","value":"pedido"}]}'}/></label></section></div><footer><button type="button" onClick={() => setDraft(null)}>Cancelar</button><button className="solid-button" disabled={busy || !draft.events.length}><Save size={16}/>{busy ? "Salvando…" : "Salvar integração"}</button></footer></form></div>}
    {feedback && <p className="settings-feedback" role="status">{feedback}</p>}
  </section>;
}
