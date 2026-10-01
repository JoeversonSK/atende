"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, CircleAlert, Eye, LoaderCircle, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

type Mapping = { column: string; target: string };
type Rule = { id?: string; name: string; spreadsheetId: string; range: string; phoneColumn: string; mappings: Mapping[]; messageTemplate: string; sendMessage: boolean; active: boolean; intervalMinutes: number; lastRunAt?: string | null; lastError?: string | null; failures?: { phone: string; error: string }[] };
type Preview = { headers: string[]; samples: Record<string, string>[]; total: number };
type ApiError = { message?: string | string[] };
const apiError = (data: ApiError, fallback: string) => Array.isArray(data.message) ? data.message.join(" ") : data.message || fallback;
const blank = (): Rule => ({ name: "", spreadsheetId: "", range: "A1:Z201", phoneColumn: "Telefone", mappings: [{ column: "Primeiro nome", target: "firstName" }, { column: "Sobrenome", target: "lastName" }, { column: "Etiquetas", target: "tags" }], messageTemplate: "", sendMessage: false, active: false, intervalMinutes: 60 });
const targets = [["firstName", "Primeiro nome"], ["lastName", "Sobrenome"], ["name", "Nome completo"], ["email", "E-mail"], ["company", "Empresa"], ["document", "Documento"], ["address", "Endereço"], ["tags", "Etiquetas (separadas por vírgula)"]];

export function AutomationSettings({ baseUrl, token }: { baseUrl: string; token: string }) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/operator-auth/automations/sheets`;
  const [rules, setRules] = useState<Rule[]>([]);
  const [serviceEmail, setServiceEmail] = useState<string | null>(null);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const headers = { "Content-Type": "application/json", "X-Atende-Token": token };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(endpoint, { headers: { "X-Atende-Token": token } });
      const data = await response.json() as ApiError & { rules?: Rule[]; serviceAccountEmail?: string | null };
      if (!response.ok) throw new Error(apiError(data, "Não foi possível carregar as automações."));
      setRules(Array.isArray(data.rules) ? data.rules : []);
      setServiceEmail(data.serviceAccountEmail || null);
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível carregar as automações."); }
    finally { setLoading(false); }
  }, [endpoint, token]);
  useEffect(() => { void load(); }, [load]);
  function change(patch: Partial<Rule>) { setEditing(current => current ? { ...current, ...patch } : current); setPreview(null); }
  async function requestPreview() {
    if (!editing) return;
    setBusy(true); setFeedback("");
    try {
      const response = await fetch(`${endpoint}/preview`, { method: "POST", headers, body: JSON.stringify(editing) });
      const data = await response.json() as ApiError & Preview;
      if (!response.ok) throw new Error(apiError(data, "Não foi possível ler a planilha."));
      setPreview(data);
      setFeedback(`${data.total} linha(s) encontradas. A prévia não altera contatos nem envia mensagens.`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível ler a planilha."); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing) return;
    if ((editing.active || editing.sendMessage) && !preview) { setFeedback("Confira a prévia atual da planilha antes de ativar a sincronização ou o envio."); return; }
    if (editing.active && editing.sendMessage && !confirm(`Ativar “${editing.name}” com envio automático? Na primeira execução, contatos da planilha sem registro anterior poderão receber mensagens.`)) return;
    setBusy(true); setFeedback("");
    try {
      const response = await fetch(editing.id ? `${endpoint}/${editing.id}` : endpoint, { method: editing.id ? "PUT" : "POST", headers, body: JSON.stringify(editing) });
      const data = await response.json() as ApiError;
      if (!response.ok) throw new Error(apiError(data, "Não foi possível salvar."));
      setEditing(null); setPreview(null); setFeedback("Automação salva. Sincronize agora ou aguarde o próximo intervalo se ela estiver ativa.");
      await load();
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  async function run(rule: Rule) {
    if (!rule.id) return;
    if (rule.sendMessage && !confirm(`Sincronizar “${rule.name}” e enviar a mensagem configurada para contatos novos ou alterados? O envio não pode ser desfeito.`)) return;
    setBusy(true); setFeedback("Lendo a planilha e atualizando contatos…");
    try {
      const response = await fetch(`${endpoint}/${rule.id}/run`, { method: "POST", headers });
      const data = await response.json() as ApiError & { total: number; updated: number; unchanged: number; pending: number; sent: number; failed: number };
      if (!response.ok) throw new Error(apiError(data, "Falha na sincronização."));
      setFeedback(`${data.total} linha(s): ${data.updated} atualizada(s), ${data.unchanged} sem alteração, ${data.sent} mensagem(ns) enviada(s)${data.failed ? `, ${data.failed} falha(s) de envio` : ""}${data.pending ? `, ${data.pending} pendente(s) para a próxima execução` : ""}.`);
      await load();
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Falha na sincronização."); }
    finally { setBusy(false); }
  }
  async function remove(rule: Rule) {
    if (!rule.id || !confirm(`Excluir a automação “${rule.name}”? Os contatos já sincronizados permanecerão no sistema.`)) return;
    setBusy(true); setFeedback("");
    try {
      const response = await fetch(`${endpoint}/${rule.id}`, { method: "DELETE", headers });
      if (!response.ok) throw new Error(apiError(await response.json() as ApiError, "Não foi possível excluir."));
      setFeedback("Automação excluída. Os contatos foram preservados."); await load();
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível excluir."); }
    finally { setBusy(false); }
  }
  return <div className="automation-page">
    <div className="settings-section-heading"><div><h2>Automações</h2><p>Traga dados de uma planilha privada, atualize contatos e envie mensagens com campos da própria linha.</p></div><button className="solid-button" onClick={() => { setEditing(blank()); setPreview(null); }}><Plus size={17}/>Nova automação</button></div>
    <section className="settings-card automation-connection"><div><h3>Google Sheets privado</h3><p>{serviceEmail ? <>Compartilhe a planilha com <b>{serviceEmail}</b> como leitor. Ela não precisa ser publicada na internet.</> : <>A conta de serviço ainda não foi configurada no servidor. Configure <code>GOOGLE_SERVICE_ACCOUNT_JSON_BASE64</code> para conectar planilhas privadas.</>}</p></div><span className={serviceEmail ? "automation-connected" : "automation-pending"}>{serviceEmail ? <><CheckCircle2 size={16}/>Conectado</> : <><CircleAlert size={16}/>Configuração pendente</>}</span></section>
    <div className="automation-steps"><span>1. Conectar planilha <ArrowRight size={14}/></span><span>2. Mapear campos <ArrowRight size={14}/></span><span>3. Conferir prévia <ArrowRight size={14}/></span><span>4. Ativar sincronização</span></div>
    {loading ? <p>Carregando automações…</p> : <div className="automation-list">{rules.map(rule => <article className="settings-card automation-rule" key={rule.id}><header><div><h3>{rule.name}</h3><p>{rule.active ? `Ativa · a cada ${rule.intervalMinutes} minutos` : "Pausada"} · {rule.sendMessage ? "Mensagem automática habilitada" : "Somente atualiza contatos"}</p></div><span className={rule.active ? "automation-connected" : "automation-pending"}>{rule.active ? "Ativa" : "Pausada"}</span></header><p className="automation-rule-meta">Intervalo: {rule.range} · Última execução: {rule.lastRunAt ? new Date(rule.lastRunAt).toLocaleString("pt-BR") : "ainda não executada"}</p>{rule.lastError && <p className="automation-error">{rule.lastError}</p>}{Boolean(rule.failures?.length) && <div className="automation-failures"><b>Envios que precisam de revisão</b>{rule.failures!.slice(0, 5).map(item => <p key={item.phone}>{item.phone}: {item.error}</p>)}</div>}<footer><button disabled={busy || !serviceEmail} onClick={() => void run(rule)}><RefreshCw size={15}/>Sincronizar agora</button><button onClick={() => { setEditing({ ...rule, mappings: [...rule.mappings] }); setPreview(null); }}>Editar</button><button className="danger" onClick={() => void remove(rule)}><Trash2 size={15}/>Excluir</button></footer></article>)}{!rules.length && <div className="settings-card automation-empty"><h3>Nenhuma automação criada</h3><p>Configure uma planilha, confira a prévia e escolha quais colunas atualizarão os contatos.</p></div>}</div>}
    {editing && <div className="webhook-modal-backdrop"><form className="webhook-modal automation-modal" onSubmit={event => void save(event)}><header><div><h3>{editing.id ? "Editar automação" : "Nova automação"}</h3><p>Planilha privada → contato → mensagem opcional</p></div><button type="button" onClick={() => setEditing(null)} aria-label="Fechar">×</button></header><div className="webhook-form-scroll"><section><h4>Origem dos dados</h4><label>Nome da automação<input required maxLength={100} value={editing.name} onChange={event => change({ name: event.target.value })} placeholder="Ex.: Aviso de vencimento"/></label><label>Link ou ID da planilha<input required value={editing.spreadsheetId} onChange={event => change({ spreadsheetId: event.target.value })} placeholder="https://docs.google.com/spreadsheets/d/…"/></label><div className="webhook-form-grid"><label>Intervalo com cabeçalho na primeira linha<input required value={editing.range} onChange={event => change({ range: event.target.value })} placeholder="Página1!A1:Z201"/></label><label>Coluna do telefone<input required value={editing.phoneColumn} onChange={event => change({ phoneColumn: event.target.value })} placeholder="Telefone"/></label></div><small>O telefone identifica o contato existente. A sincronização não apaga contatos ausentes na planilha.</small></section><section><h4>Campos do contato</h4><p className="form-help">Associe o nome exato da coluna a um campo. Para outros dados, use <code>custom:Nome do campo</code>.</p>{editing.mappings.map((mapping, index) => <div className="automation-mapping" key={index}><input aria-label={`Coluna ${index + 1}`} value={mapping.column} onChange={event => change({ mappings: editing.mappings.map((item, i) => i === index ? { ...item, column: event.target.value } : item) })} placeholder="Nome da coluna"/><select aria-label={`Campo ${index + 1}`} value={targets.some(([value]) => value === mapping.target) ? mapping.target : "custom"} onChange={event => change({ mappings: editing.mappings.map((item, i) => i === index ? { ...item, target: event.target.value === "custom" ? "custom:" : event.target.value } : item) })}>{targets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="custom">Campo personalizado</option></select>{mapping.target.startsWith("custom:") && <input aria-label={`Nome do campo personalizado ${index + 1}`} value={mapping.target.slice(7)} onChange={event => change({ mappings: editing.mappings.map((item, i) => i === index ? { ...item, target: `custom:${event.target.value}` } : item) })} placeholder="Nome do campo"/>}<button type="button" aria-label="Remover mapeamento" onClick={() => change({ mappings: editing.mappings.filter((_, i) => i !== index) })}>×</button></div>)}<button type="button" className="automation-add" onClick={() => change({ mappings: [...editing.mappings, { column: "", target: "email" }] })}><Plus size={15}/>Adicionar campo</button></section><section><h4>Mensagem automática</h4><label className="team-check"><input type="checkbox" checked={editing.sendMessage} onChange={event => change({ sendMessage: event.target.checked })}/><span>Enviar para cada contato novo ou com dados alterados</span></label><p className="form-help">Use <code>{"{{Nome da coluna}}"}</code> para incluir o valor daquela linha. O primeiro envio pode alcançar todos os contatos da planilha; confira a prévia antes de ativar.</p><textarea rows={5} maxLength={4000} disabled={!editing.sendMessage} value={editing.messageTemplate} onChange={event => change({ messageTemplate: event.target.value })} placeholder="Olá, {{Primeiro nome}}! Sua informação: {{Vencimento}}."/></section><section><h4>Execução</h4><label className="team-check"><input type="checkbox" checked={editing.active} onChange={event => change({ active: event.target.checked })}/><span>Sincronizar automaticamente</span></label><label>Frequência<select value={editing.intervalMinutes} onChange={event => change({ intervalMinutes: Number(event.target.value) })}>{[[15,"15 minutos"],[30,"30 minutos"],[60,"1 hora"],[180,"3 horas"],[360,"6 horas"],[1440,"1 dia"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" className="automation-add" disabled={busy || !serviceEmail} onClick={() => void requestPreview()}>{busy ? <LoaderCircle size={15} className="wa-spin"/> : <Eye size={15}/>}Conferir planilha</button>{preview && <div className="automation-preview"><b>{preview.total} linha(s) · Colunas: {preview.headers.join(", ")}</b><div>{preview.samples.map((sample, index) => <p key={index}>{Object.entries(sample).slice(0, 5).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>)}</div></div>}</section></div><footer><button type="button" onClick={() => setEditing(null)}>Cancelar</button><button className="solid-button" disabled={busy}><Save size={16}/>{busy ? "Aguarde…" : "Salvar automação"}</button></footer></form></div>}
    {feedback && <p className="settings-feedback" role="status">{feedback}</p>}
  </div>;
}
