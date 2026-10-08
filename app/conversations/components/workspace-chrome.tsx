"use client";

import { Bell, CheckCheck, Inbox, MessageCircle, Settings, UserRound, UsersRound } from "lucide-react";
import { OperatorActivityControl, useOperatorActivity, type OperatorIdentity } from "../../operator-activity";
import type { Chat } from "../../conversation-model";
import type { Assignment } from "../ticket-actions";

export function WorkspaceTopbar({ operator, activity, notificationsEnabled, enableNotifications, onProfile }: {
  operator: OperatorIdentity;
  activity: ReturnType<typeof useOperatorActivity>;
  notificationsEnabled: boolean;
  enableNotifications: () => void;
  onProfile: () => void;
}) {
  return <header className="workspace-topbar">
    <div className="workspace-brand"><span><MessageCircle size={22} /></span>atende</div>
    <div className="workspace-account">
      <OperatorActivityControl operator={operator} activity={activity} controlRef={activity.controlRef} />
      <button className="notification-toggle" onClick={enableNotifications} title="Ativar som e notificações neste computador">
        <Bell size={18} /><span>{notificationsEnabled ? "Notificações ativas" : "Ativar notificações"}</span>
      </button>
      <button className="workspace-profile" onClick={onProfile} title="Meu perfil">
        <span className="preview-avatar" aria-hidden="true">{operator.displayName?.slice(0, 1).toUpperCase()}</span>
        <b>{operator.displayName}</b>
      </button>
    </div>
  </header>;
}

export type WorkspaceSection = "conversations" | "contacts" | "team" | "dashboard" | "settings";

export function WorkspaceRail({ section, teamUnread, onSelect }: {
  section: WorkspaceSection;
  teamUnread: number;
  onSelect: (section: WorkspaceSection) => void;
}) {
  return <nav className="workspace-rail" aria-label="Navegação principal">
    <button className={section === "conversations" ? "active" : ""} onClick={() => onSelect("conversations")} title="Todas as conversas">
      <Inbox size={22} /><span>Conversas</span>
    </button>
    <button className={section === "contacts" ? "active" : ""} onClick={() => onSelect("contacts")} title="Contatos">
      <UsersRound size={22} /><span>Contatos</span>
    </button>
    <button className={section === "team" ? "active" : ""} onClick={() => onSelect("team")} title="Chat interno da equipe">
      <MessageCircle size={22} /><span>Equipe</span>
      {teamUnread > 0 && <b className="team-rail-unread" aria-label={`${teamUnread} mensagens internas não lidas`}>{teamUnread > 99 ? "99+" : teamUnread}</b>}
    </button>
    <button className={section === "dashboard" ? "active" : ""} onClick={() => onSelect("dashboard")} title="Dashboard dos chamados">
      <UsersRound size={22} /><span>Painel</span>
    </button>
    <div className="rail-spacer" />
    <button onClick={() => onSelect("settings")} title="Configurações"><Settings size={22} /><span>Ajustes</span></button>
  </nav>;
}

export function WorkspaceWelcome({ chats, assignments, operatorId, onContacts }: {
  chats: Chat[];
  assignments: Record<string, Assignment>;
  operatorId: string;
  onContacts: () => void;
}) {
  return <div className="wa-welcome">
    <div className="welcome-symbol"><MessageCircle size={48} strokeWidth={1.5} /><span><CheckCheck size={20} /></span></div>
    <span className="section-kicker">BEM-VINDO AO SEU ESPAÇO</span>
    <h1>Cada conversa, mais próxima.</h1>
    <p>Escolha um contato ao lado para continuar o atendimento.<br />Sua equipe, suas conversas e os detalhes certos em um só lugar.</p>
    <div className="welcome-stats">
      <article><Inbox size={20} /><strong>{chats.length}</strong><span>Conversas</span></article>
      <article><Bell size={20} /><strong>{chats.filter(chat => chat.unread > 0).length}</strong><span>Não lidas</span></article>
      <article><UserRound size={20} /><strong>{chats.filter(chat => assignments[chat.id]?.assigneeId === operatorId).length}</strong><span>Com você</span></article>
    </div>
    <button onClick={onContacts}><UsersRound size={17} />Contatos</button>
    <small>Use os filtros para encontrar seus atendimentos.</small>
  </div>;
}
