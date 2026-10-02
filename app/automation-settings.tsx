"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, CircleAlert, Eye, LoaderCircle, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

type Mapping = { column: string; target: string };
type Rule = { id?: string; name: string; spreadsheetId: string; range: string; phoneColumn: string; mappings: Mapping[]; messageTemplate: string; sendMessage: boolean; active: boolean; intervalMinutes: number; mode: "contacts" | "cnpjCall" | "monthlyCall"; detailsRange: string; controlCnpjColumn: string; detailsCnpjColumn: string; calledColumn: string; calledValue: string; controlNameColumn: string; detailsNameColumn: string; legalNameColumn: string; lastRunAt?: string | null; lastError?: string | null; failures?: { phone: string; error: string }[] };
type Preview = { headers: string[]; samples: Record<string, string>[]; total: number; eligible?: number; missing?: number; ambiguous?: number; alreadyCalled?: number; pendingMarkings?: number; monthSheet?: string; issues?: { row: number; cnpj: string; reason: string }[] };
type ApiError = { message?: string | string[] };
const apiError = (data: ApiError, fallback: string) => Array.isArray(data.message) ? data.message.join(" ") : data.message || fallback;
const blank = (): Rule => ({ name: "", spreadsheetId: "", range: "A1:Z201", phoneColumn: "Telefone", mappings: [{ column: "Primeiro nome", target: "firstName" }, { column: "Sobrenome", target: "lastName" }, { column: "Etiquetas", target: "tags" }], messageTemplate: "", sendMessage: false, active: false, intervalMinutes: 60, mode: "contacts", detailsRange: "", controlCnpjColumn: "CNPJ", detailsCnpjColumn: "CNPJ", calledColumn: "Chamado", calledValue: "Nós chamamos", controlNameColumn: "EMPRESA", detailsNameColumn: "Cliente", legalNameColumn: "Razão Social planilha Clientes Compufour" });
const monthlyTemplate = "Olá, tudo bem? Poderia me repassar o acesso remoto pelo AnyDesk para a geração dos arquivos mensais de {{Razões sociais}}? 👨‍💻📆";
const monthlySpreadsheetUrl = "https://docs.google.com/spreadsheets/d/14Ic09HRqKU3aYZAZrqWeB7FbnQvgJbB7eZGgTZBxdmw/";
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
  function selectMode(mode: Rule["mode"]) {
    change(mode === "monthlyCall" ? { mode, spreadsheetId: monthlySpreadsheetUrl, range: "MES_ANTERIOR!A1:M1001", detailsRange: "Clientes!A1:F1001",
      controlCnpjColumn: "CNPJ", controlNameColumn: "EMPRESA", detailsNameColumn: "Cliente",
      legalNameColumn: "Razão Social planilha Clientes Compufour", calledColumn: "Chamado", calledValue: "Nós chamamos",
      messageTemplate: monthlyTemplate, sendMessage: true } : mode === "cnpjCall"
      ? { mode, range: "Controle!A1:H201", detailsRange: "Clientes!A1:D201", sendMessage: true, messageTemplate: "" }
      : { mode, range: "A1:Z201", detailsRange: "", sendMessage: false, messageTemplate: "" });
  }
  async function requestPreview() {
    if (!editing) return;
    setBusy(true); setFeedback("");
    try {
      const response = await fetch(`${endpoint}/preview`, { method: "POST", headers, body: JSON.stringify(editing) });
      const data = await response.json() as ApiError & Preview;
      if (!response.ok) throw new Error(apiError(data, "Não foi possível ler a planilha."));
      setPreview(data);
      setFeedback(editing.mode === "monthlyCall" ? `${data.monthSheet}: ${data.eligible || 0} contato(s) apto(s) para uma mensagem; ${data.missing || 0} linha(s) sem correspondência; ${data.ambiguous || 0} ambígua(s). A prévia não envia mensagens.` : editing.mode === "cnpjCall" ? `${data.eligible || 0} cliente(s) apto(s); ${data.missing || 0} sem correspondência; ${data.ambiguous || 0} ambíguo(s); ${data.alreadyCalled || 0} já marcado(s). A prévia não envia mensagens.` : `${data.total} linha(s) encontradas. A prévia não altera contatos nem envia mensagens.`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível ler a planilha."); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing) return;
    if ((editing.active || editing.sendMessage) && !preview) { setFeedback("Confira a prévia atual da planilha antes de ativar a sincronização ou o envio."); return; }
    if (editing.active && editing.sendMessage && !confirm(editing.mode === "monthlyCall"
      ? `Ativar “${editing.name}”? Contatos com CNPJ correspondente e Chamado vazio poderão receber uma mensagem no mês anterior. Confira a prévia antes de continuar.`
      : `Ativar “${editing.name}” com envio automático? Na primeira execução, contatos da planilha sem registro anterior poderão receber mensagens.`)) return;
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
    if (rule.sendMessage && !confirm(rule.mode === "monthlyCall"
      ? `Executar “${rule.name}” para o mês anterior e enviar uma mensagem por contato elegível? O envio não pode ser desfeito.`
      : `Sincronizar “${rule.name}” e enviar a mensagem configurada para contatos novos ou alterados? O envio não pode ser desfeito.`)) return;
    setBusy(true); setFeedback("Lendo a planilha e atualizando contatos…");
    try {
      const response = await fetch(`${endpoint}/${rule.id}/run`, { method: "POST", headers });
      const data = await response.json() as ApiError & { total: number; updated: number; unchanged: number; pending: number; sent: number; failed: number; marked?: number; missing?: number; ambiguous?: number; skipped?: number };
      if (!response.ok) throw new Error(apiError(data, "Falha na sincronização."));
      setFeedback(rule.mode === "cnpjCall" || rule.mode === "monthlyCall" ? `${data.sent} mensagem(ns) enviada(s), ${data.marked || 0} linha(s) marcada(s) como Chamado, ${data.missing || 0} sem correspondência, ${data.ambiguous || 0} ambígua(s)${data.skipped ? `, ${data.skipped} contato(s) ignorado(s) por já ter chamado ou exigir revisão` : ""}${data.failed ? `, ${data.failed} falha(s) para revisão` : ""}${data.pending ? `, ${data.pending} pendente(s)` : ""}.` : `${data.total} linha(s): ${data.updated} atualizada(s), ${data.unchanged} sem alteração, ${data.sent} mensagem(ns) enviada(s)${data.failed ? `, ${data.failed} falha(s) de envio` : ""}${data.pending ? `, ${data.pending} pendente(s) para a próxima execução` : ""}.`);
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
    <div className="settings-section-heading"><div><h2>Automações</h2><p>Atualize contatos ou envie uma mensagem mensal reunindo as empresas de cada cliente.</p></div><button className="solid-button" onClick={() => { setEditing(blank()); setPreview(null); }}><Plus size={17}/>Nova automação</button></div>
    <section className="settings-card automation-connection"><div><h3>Google Sheets privado</h3><p>{serviceEmail ? <>Compartilhe a planilha com <b>{serviceEmail}</b> como leitor para importar contatos ou como editor para a automação que marca “Chamado”. Ela não precisa ser publicada.</> : <>A conta de serviço ainda não foi configurada no servidor. Configure <code>GOOGLE_SERVICE_ACCOUNT_JSON_BASE64</code> para conectar planilhas privadas.</>}</p></div><span className={serviceEmail ? "automation-connected" : "automation-pending"}>{serviceEmail ? <><CheckCircle2 size={16}/>Conectado</> : <><CircleAlert size={16}/>Configuração pendente</>}</span></section>
    <div className="automation-steps"><span>1. Conectar planilha <ArrowRight size={14}/></span><span>2. Mapear campos <ArrowRight size={14}/></span><span>3. Conferir prévia <ArrowRight size={14}/></span><span>4. Ativar sincronização</span></div>
    {loading ? <p>Carregando automações…</p> : <div className="automation-list">
      {rules.map(rule => <article className="settings-card automation-rule" key={rule.id}>
        <header><div><h3>{rule.name}</h3><p>{rule.active ? `Ativa · a cada ${rule.intervalMinutes} minutos` : "Pausada"} · {rule.mode === "monthlyCall" ? "Uma mensagem por contato no mês anterior" : rule.sendMessage ? "Mensagem automática habilitada" : "Somente atualiza contatos"}</p></div><span className={rule.active ? "automation-connected" : "automation-pending"}>{rule.active ? "Ativa" : "Pausada"}</span></header>
        <p className="automation-rule-meta">{rule.mode === "monthlyCall" ? "Aba mensal: mês anterior" : `Intervalo: ${rule.range}`} · Última execução: {rule.lastRunAt ? new Date(rule.lastRunAt).toLocaleString("pt-BR") : "ainda não executada"}</p>
        {rule.lastError && <p className="automation-error">{rule.lastError}</p>}
        {Boolean(rule.failures?.length) && <div className="automation-failures"><b>Envios que precisam de revisão</b>{rule.failures!.slice(0, 5).map(item => <p key={item.phone}>{item.phone}: {item.error}</p>)}</div>}
        <footer><button disabled={busy || !serviceEmail} onClick={() => void run(rule)}><RefreshCw size={15}/>Sincronizar agora</button><button onClick={() => { setEditing({ ...rule, mappings: [...rule.mappings] }); setPreview(null); }}>Editar</button><button className="danger" onClick={() => void remove(rule)}><Trash2 size={15}/>Excluir</button></footer>
      </article>)}
      {!rules.length && <div className="settings-card automation-empty"><h3>Nenhuma automação criada</h3><p>Configure uma planilha, confira a prévia e escolha quais dados usar.</p></div>}
    </div>}
    {editing && <div className="webhook-modal-backdrop"><form className="webhook-modal automation-modal" onSubmit={event => void save(event)}>
      <header><div><h3>{editing.id ? "Editar automação" : "Nova automação"}</h3><p>{editing.mode === "monthlyCall" ? "Mês anterior → Clientes → uma mensagem por contato" : editing.mode === "cnpjCall" ? "Controle por CNPJ → mensagem → marcar Chamado" : "Planilha privada → contato → mensagem opcional"}</p></div><button type="button" onClick={() => setEditing(null)} aria-label="Fechar">×</button></header>
      <div className="webhook-form-scroll">
        <section><h4>Origem dos dados</h4>
          <label>Tipo de automação<select disabled={Boolean(editing.id)} value={editing.mode} onChange={event => selectMode(event.target.value as Rule["mode"])}><option value="contacts">Atualizar contatos por telefone</option><option value="cnpjCall">Chamar clientes por CNPJ</option><option value="monthlyCall">Arquivos mensais — mês anterior</option></select></label>
          <label>Nome da automação<input required maxLength={100} value={editing.name} onChange={event => change({ name: event.target.value })} placeholder="Ex.: Solicitar acesso remoto"/></label>
          <label>Link ou ID da planilha<input required value={editing.spreadsheetId} onChange={event => change({ spreadsheetId: event.target.value })} placeholder="https://docs.google.com/spreadsheets/d/…"/></label>
          {editing.mode === "monthlyCall" ? <><div className="webhook-form-grid"><label>Aba mensal automática<input readOnly value="Mês anterior (ex.: Setembro2026 em outubro)"/></label><label>Intervalo da aba mensal<input readOnly value={editing.range}/></label></div><label>Intervalo da aba Clientes<input required value={editing.detailsRange} onChange={event => change({ detailsRange: event.target.value })} placeholder="Clientes!A1:F1001"/></label><div className="webhook-form-grid"><label>Empresa na aba mensal<input required value={editing.controlNameColumn} onChange={event => change({ controlNameColumn: event.target.value })}/></label><label>CNPJ na aba mensal<input required value={editing.controlCnpjColumn} onChange={event => change({ controlCnpjColumn: event.target.value })}/></label></div><div className="webhook-form-grid"><label>Nome na aba Clientes<input required value={editing.detailsNameColumn} onChange={event => change({ detailsNameColumn: event.target.value })}/></label><label>Razão social na aba Clientes<input required value={editing.legalNameColumn} onChange={event => change({ legalNameColumn: event.target.value })}/></label></div><div className="webhook-form-grid"><label>Coluna de retorno<input required value={editing.calledColumn} onChange={event => change({ calledColumn: event.target.value })}/></label><label>Valor após envio<input required value={editing.calledValue} onChange={event => change({ calledValue: event.target.value })}/></label></div><small>O sistema encontra o contato pelo CNPJ, cruza EMPRESA com Cliente e agrupa as razões sociais por contato. Um “X” separado no nome bloqueia a chamada.</small></> : editing.mode === "cnpjCall" ? <><div className="webhook-form-grid"><label>Aba de controle (intervalo)<input required value={editing.range} onChange={event => change({ range: event.target.value })} placeholder="Controle!A1:H201"/></label><label>Aba com dados do cliente (intervalo)<input required value={editing.detailsRange} onChange={event => change({ detailsRange: event.target.value })} placeholder="Clientes!A1:D201"/></label></div><div className="webhook-form-grid"><label>Coluna CNPJ do controle<input required value={editing.controlCnpjColumn} onChange={event => change({ controlCnpjColumn: event.target.value })}/></label><label>Coluna CNPJ dos dados<input required value={editing.detailsCnpjColumn} onChange={event => change({ detailsCnpjColumn: event.target.value })}/></label></div><div className="webhook-form-grid"><label>Coluna de retorno<input required value={editing.calledColumn} onChange={event => change({ calledColumn: event.target.value })}/></label><label>Valor após envio<input required value={editing.calledValue} onChange={event => change({ calledValue: event.target.value })}/></label></div><small>Apenas linhas com “Chamado” vazio serão consideradas. O contato precisa existir e ter o CNPJ no campo Documento ou em um campo personalizado chamado CNPJ. Não cria contatos.</small></> : <><div className="webhook-form-grid"><label>Intervalo com cabeçalho na primeira linha<input required value={editing.range} onChange={event => change({ range: event.target.value })} placeholder="Página1!A1:Z201"/></label><label>Coluna do telefone<input required value={editing.phoneColumn} onChange={event => change({ phoneColumn: event.target.value })} placeholder="Telefone"/></label></div><small>O telefone identifica o contato existente. A sincronização não apaga contatos ausentes na planilha.</small></>}
        </section>
        {editing.mode === "contacts" && <section><h4>Campos do contato</h4><p className="form-help">Associe o nome exato da coluna a um campo. Para outros dados, use <code>custom:Nome do campo</code>.</p>{editing.mappings.map((mapping, index) => <div className="automation-mapping" key={index}><input aria-label={`Coluna ${index + 1}`} value={mapping.column} onChange={event => change({ mappings: editing.mappings.map((item, i) => i === index ? { ...item, column: event.target.value } : item) })} placeholder="Nome da coluna"/><select aria-label={`Campo ${index + 1}`} value={targets.some(([value]) => value === mapping.target) ? mapping.target : "custom"} onChange={event => change({ mappings: editing.mappings.map((item, i) => i === index ? { ...item, target: event.target.value === "custom" ? "custom:" : event.target.value } : item) })}>{targets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="custom">Campo personalizado</option></select>{mapping.target.startsWith("custom:") && <input aria-label={`Nome do campo personalizado ${index + 1}`} value={mapping.target.slice(7)} onChange={event => change({ mappings: editing.mappings.map((item, i) => i === index ? { ...item, target: `custom:${event.target.value}` } : item) })} placeholder="Nome do campo"/>}<button type="button" aria-label="Remover mapeamento" onClick={() => change({ mappings: editing.mappings.filter((_, i) => i !== index) })}>×</button></div>)}<button type="button" className="automation-add" onClick={() => change({ mappings: [...editing.mappings, { column: "", target: "email" }] })}><Plus size={15}/>Adicionar campo</button></section>}
        <section><h4>Mensagem automática</h4>{editing.mode === "contacts" && <label className="team-check"><input type="checkbox" checked={editing.sendMessage} onChange={event => change({ sendMessage: event.target.checked })}/><span>Enviar para cada contato novo ou com dados alterados</span></label>}<p className="form-help">{editing.mode === "monthlyCall" ? <>Use <code>{"{{Razões sociais}}"}</code> para inserir todas as empresas do contato em uma única mensagem. Também estão disponíveis <code>{"{{CNPJs}}"}</code> e <code>{"{{Mês}}"}</code>. O negrito usa asteriscos do WhatsApp.</> : <>Use <code>{"{{Nome da coluna}}"}</code> para incluir valores da planilha.{editing.mode === "cnpjCall" ? " Ex.: {{Razão social}} da aba de dados. A marcação de Chamado só ocorre após o envio; casos ambíguos ou sem CNPJ correspondente são ignorados." : " Confira a prévia antes de ativar."}</>}</p><textarea rows={5} maxLength={4000} disabled={editing.mode === "contacts" && !editing.sendMessage} value={editing.messageTemplate} onChange={event => change({ messageTemplate: event.target.value })} placeholder={editing.mode === "monthlyCall" ? monthlyTemplate : "Olá, tudo bem? Poderia me repassar o suporte remoto de {{Razão social}}?"}/></section>
        <section><h4>Execução</h4><label className="team-check"><input type="checkbox" checked={editing.active} onChange={event => change({ active: event.target.checked })}/><span>Sincronizar automaticamente</span></label><label>Frequência<select value={editing.intervalMinutes} onChange={event => change({ intervalMinutes: Number(event.target.value) })}>{[[15,"15 minutos"],[30,"30 minutos"],[60,"1 hora"],[180,"3 horas"],[360,"6 horas"],[1440,"1 dia"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" className="automation-add" disabled={busy || !serviceEmail} onClick={() => void requestPreview()}>{busy ? <LoaderCircle size={15} className="wa-spin"/> : <Eye size={15}/>}Conferir planilha</button>{preview && <div className="automation-preview"><b>{preview.monthSheet ? `${preview.monthSheet} · ` : ""}{preview.total} linha(s){editing.mode !== "contacts" ? ` · ${preview.eligible || 0} contato(s) apto(s) · ${preview.missing || 0} sem correspondência · ${preview.ambiguous || 0} ambíguo(s)` : ` · Colunas: ${preview.headers.join(", ")}`}</b><div>{preview.samples.map((sample, index) => <p key={index}>{Object.entries(sample).slice(0, 5).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>)}</div>{Boolean(preview.issues?.length) && <div className="automation-failures"><b>Linhas para revisar</b>{preview.issues!.slice(0, 20).map(issue => <p key={issue.row}>Linha {issue.row} · {issue.cnpj || "Sem CNPJ"}: {issue.reason}</p>)}</div>}</div>}</section>
      </div><footer><button type="button" onClick={() => setEditing(null)}>Cancelar</button><button className="solid-button" disabled={busy}><Save size={16}/>{busy ? "Aguarde…" : "Salvar automação"}</button></footer>
    </form></div>}
    {feedback && <p className="settings-feedback" role="status">{feedback}</p>}
  </div>;
}
