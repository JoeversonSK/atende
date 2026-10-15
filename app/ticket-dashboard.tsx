"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {Maximize2,Minimize2} from "lucide-react";
import {operatorJson} from "./atende-api";
import {clockDuration,elapsed,serverAlignedNow,type SupportOverview} from "./dashboard-model";
export {emptyOverview,type SupportOverview} from "./dashboard-model";

type Owner={assigneeId?:string;assigneeName:string;state?:'active'|'forwarded';updatedAt?:string};
type ActivitySource={baseUrl:string;token:string;sessionId:string};
type LiveActivity={agents:SupportOverview["agents"];onsiteActive:NonNullable<SupportOverview["onsiteActive"]>;serverNow:string;receivedAt:number;sourceKey:string};
type Props={chats:{id:string;name:string}[];owners:Record<string,Owner>;overview:SupportOverview;onOpen:(id:string)=>void;warning?:string;activitySource?:ActivitySource};
export function TicketDashboard({chats,owners,overview,onOpen,warning,activitySource}:Props){
 const [now,setNow]=useState(() => Date.now());
 const [monotonicNow,setMonotonicNow]=useState(()=>typeof performance!=="undefined"?performance.now():0);
 const boardRef=useRef<HTMLElement>(null);
 const [fullscreen,setFullscreen]=useState(false);
 const [fullscreenError,setFullscreenError]=useState("");
 const [liveActivity,setLiveActivity]=useState<LiveActivity|null>(null);
 const [activityFailedSource,setActivityFailedSource]=useState("");
 const activityBaseUrl=activitySource?.baseUrl||"";
 const activityToken=activitySource?.token||"";
 const activitySessionId=activitySource?.sessionId||"";
 const sourceKey=`${activityBaseUrl}|${activitySessionId}|${activityToken}`;
 const currentActivity=liveActivity?.sourceKey===sourceKey?liveActivity:null;
 const alignedNow=currentActivity?serverAlignedNow(currentActivity.serverNow,currentActivity.receivedAt,monotonicNow):NaN;
 const activityNow=Number.isFinite(alignedNow)?alignedNow:now;
 useEffect(()=>{const timer=setInterval(()=>{setNow(Date.now());setMonotonicNow(performance.now());},1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  if(!activityToken||!activitySessionId)return;
  const abort=new AbortController();
  let inFlight=false;
  const refresh=async()=>{
   if(inFlight||document.visibilityState==="hidden")return;
   inFlight=true;
   try{
    const snapshot=await operatorJson<Omit<LiveActivity,"receivedAt"|"sourceKey">>(activityBaseUrl,activityToken,
     `/contacts/${encodeURIComponent(activitySessionId)}/activity`,{signal:abort.signal});
    if(!abort.signal.aborted){
     setLiveActivity({...snapshot,receivedAt:performance.now(),sourceKey});
     setMonotonicNow(performance.now());
     setActivityFailedSource("");
    }
   }catch{if(!abort.signal.aborted)setActivityFailedSource(sourceKey);}
   finally{inFlight=false;}
  };
  void refresh();
  const timer=window.setInterval(()=>void refresh(),4000);
  const onVisible=()=>{if(document.visibilityState==="visible")void refresh();};
  document.addEventListener("visibilitychange",onVisible);
  return()=>{abort.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",onVisible);};
 },[activityBaseUrl,activityToken,activitySessionId,sourceKey]);
 useEffect(()=>{
  const sync=()=>setFullscreen(document.fullscreenElement===boardRef.current);
  document.addEventListener("fullscreenchange",sync);
  return()=>document.removeEventListener("fullscreenchange",sync);
 },[]);
 async function toggleFullscreen(){
  setFullscreenError("");
  try {
   if(document.fullscreenElement===boardRef.current) await document.exitFullscreen();
   else await boardRef.current?.requestFullscreen();
  } catch { setFullscreenError("Não foi possível ativar a tela cheia neste navegador."); }
 }
 const board=useMemo(()=>{
  const profiles=new Map(overview.contacts.map(c=>[c.chatId,c.data]));
  const activity=new Map(overview.activity.map(c=>[c.chatId,c]));
  const rows=chats.filter(c=>!/@(g\.us|broadcast|newsletter)$/.test(c.id)).map(c=>{
    const profile=profiles.get(c.id),a=activity.get(c.id),owner=owners[c.id]||(a?.assigneeId&&a.assigneeName?{assigneeId:a.assigneeId,assigneeName:a.assigneeName,state:a.assignmentState||'active',updatedAt:a.assignedAt||undefined}:undefined);
    const forwarded=owner?.state==='forwarded';
    return {...c,name:profile?.name||c.name,owner,forwarded,closed:profile?.status==="closed",type:profile?.serviceType||"remote",priority:profile?.priority||"normal",assignedAt:Date.parse(owner?.updatedAt||""),queueAt:Number(a?.queueSince)*1000|| (forwarded ? Date.parse(owner?.updatedAt||"") : 0),customerAt:Number(a?.outgoing)>Number(a?.incoming)?Number(a?.outgoing)*1000:NaN};
  });
  const agents=currentActivity?.agents||overview.agents;
  const visibleAgentIds=new Set(agents.map(agent=>agent.id));
  const active=rows.filter(r=>!r.closed&&!r.forwarded&&r.owner&&r.owner.assigneeId&&visibleAgentIds.has(r.owner.assigneeId));
  const onsiteActive=(currentActivity?.onsiteActive||overview.onsiteActive||[]).filter(v=>visibleAgentIds.has(v.assigneeId));
  const queue=rows.filter(r=>!r.closed&&(!r.owner||r.forwarded)&&r.queueAt>0&&Number.isFinite(r.queueAt)).sort((a,b)=>a.queueAt-b.queueAt);
  const completed=(overview.completed||[]).filter(item=>item.assigneeId&&visibleAgentIds.has(item.assigneeId));
  const analysts=new Map(agents.map(a=>[a.id,{id:a.id,name:a.displayName,status:a.activityStatus||"available",note:a.activityNote||"",until:a.activityUntil||null,active:0,count:0,seconds:0}]));
  for(const r of active){const id=r.owner.assigneeId||"";if(analysts.has(id))analysts.get(id)!.active++;}
  for(const visit of onsiteActive){if(analysts.has(visit.assigneeId))analysts.get(visit.assigneeId)!.active++;}
  for(const c of completed){const id=c.assigneeId||"";if(analysts.has(id)){const a=analysts.get(id)!;a.count+=c.count;a.seconds+=Number(c.totalSeconds);}}
  return {active,onsiteActive,queue,completed,analysts,analystRows:[...analysts.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name))};
 },[chats,owners,overview,currentActivity]);
 const {active,onsiteActive,queue,completed,analysts,analystRows}=board;
 const queueAlertCount=queue.filter(r=>(elapsed(r.queueAt,now)??0)>=900).length;
 const firstName=(name:string)=>name.trim().split(/[\s-]+/)[0]||name;
 const time=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(now)).split(":");
 const displayActivityStatus=(a:{status:string;until:string|null})=>a.status==="break"&&a.until&&Date.parse(a.until)<=activityNow?"available":a.status;
 const activityLabel=(a:{status:string;note:string;until:string|null})=>displayActivityStatus(a)==="break"?(a.until&&Number.isFinite(Date.parse(a.until))?`Pausa · ${clockDuration(Math.max(0,Math.ceil((Date.parse(a.until)-activityNow)/1000)))}`:"Pausa"):a.status==="meeting"?"Em reunião":a.status==="away"?"Ausente":a.status==="onsite"?`Em cliente · ${a.note}`:a.status==="custom"?a.note:"Disponível";
 return <section ref={boardRef} className="ticket-dashboard operations-board" aria-label="Dashboard dos chamados">
  <div className="board-view-controls"><button type="button" onClick={()=>void toggleFullscreen()} aria-label={fullscreen?"Sair da tela cheia":"Exibir dashboard em tela cheia"} title={fullscreen?"Sair da tela cheia (Esc)":"Exibir dashboard em tela cheia"}>{fullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}<span>{fullscreen?"Sair da tela cheia":"Tela cheia"}</span></button></div>
  {fullscreenError&&<p className="board-fullscreen-error" role="alert">{fullscreenError}</p>}
  {warning&&<p className="sync-warning" role="status">{warning}</p>}
  {activityFailedSource===sourceKey&&activityToken&&<p className="sync-warning" role="status">Não foi possível atualizar a atividade da equipe. Tentando novamente.</p>}
  <div className="board-grid">
   <div className="board-column board-left-column">
   <section className="board-panel analyst-panel" aria-labelledby="analyst-heading"><h2 id="analyst-heading">Atendimentos realizados</h2><div className="board-table-scroll"><table><thead><tr><th>Analista</th><th>Atividade</th><th>Ativos</th><th>Concluídos</th><th title="Tempo dos atendimentos concluídos hoje com o responsável final">Tempo total</th></tr></thead><tbody>{analystRows.map(a=><tr key={a.id}><td><strong title={a.name}>{firstName(a.name)}</strong></td><td><span className={`board-activity ${displayActivityStatus(a)==="available"?"available":"unavailable"}`} title={a.note||activityLabel(a)}><span className="board-activity-text">{activityLabel(a)}</span></span></td><td className={a.active?"board-cyan":"board-muted"}>{a.active}</td><td>{a.count}</td><td className="board-numeric"><strong>{clockDuration(a.seconds)}</strong></td></tr>)}</tbody></table>{!analysts.size&&<p className="board-empty">Nenhum atendente selecionado para o dashboard.</p>}</div></section>
   <section className="board-panel active-panel" aria-labelledby="active-heading"><h2 id="active-heading">Em atendimento</h2><div className="board-table-scroll"><table><thead><tr><th>Analista</th><th>Cliente</th><th>Tempo</th><th>Tipo</th><th>Prioridade</th></tr></thead><tbody>{active.map(r=><tr key={r.id}><td><strong title={r.owner.assigneeName}>{firstName(r.owner.assigneeName)}</strong></td><td><button className="board-contact" title={`Abrir conversa com ${r.name} e encaminhar atendimento`} onClick={()=>onOpen(r.id)}>{r.name}</button>{Number.isFinite(r.customerAt)&&<small className="board-customer-wait">Aguardando resposta: {clockDuration(elapsed(r.customerAt,now))}</small>}</td><td><span className="board-timer">{clockDuration(elapsed(r.assignedAt,now))}</span></td><td>{r.type==="onsite"?"Presencial":"Remoto"}</td><td><span className={`board-priority ${r.priority}`} title={`Prioridade ${r.priority==="high"?"alta":r.priority==="low"?"baixa":"normal"}`}>{r.priority==="high"?"Alta":r.priority==="low"?"Baixa":"Normal"}</span></td></tr>)}{onsiteActive.map(v=><tr key={`onsite-${v.id}`}><td><strong title={v.assigneeName}>{firstName(v.assigneeName)}</strong></td><td title={v.clientName}>{v.clientName}</td><td><span className="board-timer">{clockDuration(elapsed(Date.parse(v.startedAt),now))}</span></td><td>Presencial externo</td><td>—</td></tr>)}</tbody></table>{!active.length&&!onsiteActive.length&&<p className="board-empty">Nenhum atendimento em andamento.</p>}</div></section>
   </div>
   <div className="board-column board-right-column">
   <div className="board-cards">
    <section className="board-stat queue-stat"><h2>Fila de espera</h2><div className="board-stat-pair"><div><b>{queue.length}</b><span>Na fila</span></div><div title="Sem responsável e com pelo menos 15 minutos desde a primeira mensagem recebida sem resposta"><b>{queueAlertCount}</b><span>Em alerta</span></div></div></section>
    <section className="board-stat active-stat"><h2>Em atendimento</h2><div className="board-stat-pair"><div><b>{active.filter(r=>r.type==="remote").length}</b><span>Remotos</span></div><div><b>{active.filter(r=>r.type==="onsite").length+onsiteActive.length}</b><span>Presencial</span></div></div></section>
    <section className="board-stat done-stat"><div><h2>Concluídos</h2><b>{completed.reduce((sum,c)=>sum+c.count,0)}</b><span>Total hoje</span></div><time className="board-clock" aria-label={`Horário de Brasília ${time.join(":")}`}><strong>{time[0]}</strong><strong>{time[1]}</strong></time></section>
   </div>
   <section className="board-panel queue-panel" aria-labelledby="queue-heading"><h2 id="queue-heading">Fila de espera</h2><div className="board-table-scroll"><table><thead><tr><th>Cliente</th><th>Tempo de espera</th><th>Status</th></tr></thead><tbody>{queue.map(r=>{const waiting=elapsed(r.queueAt,now)??0;const forwardedName=r.owner?.assigneeName?.trim()||"Atendente";return <tr key={r.id}><td><button className="board-contact" title={`Abrir conversa com ${r.name} e atribuir atendente`} onClick={()=>onOpen(r.id)}>{r.name}</button></td><td className="board-numeric">{clockDuration(waiting)}</td><td>{r.forwarded?<span className="board-forwarded-inline" title={`Encaminhado para ${forwardedName}`}><span className="board-queue-state forwarded">Encaminhado</span><span className="board-forwarded-to">para</span><strong className="board-forwarded-name">{firstName(forwardedName)}</strong></span>:<span className={`board-queue-state ${waiting>=900?"alert":""}`}>{waiting>=900?"Em alerta":"Aguardando"}</span>}</td></tr>})}</tbody></table>{!queue.length&&<p className="board-empty">Nenhum cliente na fila!</p>}</div></section>
   </div>
  </div>
 </section>;
}
