"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ContactRound, LoaderCircle, TriangleAlert } from "lucide-react";
import { errorMessage, operatorRequest } from "./atende-api";
import type { ConversationFlow } from "./flow-settings";

type RobotConfig = {
  enabled: boolean;
  message: string;
  flowId: string | null;
  contactName: string;
  contactPhone: string;
  generation: number;
};

const blank = (): RobotConfig => ({ enabled: false, message: "", flowId: null, contactName: "", contactPhone: "", generation: 0 });
const supportedFlow = (flow: ConversationFlow) => flow.active && flow.kind === "regular" && flow.steps.length > 0 &&
  flow.steps.every(step => ["message", "image", "video", "audio", "document", "delay"].includes(step.type)) &&
  flow.steps.reduce((sum, step) => sum + Math.max(0, Number(step.delaySeconds) || 0), 0) <= 3600;

export function RobotAutomationSettings({ baseUrl, token }: { baseUrl: string; token: string }) {
  const [saved, setSaved] = useState<RobotConfig>(blank);
  const [editing, setEditing] = useState<RobotConfig>(blank);
  const [flows, setFlows] = useState<ConversationFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([
      operatorRequest(baseUrl, token, "/admin/robot").then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(errorMessage(data));
        return data as RobotConfig;
      }),
      operatorRequest(baseUrl, token, "/flows").then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(errorMessage(data));
        return data as ConversationFlow[];
      }),
    ]).then(([config, available]) => {
      if (!live) return;
      setSaved(config); setEditing(config); setFlows(available);
    }).catch(error => { if (live) setFeedback(error instanceof Error ? error.message : "Não foi possível carregar o robô."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [baseUrl, token]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (editing.enabled && !saved.enabled && !window.confirm("Ativar o robô agora? Novas mensagens de clientes poderão receber a resposta automática, independentemente do horário.")) return;
    setSaving(true); setFeedback("");
    try {
      const response = await operatorRequest(baseUrl, token, "/admin/robot", { method: "PUT", body: JSON.stringify(editing) });
      const data = await response.json();
      if (!response.ok) throw new Error(errorMessage(data));
      const config = data as RobotConfig;
      setSaved(config); setEditing(config);
      setFeedback(config.enabled ? "Robô ativo. Cada cliente receberá a resposta uma vez nesta ativação quando chamar." : "Robô desativado. Nenhuma nova resposta automática será enviada por ele.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível salvar o robô."); }
    finally { setSaving(false); }
  }

  const eligibleFlows = flows.filter(supportedFlow);
  const selectedFlow = eligibleFlows.find(flow => flow.id === editing.flowId);
  const hasContact = Boolean(editing.contactName.trim() && editing.contactPhone.replace(/\D/g, ""));
  const hasChanges = !loading && (editing.enabled !== saved.enabled || editing.message !== saved.message || editing.flowId !== saved.flowId ||
    editing.contactName !== saved.contactName || editing.contactPhone !== saved.contactPhone);
  return <div className="robot-settings">
    <header className="robot-heading"><h2>Resposta automática</h2><p>Responda sozinho a quem chamar pela primeira vez, mesmo fora do horário de atendimento.</p></header>
    {loading ? <p>Carregando configuração…</p> : <form className="robot-layout" onSubmit={event => void save(event)}>
      <div className="robot-form">
        <section className={`settings-card robot-card robot-activation${editing.enabled ? " is-enabled" : ""}`}>
          <div className="robot-activation-header"><div className="robot-title-line"><h3>Ativar resposta automática</h3><span className={`robot-state${saved.enabled ? " is-on" : ""}`}>{saved.enabled ? "Ligada" : "Desligada"}</span></div>
            <label className="settings-switch robot-switch"><input type="checkbox" aria-label="Ativar resposta automática" checked={editing.enabled} onChange={event => setEditing(current => ({ ...current, enabled: event.target.checked }))}/><span/></label></div>
          <div className="robot-chip-row"><span>Funciona em qualquer horário</span><span>Só conversas individuais</span><span>Uma vez por cliente</span></div>
          <p>Ao desligar e ligar de novo, começa uma nova rodada de respostas.</p>
          {editing.enabled !== saved.enabled && <small className="robot-pending">A mudança de estado só vale depois de salvar.</small>}
        </section>

        <section className="settings-card robot-card"><h3>Mensagem para o cliente</h3><p>É o primeiro texto que a pessoa recebe. As quebras de linha são mantidas.</p>
          <label className="robot-visually-hidden" htmlFor="robot-message">Mensagem para o cliente</label>
          <textarea id="robot-message" required={editing.enabled} maxLength={4000} rows={7} value={editing.message} onChange={event => setEditing(current => ({ ...current, message: event.target.value }))} placeholder="Boa tarde! Estamos em um evento interno e o atendimento está reduzido. Para urgências, entre em contato com..."/>
          <div className="robot-message-meta"><small>Dica: diga o motivo e quando você volta.</small><small>{editing.message.length}/4000</small></div>
        </section>

        <section className="settings-card robot-card"><div className="robot-card-title"><h3>Fluxo adicional</h3><span>opcional</span></div>
          <p>Enviado depois da mensagem e do contato. Fluxos ativos com mensagens, mídia e pausas funcionam; ações, enquetes e planilhas não são executadas.</p>
          <label className="robot-visually-hidden" htmlFor="robot-flow">Fluxo adicional</label>
          <select id="robot-flow" value={editing.flowId || ""} onChange={event => setEditing(current => ({ ...current, flowId: event.target.value || null }))}>
            <option value="">Nenhum fluxo</option>{eligibleFlows.map(flow => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
            {editing.flowId && !selectedFlow && <option value={editing.flowId} disabled>Fluxo indisponível — selecione outro</option>}
          </select>
        </section>

        <section className="settings-card robot-card"><div className="robot-card-title"><h3>Contato para urgências</h3><span>opcional</span></div>
          <p>Enviado como cartão de contato do WhatsApp logo após a mensagem.</p>
          <div className="robot-contact-fields"><label htmlFor="robot-contact-name">Nome do contato<input id="robot-contact-name" maxLength={160} value={editing.contactName} onChange={event => setEditing(current => ({ ...current, contactName: event.target.value }))} placeholder="Félix"/></label>
            <label htmlFor="robot-contact-phone">Telefone com DDI<input id="robot-contact-phone" inputMode="tel" value={editing.contactPhone} onChange={event => setEditing(current => ({ ...current, contactPhone: event.target.value }))} placeholder="+55 88 8853-0990"/></label></div>
          <div className="robot-contact-warning"><TriangleAlert size={16}/><span>Esse número será compartilhado com todos os clientes que receberem a resposta. Confirme se a pessoa autorizou.</span></div>
        </section>

        <div className="robot-actions"><button className="solid-button" type="submit" disabled={saving}>{saving && <LoaderCircle size={16} className="wa-spin"/>}{saving ? "Salvando…" : editing.enabled && !saved.enabled ? "Salvar e ativar robô" : "Salvar configuração"}</button>
          {hasChanges && <small>Alterações não salvas</small>}</div>
        {feedback && <p className="settings-feedback" role="status">{feedback}</p>}
      </div>

      <aside className="robot-preview" aria-label="Prévia da resposta automática"><h3>Como o cliente vai ver</h3>
        <div className="robot-preview-panel"><div className="robot-preview-incoming">Oi, vocês atendem hoje?</div>
          <div className={`robot-preview-outgoing${editing.message.trim() ? "" : " is-placeholder"}`}>{editing.message.trim() ? editing.message : "Sua mensagem aparecerá aqui."}</div>
          {hasContact && <div className="robot-preview-contact"><span className="robot-preview-avatar"><ContactRound size={18}/></span><span><strong>{editing.contactName.trim()}</strong><small>+{editing.contactPhone.replace(/\D/g, "")}</small></span></div>}
        </div>
        <p>Prévia ilustrativa. Campos automáticos são preenchidos no envio.{selectedFlow ? ` O fluxo “${selectedFlow.name}” será enviado em seguida.` : ""}</p>
      </aside>
    </form>}
  </div>;
}
