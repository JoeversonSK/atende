"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { operatorJson } from "./atende-api";

export type OperatorIdentity = {
  id: string;
  username: string;
  displayName: string;
  role?: string;
  active?: boolean;
  canSend?: boolean;
  canAssign?: boolean;
  activityStatus?: "available" | "break" | "meeting" | "away" | "custom" | "onsite";
  activityNote?: string;
  activityUntil?: string | null;
};

type OnsiteVisit = {
  id: string;
  clientName: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds?: number | null;
};

type ActivityOptions = {
  baseUrl: string;
  token: string;
  onOperatorChange: (user: OperatorIdentity) => void;
  onRefresh: () => void;
};

export function useOperatorActivity({ baseUrl, token, onOperatorChange, onRefresh }: ActivityOptions) {
  const controlRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [onsiteClient, setOnsiteClient] = useState("");
  const [visitsState, setVisitsState] = useState<{ token: string; items: OnsiteVisit[] }>({ token: "", items: [] });
  const [visitsLoading, setVisitsLoading] = useState(false);
  const visits = visitsState.token === token ? visitsState.items : [];

  function toggleMenu() {
    if (!menuOpen) setVisitsLoading(true);
    setError("");
    setMenuOpen(value => !value);
  }

  useEffect(() => {
    if (!menuOpen || !token) return;
    const abort = new AbortController();
    operatorJson<OnsiteVisit[]>(baseUrl, token, "/me/onsite", { signal: abort.signal })
      .then(rows => { if (!abort.signal.aborted) setVisitsState({ token, items: rows }); })
      .catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "Não foi possível carregar os atendimentos externos."); })
      .finally(() => { if (!abort.signal.aborted) setVisitsLoading(false); });
    return () => abort.abort();
  }, [baseUrl, menuOpen, token]);

  async function setStatus(status: NonNullable<OperatorIdentity["activityStatus"]>, note = "") {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      const user = await operatorJson<OperatorIdentity>(baseUrl, token, "/me/activity", {
        method: "PUT", body: JSON.stringify({ status, note }),
      });
      onOperatorChange(user);
      setMenuOpen(false);
      setNoteDraft("");
      onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível alterar sua atividade.");
    } finally {
      setBusy(false);
    }
  }

  async function changeVisit(id?: string) {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      const visit = await operatorJson<OnsiteVisit>(baseUrl, token,
        `/me/onsite${id ? `/${encodeURIComponent(id)}/finish` : ""}`, {
          method: "POST", ...(!id ? { body: JSON.stringify({ clientName: onsiteClient.trim() }) } : {}),
        });
      setVisitsState(current => ({ token, items: id
        ? (current.token === token ? current.items : []).map(item => item.id === id ? visit : item)
        : [visit, ...(current.token === token ? current.items : [])] }));
      setOnsiteClient("");
      onRefresh();
      // O atendimento já foi registrado. Falha ao recarregar o perfil não deve
      // aparentar que a operação inteira falhou e provocar uma repetição.
      try {
        onOperatorChange(await operatorJson<OperatorIdentity>(baseUrl, token, "/me"));
      } catch {
        setError("Atendimento registrado, mas não foi possível atualizar sua atividade. Recarregue a página.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível registrar o atendimento externo.");
    } finally {
      setBusy(false);
    }
  }

  return { controlRef, menuOpen, setMenuOpen, toggleMenu, noteDraft, setNoteDraft, busy, error, setError,
    onsiteClient, setOnsiteClient, visits, visitsLoading, setStatus, changeVisit };
}

type ActivityControlProps = {
  operator: OperatorIdentity;
  activity: ReturnType<typeof useOperatorActivity>;
  controlRef: RefObject<HTMLDivElement | null>;
};

export function OperatorActivityControl({ operator, activity, controlRef }: ActivityControlProps) {
  const activeVisit = activity.visits.find(visit => !visit.endedAt);
  const label = operator.activityStatus === "break" ? "Pausa de 15 min"
    : operator.activityStatus === "meeting" ? "Em reunião"
    : operator.activityStatus === "away" ? "Ausente"
    : operator.activityStatus === "onsite" ? "Em cliente"
    : operator.activityStatus === "custom" ? operator.activityNote || "Outra atividade" : "Disponível";

  return <div className="activity-control" ref={controlRef}>
    <button type="button" className={`activity-toggle ${operator.activityStatus && operator.activityStatus !== "available" ? "away" : ""}`}
      aria-expanded={activity.menuOpen} onClick={activity.toggleMenu}>
      <span className="activity-dot" />{label}
    </button>
    {activity.menuOpen && <div className="activity-menu">
      <div className="activity-menu-header"><strong>O que você está fazendo?</strong><button type="button" onClick={() => activity.setMenuOpen(false)} aria-label="Fechar atividades"><X size={16}/></button></div>
      <p>Durante uma atividade, você não recebe novos atendimentos nem avisos de mensagens.</p>
      {operator.activityStatus !== "onsite" && <>
        <button type="button" disabled={activity.busy} onClick={() => void activity.setStatus("available")}>Disponível para atender</button>
        <button type="button" disabled={activity.busy} onClick={() => void activity.setStatus("break")}>Descanso · 15 minutos</button>
        <button type="button" disabled={activity.busy} onClick={() => void activity.setStatus("meeting")}>Em reunião</button>
        <button type="button" disabled={activity.busy} onClick={() => void activity.setStatus("away")}>Fora da estação</button>
        <form onSubmit={event => { event.preventDefault(); void activity.setStatus("custom", activity.noteDraft); }}>
          <label htmlFor="activity-note">Outra atividade</label>
          <div><input id="activity-note" maxLength={120} required value={activity.noteDraft} onChange={event => activity.setNoteDraft(event.target.value)} placeholder="Ex.: treinamento"/><button type="submit" disabled={activity.busy}>Informar</button></div>
        </form>
      </>}
      <div className="activity-onsite">
        <strong>Atendimento em cliente</strong>
        {activity.visitsLoading ? <p>Carregando atendimentos...</p> : activeVisit ? <>
          <p><b>{activeVisit.clientName}</b><br/>Início: {new Date(activeVisit.startedAt).toLocaleString("pt-BR")}</p>
          <button type="button" disabled={activity.busy} onClick={() => void activity.changeVisit(activeVisit.id)}>Finalizar atendimento externo</button>
        </> : operator.activityStatus === "onsite" ? <p>Não foi possível identificar o atendimento em andamento. Atualize a página.</p> : <form onSubmit={event => { event.preventDefault(); void activity.changeVisit(); }}>
          <label htmlFor="onsite-client">Cliente atendido</label>
          <div><input id="onsite-client" maxLength={160} required value={activity.onsiteClient} onChange={event => activity.setOnsiteClient(event.target.value)} placeholder="Nome do cliente"/><button type="submit" disabled={activity.busy}>Iniciar</button></div>
        </form>}
      </div>
      {activity.error && <small role="alert">{activity.error}</small>}
    </div>}
  </div>;
}
