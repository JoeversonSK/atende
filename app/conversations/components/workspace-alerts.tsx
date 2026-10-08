"use client";

import { CircleAlert, X } from "lucide-react";

export type TeamAlert = { id: string; room: string; senderName: string; body: string; mentioned: boolean };
export type MessageAlert = { id: string; chatId: string; name: string; body: string };

export function WorkspaceAlerts({ teamAlerts, messageAlerts, notice, onOpenTeam, onDismissTeam, onOpenMessage, onDismissMessage, onDismissNotice }: {
  teamAlerts: TeamAlert[];
  messageAlerts: MessageAlert[];
  notice: string;
  onOpenTeam: (alert: TeamAlert) => void;
  onDismissTeam: (id: string) => void;
  onOpenMessage: (alert: MessageAlert) => void;
  onDismissMessage: (id: string) => void;
  onDismissNotice: () => void;
}) {
  return <>
    <div className="message-alerts" aria-live="polite">
      {teamAlerts.map(alert => <article key={alert.id}>
        <button className="message-alert-open" onClick={() => onOpenTeam(alert)}>
          <b>{alert.mentioned ? `${alert.senderName} mencionou você` : `Equipe · ${alert.senderName}`}</b>
          <span>{alert.body}</span>
        </button>
        <button aria-label="Dispensar notificação da equipe" onClick={() => onDismissTeam(alert.id)}><X size={16} /></button>
      </article>)}
      {messageAlerts.map(alert => <article key={alert.id}>
        <button className="message-alert-open" onClick={() => onOpenMessage(alert)}><b>{alert.name}</b><span>{alert.body}</span></button>
        <button aria-label="Dispensar notificação" onClick={() => onDismissMessage(alert.id)}><X size={16} /></button>
      </article>)}
    </div>
    {notice && <div className="workspace-feedback" role="status">
      <CircleAlert size={15} /><span>{notice}</span>
      <button aria-label="Dispensar aviso" onClick={onDismissNotice}><X size={15} /></button>
    </div>}
  </>;
}
