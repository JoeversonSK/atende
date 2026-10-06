"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { X } from "lucide-react";
import type { ApiConfig } from "../../atende-api";
import type { Chat } from "../../conversation-model";
import type { OperatorIdentity } from "../../operator-activity";
import type { SupportOverview } from "../../ticket-dashboard";
import { ContactProfile } from "../../contact-profile";
import { ContactAvatar } from "./contact-avatar";

type Assignment = { assigneeName: string; assigneeId?: string; updatedAt?: string };

export function ConversationProfile({
  selected, detailsOpen, setDetailsOpen, assignment, savingAssignment, operator,
  saveAssignment, clearAssignment, transferId, setTransferId, agents, config,
  profileDirtyRef, profileReload, operatorToken, onContactSaved,
}: {
  selected: Chat;
  detailsOpen: boolean;
  setDetailsOpen: Dispatch<SetStateAction<boolean>>;
  assignment: Assignment | null;
  savingAssignment: boolean;
  operator: OperatorIdentity | null;
  saveAssignment: (targetId?: string) => void;
  clearAssignment: () => void;
  transferId: string;
  setTransferId: Dispatch<SetStateAction<string>>;
  agents: SupportOverview["agents"];
  config: ApiConfig;
  profileDirtyRef: RefObject<boolean>;
  profileReload: number;
  operatorToken: string;
  onContactSaved: (data: { name: string; phone: string }) => void;
}) {
  return <aside className={`wa-details ${detailsOpen ? "profile-is-open" : "profile-is-closed"}`}>
    <header>
      <div><span className="section-kicker">INFORMAÇÕES</span><b>Perfil do contato</b></div>
      <button onClick={() => setDetailsOpen(false)} aria-label="Fechar perfil"><X size={20} /></button>
    </header>
    <section>
      <ContactAvatar chat={selected} className="wa-detail-avatar" />
      <b>{selected.name}</b>
      <small>{selected.phone || "Telefone não informado"}</small>
    </section>
    <section className="wa-assignment">
      <small>RESPONSÁVEL PELO ATENDIMENTO</small>
      <strong>{assignment?.assigneeName || "Nenhum atendente atribuído"}</strong>
      <p>{assignment ? "Responsável por este atendimento" : "Assuma para organizar o atendimento."}</p>
      <button className="wa-primary" disabled={savingAssignment || !operator} onClick={() => saveAssignment()}>
        {assignment ? "Assumir com minha conta" : "Assumir conversa"}
      </button>
      {(operator?.role === "admin" || operator?.canAssign) && <div className="transfer-controls">
        <label>Encaminhar para
          <select aria-label="Atendente de destino" value={transferId} onChange={event => setTransferId(event.target.value)}>
            <option value="">Selecione um atendente</option>
            {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}
          </select>
        </label>
        <button className="wa-primary" disabled={!transferId || savingAssignment} onClick={() => saveAssignment(transferId)}>
          Encaminhar atendimento
        </button>
      </div>}
      {assignment && <button className="wa-unassign" disabled={savingAssignment} onClick={clearAssignment}>Remover atribuição</button>}
    </section>
    <ContactProfile
      apiKey={config.apiKey}
      dirtyRef={profileDirtyRef}
      key={`${config.sessionId}:${selected.id}:${profileReload}`}
      baseUrl={config.baseUrl}
      token={operatorToken}
      sessionId={config.sessionId}
      chatId={selected.id}
      contactName={selected.name}
      contactPhone={selected.phone}
      onSaved={onContactSaved}
      canEdit={operator?.role === "admin" || operator?.canAssign === true}
    />
  </aside>;
}
