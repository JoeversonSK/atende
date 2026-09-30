"use client";
import {useEffect,useRef,useState} from "react";
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
 const profiles=new Map(overview.contacts.map(c=>[c.chatId,c.data]));
 const activity=new Map(overview.activity.map(c=>[c.chatId,c]));
 const rows=chats.filter(c=>!/@(g\.us|broadcast|newsletter)$/.test(c.id)).map(c=>{
   const profile=profiles.get(c.id),a=activity.get(c.id),owner=owners[c.id]||(a?.assigneeId&&a.assigneeName?{assigneeId:a.assigneeId,assigneeName:a.assigneeName,updatedAt:a.assignedAt||undefined}:undefined);
   return {...c,name:profile?.name||c.name,owner,closed:profile?.status==="closed",type:profile?.serviceType||"remote",priority:profile?.priority||"normal",seconds:elapsed(Date.parse(owner?.updatedAt||""),now),queueSeconds:elapsed(Number(a?.queueSince)*1000,now),customerSeconds:Number(a?.outgoing)>Number(a?.incoming)?elapsed(Number(a?.outgoing)*1000,now):null};
 });
 const visibleAgentIds=new Set(overview.agents.map(agent=>agent.id));
 const active=rows.filter(r=>!r.closed&&r.owner&&r.owner.assigneeId&&visibleAgentIds.has(r.owner.assigneeId));
 const queue=rows.filter(r=>!r.closed&&!r.owner&&r.queueSeconds!==null).sort((a,b)=>(b.queueSeconds??-1)-(a.queueSeconds??-1));
 const completed=(overview.completed||[]).filter(item=>item.assigneeId&&visibleAgentIds.has(item.assigneeId));
 const analysts=new Map(overview.agents.map(a=>[a.id,{id:a.id,name:a.displayName,active:0,count:0,seconds:0}]));
 for(const r of active){const id=r.owner.assigneeId||"";if(analysts.has(id))analysts.get(id)!.active++;}
 for(const c of completed){const id=c.assigneeId||"";if(analysts.has(id)){const a=analysts.get(id)!;a.count+=c.count;a.seconds+=Number(c.totalSeconds);}}
 const analystRows=[...analysts.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
 const firstName=(name:string)=>name.trim().split(/[\s-]+/)[0]||name;
 const matches=(name:string)=>name.toLocaleLowerCase().includes(search.toLocaleLowerCase());
 const time=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(now)).split(":");
 const date=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(now));
 return <section ref={boardRef} className="ticket-dashboard operations-board" aria-label="Dashboard dos chamados">
  <div className="board-view-controls"><button type="button" onClick={()=>void toggleFullscreen()} aria-label={fullscreen?"Sair da tela cheia":"Exibir dashboard em tela cheia"} title={fullscreen?"Sair da tela cheia (Esc)":"Exibir dashboard em tela cheia"}>{fullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}<span>{fullscreen?"Sair da tela cheia":"Tela cheia"}</span></button></div>
  {fullscreenError&&<p className="board-fullscreen-error" role="alert">{fullscreenError}</p>}
  {warning&&<p className="sync-warning" role="status">{warning}</p>}
  <div className="board-grid">
   <div className="board-column board-left-column">
   <section className="board-panel analyst-panel" aria-labelledby="analyst-heading"><h2 id="analyst-heading">Atendimentos realizados</h2><div className="board-table-scroll"><table><thead><tr><th>Analista</th><th>Ativos</th><th>Concluídos</th><th title="Tempo dos atendimentos concluídos hoje com o responsável final">Tempo total</th></tr></thead><tbody>{analystRows.filter(a=>matches(a.name)).map(a=><tr key={a.id}><td><strong title={a.name}>{firstName(a.name)}</strong></td><td className={a.active?"board-cyan":"board-muted"}>{a.active}</td><td>{a.count}</td><td className="board-numeric"><strong>{clockDuration(a.seconds)}</strong></td></tr>)}</tbody></table>{!analysts.size&&<p className="board-empty">Nenhum atendente selecionado para o dashboard.</p>}</div></section>
   <section className="board-panel active-panel" aria-labelledby="active-heading"><h2 id="active-heading">Em atendimento</h2><div className="board-table-scroll"><table><thead><tr><th>Analista</th><th>Cliente</th><th>Tempo</th><th>Tipo</th><th>Prioridade</th></tr></thead><tbody>{active.filter(r=>matches(`${r.name} ${r.owner.assigneeName}`)).map(r=><tr key={r.id}><td><strong>{r.owner.assigneeName}</strong></td><td><button className="board-contact" title="Abrir conversa e encaminhar atendimento" onClick={()=>onOpen(r.id)}>{r.name}</button>{r.customerSeconds!==null&&<small className="board-customer-wait">Aguardando resposta: {clockDuration(r.customerSeconds)}</small>}</td><td><span className="board-timer">{clockDuration(r.seconds)}</span></td><td>{r.type==="onsite"?"Presencial":"Remoto"}</td><td><span className={`board-priority ${r.priority}`}>{r.priority==="high"?"Alta":r.priority==="low"?"Baixa":"Normal"} prioridade</span></td></tr>)}</tbody></table>{!active.some(r=>matches(`${r.name} ${r.owner.assigneeName}`))&&<p className="board-empty">{search?"Nenhum atendimento encontrado.":"Nenhum atendimento em andamento."}</p>}</div></section>
   </div>
   <div className="board-column board-right-column">
   <div className="board-cards">
    <section className="board-stat queue-stat"><h2>Fila de espera</h2><div className="board-stat-pair"><div><b>{queue.length}</b><span>Na fila</span></div><div title="Sem responsável e com pelo menos 15 minutos desde a primeira mensagem recebida sem resposta"><b>{queue.filter(r=>(r.queueSeconds??0)>=900).length}</b><span>Em alerta</span></div></div></section>
    <section className="board-stat active-stat"><h2>Em atendimento</h2><div className="board-stat-pair"><div><b>{active.filter(r=>r.type==="remote").length}</b><span>Remotos</span></div><div><b>{active.filter(r=>r.type==="onsite").length}</b><span>Presencial</span></div></div></section>
    <section className="board-stat done-stat"><div><h2>Concluídos</h2><b>{completed.reduce((sum,c)=>sum+c.count,0)}</b><span>Total hoje</span></div><time className="board-clock" aria-label={`Horário de Brasília ${time.join(":")}`}><strong>{time[0]}</strong><strong>{time[1]}</strong></time></section>
   </div>
   <section className="board-panel queue-panel" aria-labelledby="queue-heading"><h2 id="queue-heading">Fila de espera</h2><div className="board-table-scroll"><table><thead><tr><th>Cliente</th><th>Tempo de espera</th><th>Status</th></tr></thead><tbody>{queue.filter(r=>matches(r.name)).map(r=><tr key={r.id}><td><button className="board-contact" title="Abrir conversa e atribuir atendente" onClick={()=>onOpen(r.id)}>{r.name}</button></td><td className="board-numeric">{clockDuration(r.queueSeconds)}</td><td><span className={`board-queue-state ${(r.queueSeconds??0)>=900?"alert":""}`}>{(r.queueSeconds??0)>=900?"Em alerta":"Aguardando"}</span></td></tr>)}</tbody></table>{!queue.some(r=>matches(r.name))&&<p className="board-empty">{search?"Nenhum cliente encontrado.":"Nenhum cliente na fila!"}</p>}</div></section>
   </div>
  </div>
 </section>;
}
