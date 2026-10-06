"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {Maximize2,Minimize2} from "lucide-react";
import {clockDuration,elapsed,type SupportOverview} from "./dashboard-model";
export {emptyOverview,type SupportOverview} from "./dashboard-model";

type Owner={assigneeId?:string;assigneeName:string;updatedAt?:string};
type Props={chats:{id:string;name:string}[];owners:Record<string,Owner>;overview:SupportOverview;onOpen:(id:string)=>void;onClose:()=>void;warning?:string};
export function TicketDashboard({chats,owners,overview,onOpen,onClose,warning}:Props){
 const [now,setNow]=useState(Date.now()),[search,setSearch]=useState("");
 const boardRef=useRef<HTMLElement>(null);
 const [fullscreen,setFullscreen]=useState(false);
 const [fullscreenError,setFullscreenError]=useState("");
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
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
    const profile=profiles.get(c.id),a=activity.get(c.id),owner=owners[c.id]||(a?.assigneeId&&a.assigneeName?{assigneeId:a.assigneeId,assigneeName:a.assigneeName,updatedAt:a.assignedAt||undefined}:undefined);
    return {...c,name:profile?.name||c.name,owner,closed:profile?.status==="closed",type:profile?.serviceType||"remote",priority:profile?.priority||"normal",assignedAt:Date.parse(owner?.updatedAt||""),queueAt:Number(a?.queueSince)*1000,customerAt:Number(a?.outgoing)>Number(a?.incoming)?Number(a?.outgoing)*1000:NaN};
  });
  const visibleAgentIds=new Set(overview.agents.map(agent=>agent.id));
  const active=rows.filter(r=>!r.closed&&r.owner&&r.owner.assigneeId&&visibleAgentIds.has(r.owner.assigneeId));
  const onsiteActive=(overview.onsiteActive||[]).filter(v=>visibleAgentIds.has(v.assigneeId));
  const queue=rows.filter(r=>!r.closed&&!r.owner&&r.queueAt>0&&Number.isFinite(r.queueAt)).sort((a,b)=>a.queueAt-b.queueAt);
  const completed=(overview.completed||[]).filter(item=>item.assigneeId&&visibleAgentIds.has(item.assigneeId));
  const analysts=new Map(overview.agents.map(a=>[a.id,{id:a.id,name:a.displayName,status:a.activityStatus||"available",note:a.activityNote||"",until:a.activityUntil||null,active:0,count:0,seconds:0}]));
  for(const r of active){const id=r.owner.assigneeId||"";if(analysts.has(id))analysts.get(id)!.active++;}
  for(const visit of onsiteActive){if(analysts.has(visit.assigneeId))analysts.get(visit.assigneeId)!.active++;}
  for(const c of completed){const id=c.assigneeId||"";if(analysts.has(id)){const a=analysts.get(id)!;a.count+=c.count;a.seconds+=Number(c.totalSeconds);}}
  return {active,onsiteActive,queue,completed,analysts,analystRows:[...analysts.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name))};
 },[chats,owners,overview]);
 const {active,onsiteActive,queue,completed,analysts,analystRows}=board;
 const queueAlertCount=queue.filter(r=>(elapsed(r.queueAt,now)??0)>=900).length;
 const firstName=(name:string)=>name.trim().split(/[\s-]+/)[0]||name;
 const matches=(name:string)=>name.toLocaleLowerCase().includes(search.toLocaleLowerCase());
 const time=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(now)).split(":");
 const date=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(now));
 const activityLabel=(a:{status:string;note:string;until:string|null})=>a.status==="break"?`Pausa · ${clockDuration(Math.max(0,Math.ceil((Date.parse(a.until||"")-now)/1000)))}`:a.status==="meeting"?"Em reunião":a.status==="away"?"Ausente":a.status==="onsite"?`Em cliente · ${a.note}`:a.status==="custom"?a.note:"Disponível";
 return <section ref={boardRef} className="ticket-dashboard operations-board" aria-label="Dashboard dos chamados">
  <div className="board-view-controls"><button type="button" onClick={()=>void toggleFullscreen()} aria-label={fullscreen?"Sair da tela cheia":"Exibir dashboard em tela cheia"} title={fullscreen?"Sair da tela cheia (Esc)":"Exibir dashboard em tela cheia"}>{fullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}<span>{fullscreen?"Sair da tela cheia":"Tela cheia"}</span></button></div>
  {fullscreenError&&<p className="board-fullscreen-error" role="alert">{fullscreenError}</p>}
  {warning&&<p className="sync-warning" role="status">{warning}</p>}
  <div className="board-grid">
   <div className="board-column board-left-column">
   <section className="board-panel analyst-panel" aria-labelledby="analyst-heading"><h2 id="analyst-heading">Atendimentos realizados</h2><div className="board-table-scroll"><table><thead><tr><th>Analista</th><th>Atividade</th><th>Ativos</th><th>Concluídos</th><th title="Tempo dos atendimentos concluídos hoje com o responsável final">Tempo total</th></tr></thead><tbody>{analystRows.filter(a=>matches(`${a.name} ${activityLabel(a)}`)).map(a=><tr key={a.id}><td><strong title={a.name}>{firstName(a.name)}</strong></td><td><span className={`board-activity ${a.status==="available"?"available":"unavailable"}`} title={a.note||activityLabel(a)}>{activityLabel(a)}</span></td><td className={a.active?"board-cyan":"board-muted"}>{a.active}</td><td>{a.count}</td><td className="board-numeric"><strong>{clockDuration(a.seconds)}</strong></td></tr>)}</tbody></table>{!analysts.size&&<p className="board-empty">Nenhum atendente selecionado para o dashboard.</p>}</div></section>
   <section className="board-panel active-panel" aria-labelledby="active-heading"><h2 id="active-heading">Em atendimento</h2><div className="board-table-scroll"><table><thead><tr><th>Analista</th><th>Cliente</th><th>Tempo</th><th>Tipo</th><th>Prioridade</th></tr></thead><tbody>{active.filter(r=>matches(`${r.name} ${r.owner.assigneeName}`)).map(r=><tr key={r.id}><td><strong>{r.owner.assigneeName}</strong></td><td><button className="board-contact" title="Abrir conversa e encaminhar atendimento" onClick={()=>onOpen(r.id)}>{r.name}</button>{Number.isFinite(r.customerAt)&&<small className="board-customer-wait">Aguardando resposta: {clockDuration(elapsed(r.customerAt,now))}</small>}</td><td><span className="board-timer">{clockDuration(elapsed(r.assignedAt,now))}</span></td><td>{r.type==="onsite"?"Presencial":"Remoto"}</td><td><span className={`board-priority ${r.priority}`}>{r.priority==="high"?"Alta":r.priority==="low"?"Baixa":"Normal"} prioridade</span></td></tr>)}{onsiteActive.filter(v=>matches(`${v.clientName} ${v.assigneeName}`)).map(v=><tr key={`onsite-${v.id}`}><td><strong>{v.assigneeName}</strong></td><td>{v.clientName}</td><td><span className="board-timer">{clockDuration(elapsed(Date.parse(v.startedAt),now))}</span></td><td>Presencial externo</td><td>—</td></tr>)}</tbody></table>{![...active.map(r=>`${r.name} ${r.owner.assigneeName}`),...onsiteActive.map(v=>`${v.clientName} ${v.assigneeName}`)].some(matches)&&<p className="board-empty">{search?"Nenhum atendimento encontrado.":"Nenhum atendimento em andamento."}</p>}</div></section>
   </div>
   <div className="board-column board-right-column">
   <div className="board-cards">
    <section className="board-stat queue-stat"><h2>Fila de espera</h2><div className="board-stat-pair"><div><b>{queue.length}</b><span>Na fila</span></div><div title="Sem responsável e com pelo menos 15 minutos desde a primeira mensagem recebida sem resposta"><b>{queueAlertCount}</b><span>Em alerta</span></div></div></section>
    <section className="board-stat active-stat"><h2>Em atendimento</h2><div className="board-stat-pair"><div><b>{active.filter(r=>r.type==="remote").length}</b><span>Remotos</span></div><div><b>{active.filter(r=>r.type==="onsite").length+onsiteActive.length}</b><span>Presencial</span></div></div></section>
    <section className="board-stat done-stat"><div><h2>Concluídos</h2><b>{completed.reduce((sum,c)=>sum+c.count,0)}</b><span>Total hoje</span></div><time className="board-clock" aria-label={`Horário de Brasília ${time.join(":")}`}><strong>{time[0]}</strong><strong>{time[1]}</strong></time></section>
   </div>
   <section className="board-panel queue-panel" aria-labelledby="queue-heading"><h2 id="queue-heading">Fila de espera</h2><div className="board-table-scroll"><table><thead><tr><th>Cliente</th><th>Tempo de espera</th><th>Status</th></tr></thead><tbody>{queue.filter(r=>matches(r.name)).map(r=>{const waiting=elapsed(r.queueAt,now)??0;return <tr key={r.id}><td><button className="board-contact" title="Abrir conversa e atribuir atendente" onClick={()=>onOpen(r.id)}>{r.name}</button></td><td className="board-numeric">{clockDuration(waiting)}</td><td><span className={`board-queue-state ${waiting>=900?"alert":""}`}>{waiting>=900?"Em alerta":"Aguardando"}</span></td></tr>})}</tbody></table>{!queue.some(r=>matches(r.name))&&<p className="board-empty">{search?"Nenhum cliente encontrado.":"Nenhum cliente na fila!"}</p>}</div></section>
   </div>
  </div>
 </section>;
}
