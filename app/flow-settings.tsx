"use client";

import { useEffect, useState } from "react";
import {
  ArrowDown, ArrowUp, AudioLines, CheckCircle2, CircleAlert, Clock3, FileText, GitBranch,
  GripVertical, Image as ImageIcon, ListChecks, MessageSquareText, Pencil, Plus, Save,
  Trash2, UserCheck, Video, X,
} from "lucide-react";

export type ConversationFlowKind="regular"|"start"|"evaluation";
export type ConversationFlowStep={
  id:string;
  type:"message"|"image"|"video"|"audio"|"document"|"poll"|"delay"|"action";
  text?:string;
  delaySeconds?:number;
  data?:string;
  mimetype?:string;
  filename?:string;
  caption?:string;
  question?:string;
  options?:string[];
  allowMultipleAnswers?:boolean;
  action?:"assign-current"|"close-ticket";
};
export type ConversationFlow={id:string;name:string;description:string;active:boolean;kind:ConversationFlowKind;steps:ConversationFlowStep[];pollOptions:string[]};

const defaultPollOptions=["1 - Muito ruim","2 - Ruim","3 - Regular","4 - Bom","5 - Excelente"];
const uid=()=>globalThis.crypto?.randomUUID?.()||`bloco-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const messageBlock=():ConversationFlowStep=>({id:uid(),type:"message",text:"",delaySeconds:0});
const blankFlow=():ConversationFlow=>({id:"",name:"Novo fluxo",description:"",active:true,kind:"regular",steps:[messageBlock()],pollOptions:[]});
const normalizeFlow=(flow:ConversationFlow):ConversationFlow=>({...flow,steps:(flow.steps||[]).map(step=>({...step,id:step.id||uid(),type:step.type||"message",delaySeconds:Number(step.delaySeconds)||0,options:step.options||[]}))});
const labels:Record<ConversationFlowStep["type"],string>={message:"Mensagem",image:"Imagem",video:"Vídeo",audio:"Áudio",document:"Documento",poll:"Lista de opções",delay:"Espera",action:"Ação"};
const icons={message:MessageSquareText,image:ImageIcon,video:Video,audio:AudioLines,document:FileText,poll:ListChecks,delay:Clock3,action:UserCheck};

function validateFlow(flow:ConversationFlow):string{
  if(!flow.name.trim())return "Informe um nome para o fluxo.";
  if(flow.kind==="evaluation")return "";
  if(!flow.steps.length)return "Adicione pelo menos um bloco ao fluxo.";
  for(let index=0;index<flow.steps.length;index+=1){
    const step=flow.steps[index],position=index+1;
    if(step.type==="message"&&!step.text?.trim())return `Escreva a mensagem do bloco ${position}.`;
    if(["image","video","audio","document"].includes(step.type)&&!step.data)return `Selecione o arquivo do bloco ${position}.`;
    if(step.type==="poll"){
      if(!step.question?.trim())return `Escreva a pergunta da lista no bloco ${position}.`;
      const options=(step.options||[]).map(option=>option.trim()).filter(Boolean);
      if(options.length<2)return `Adicione pelo menos duas alternativas à lista do bloco ${position}.`;
      if(new Set(options.map(option=>option.toLocaleLowerCase("pt-BR"))).size!==options.length)return `As alternativas da lista do bloco ${position} não podem ser repetidas.`;
    }
    if(step.type==="delay"&&(!Number.isFinite(step.delaySeconds)||Number(step.delaySeconds)<1||Number(step.delaySeconds)>3600))return `A espera do bloco ${position} deve ficar entre 1 e 3600 segundos.`;
  }
  return "";
}

function newBlock(type:ConversationFlowStep["type"]):ConversationFlowStep{
  if(type==="message")return messageBlock();
  if(type==="poll")return {id:uid(),type,question:"Como você avalia?",options:["Opção 1","Opção 2"],allowMultipleAnswers:false,delaySeconds:0};
  if(type==="delay")return {id:uid(),type,delaySeconds:5};
  if(type==="action")return {id:uid(),type,action:"assign-current"};
  return {id:uid(),type,data:"",mimetype:"",filename:"",caption:"",delaySeconds:0};
}

export function FlowSettings({baseUrl,token}:{baseUrl:string;token:string}){
  const [flows,setFlows]=useState<ConversationFlow[]>([]),[selected,setSelected]=useState(0),[loading,setLoading]=useState(true),[saving,setSaving]=useState(""),[feedback,setFeedback]=useState(""),[dragged,setDragged]=useState<number|null>(null);
  const endpoint=`${baseUrl.replace(/\/$/,"")}/api/operator-auth`;
  const api=async(path:string,init?:RequestInit)=>{const response=await fetch(`${endpoint}${path}`,{...init,headers:{"Content-Type":"application/json","X-Atende-Token":token,...(init?.headers||{})}});const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(Array.isArray(data?.message)?data.message.join(" "):data?.message||"Não foi possível concluir a ação.");return data;};
  const load=()=>{setLoading(true);api("/flows").then((items:ConversationFlow[])=>setFlows(items.map(normalizeFlow))).catch(error=>setFeedback(error.message)).finally(()=>setLoading(false));};
  useEffect(()=>{load();},[endpoint,token]);
  useEffect(()=>{if(selected>=flows.length)setSelected(Math.max(0,flows.length-1));},[flows.length,selected]);
  useEffect(()=>{if(!feedback)return;const timer=window.setTimeout(()=>setFeedback(current=>current===feedback?"":current),5000);return()=>window.clearTimeout(timer);},[feedback]);
  const flow=flows[selected];
  const patchFlow=(patch:Partial<ConversationFlow>)=>setFlows(current=>current.map((item,index)=>index===selected?{...item,...patch}:item));
  const patchStep=(index:number,patch:Partial<ConversationFlowStep>)=>patchFlow({steps:flow.steps.map((item,i)=>i===index?{...item,...patch}:item)});
  const addBlock=(type:ConversationFlowStep["type"])=>{if(flow)patchFlow({steps:[...flow.steps,newBlock(type)]});};
  const removeBlock=(index:number)=>patchFlow({steps:flow.steps.filter((_,i)=>i!==index)});
  const moveBlock=(from:number,to:number)=>{if(to<0||to>=flow.steps.length||from===to)return;const steps=[...flow.steps], [item]=steps.splice(from,1);steps.splice(to,0,item);patchFlow({steps});};
  const addFlow=()=>{setFlows(current=>[...current,blankFlow()]);setSelected(flows.length);setEditingDetails(true);};
  async function save(){if(!flow)return;const validation=validateFlow(flow);if(validation){setFeedback(validation);return;}setSaving(flow.id||"new");setFeedback("");try{const path=flow.id?`/admin/flows/${flow.id}`:"/admin/flows";const payload={name:flow.name,description:flow.description||"",active:flow.active,kind:flow.kind,steps:flow.steps,pollOptions:flow.kind==="evaluation"?defaultPollOptions:[]};const result=await api(path,{method:flow.id?"PUT":"POST",body:JSON.stringify(payload)});const returnedFlow=result?.flow||(result?.data&&!Array.isArray(result.data)?result.data:result);const saved=normalizeFlow({...flow,...(returnedFlow&&typeof returnedFlow==="object"&&!Array.isArray(returnedFlow)?returnedFlow:{}),id:returnedFlow?.id||flow.id,name:typeof returnedFlow?.name==="string"&&returnedFlow.name.trim()?returnedFlow.name:flow.name});setFlows(current=>current.map((item,index)=>index===selected?saved:item));setFeedback(`Fluxo “${saved.name||flow.name}” salvo com sucesso.`);}catch(error){setFeedback(error instanceof Error?error.message:"Não foi possível salvar.");}finally{setSaving("");}}
  async function remove(){if(!flow)return;if(!flow.id){setFlows(current=>current.filter((_,i)=>i!==selected));return;}if(!window.confirm(`Excluir o fluxo “${flow.name}”?`))return;setSaving(flow.id);try{await api(`/admin/flows/${flow.id}`,{method:"DELETE"});setFlows(current=>current.filter(item=>item.id!==flow.id));setFeedback("Fluxo excluído.");}catch(error){setFeedback(error instanceof Error?error.message:"Não foi possível excluir.");}finally{setSaving("");}}
  async function selectFile(index:number,file?:File){if(!file)return;if(file.size>8*1024*1024){setFeedback("O arquivo do fluxo pode ter no máximo 8 MB.");return;}const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]||"");reader.onerror=()=>reject(new Error("Não foi possível ler o arquivo."));reader.readAsDataURL(file);});patchStep(index,{data,mimetype:file.type||"application/octet-stream",filename:file.name});}
  const [editingDetails,setEditingDetails]=useState(false);

  if(loading)return <div className="flow-builder-loading">Carregando seus fluxos…</div>;
  return <div className="flow-builder">
    <aside className="flow-library">
      <header><div><span>Automações</span><h2>Fluxos</h2></div><button onClick={addFlow} title="Criar fluxo"><Plus size={18}/></button></header>
      <div className="flow-library-list">{flows.map((item,index)=><button key={item.id||`new-${index}`} className={selected===index?"active":""} onClick={()=>{setSelected(index);setEditingDetails(false);}}><span className="flow-library-icon"><GitBranch size={17}/></span><span><b>{item.name}</b><small>{item.description||`${item.steps.length} blocos configurados`}</small></span><i className={item.active?"online":""}/></button>)}</div>
      <button className="flow-new" onClick={addFlow}><Plus size={16}/>Novo fluxo</button>
    </aside>
    {flow?<section className="flow-workspace">
      <header className="flow-toolbar"><button className="flow-details-trigger" onClick={()=>setEditingDetails(current=>!current)} aria-expanded={editingDetails}><Pencil size={16}/>Editar detalhes</button><label className="flow-active"><input type="checkbox" checked={flow.active} onChange={event=>patchFlow({active:event.target.checked})}/><span/>{flow.active?"Ativo":"Inativo"}</label><button className="flow-delete" onClick={()=>void remove()} disabled={!!saving}><Trash2 size={17}/></button><button className="solid-button" onClick={()=>void save()} disabled={!!saving}><Save size={17}/>{saving?"Salvando…":"Salvar fluxo"}</button></header>
      {editingDetails&&<div className="flow-details-editor"><label>Nome do fluxo<input value={flow.name} maxLength={100} onChange={event=>patchFlow({name:event.target.value})}/></label><label>Descrição<input value={flow.description||""} maxLength={240} onChange={event=>patchFlow({description:event.target.value})} placeholder="Descrição para a equipe"/></label></div>}
      {feedback&&<div className="workspace-feedback" role="status" aria-live="polite"><CircleAlert size={15}/><span>{feedback}</span><button type="button" aria-label="Dispensar aviso" onClick={()=>setFeedback("")}><X size={15}/></button></div>}
      <div className="flow-editor-layout">
        <div className="flow-canvas">
          <div className="flow-canvas-grid"/>
          <div className="flow-start-node"><span><GitBranch size={18}/></span><div><b>Início do fluxo</b><small>O fluxo começa por este bloco</small></div></div>
          <div className="flow-connector"><span/></div>
          {flow.kind==="evaluation"?<div className="flow-locked-evaluation"><ListChecks size={22}/><div><b>Avaliação por enquete</b><p>Envia enquetes nativas do WhatsApp para escolher o técnico e a nota, depois envia o link de avaliação e encerra o atendimento.</p></div><span>Enquete nativa</span></div>:flow.steps.map((step,index)=><FlowNode key={step.id} step={step} index={index} total={flow.steps.length} patch={patch=>patchStep(index,patch)} remove={()=>removeBlock(index)} move={direction=>moveBlock(index,index+direction)} chooseFile={file=>void selectFile(index,file)} onDragStart={()=>setDragged(index)} onDrop={()=>{if(dragged!==null)moveBlock(dragged,index);setDragged(null);}}/>)}
          {flow.kind!=="evaluation"&&<><button className="flow-inline-add" onClick={()=>addBlock("message")}><Plus size={16}/>Adicionar próximo bloco</button><div className="flow-connector"><span/></div></>}
          <div className="flow-end-node"><CheckCircle2 size={18}/><span>Fim do fluxo</span></div>
        </div>
        <aside className="flow-palette">
          <div><span>Blocos disponíveis</span><h3>Monte seu fluxo</h3><p>Clique para adicionar. Arraste os blocos no painel para reorganizar.</p></div>
          {flow.kind==="evaluation"?<button className="flow-convert" onClick={()=>patchFlow({kind:"regular",steps:[messageBlock()]})}>Transformar em fluxo personalizado</button>:<div className="flow-palette-list">
            <PaletteButton type="message" text="Mensagem" detail="Texto e variáveis" add={addBlock}/>
            <PaletteButton type="poll" text="Lista de opções" detail="O cliente escolhe no WhatsApp" add={addBlock}/>
            <PaletteButton type="image" text="Foto" detail="Imagem com legenda" add={addBlock}/>
            <PaletteButton type="video" text="Vídeo" detail="Vídeo com legenda" add={addBlock}/>
            <PaletteButton type="audio" text="Áudio" detail="Arquivo de áudio" add={addBlock}/>
            <PaletteButton type="document" text="Arquivo" detail="PDF, DOC e outros" add={addBlock}/>
            <PaletteButton type="delay" text="Espera" detail="Intervalo entre blocos" add={addBlock}/>
            <PaletteButton type="action" text="Ação" detail="Atribuir ou encerrar" add={addBlock}/>
          </div>}
          <div className="flow-variables-card">
            <b>Campos automáticos</b>
            <code>{"{{atendente}}"}</code><code>{"{{cliente}}"}</code><code>{"{{nome}}"}</code><code>{"{{saudacao}}"}</code>
            <code>{"{{telefone}}"}</code><code>{"{{email}}"}</code><code>{"{{empresa}}"}</code>
            <code>{"{{documento}}"}</code><code>{"{{cpf_cnpj}}"}</code><code>{"{{endereco}}"}</code><code>{"{{etiquetas}}"}</code>
            <code>{"{{status}}"}</code><code>{"{{tipo_atendimento}}"}</code><code>{"{{prioridade}}"}</code>
            <code>{"{{campos_personalizados}}"}</code><code>{"{{data}}"}</code><code>{"{{hora}}"}</code>
            <small>Os campos sem informação cadastrada ficam vazios. Data e hora usam o fuso de Brasília.</small>
          </div>
        </aside>
      </div>
    </section>:<section className="flow-empty"><GitBranch size={38}/><h2>Crie seu primeiro fluxo</h2><p>Combine mensagens, enquetes, arquivos e ações automáticas.</p><button className="solid-button" onClick={addFlow}><Plus size={17}/>Criar fluxo</button></section>}
  </div>;
}

function PaletteButton({type,text,detail,add}:{type:ConversationFlowStep["type"];text:string;detail:string;add:(type:ConversationFlowStep["type"])=>void}){const Icon=icons[type];return <button onClick={()=>add(type)}><span className={`palette-icon ${type}`}><Icon size={18}/></span><span><b>{text}</b><small>{detail}</small></span><Plus size={15}/></button>}

function FlowNode({step,index,total,patch,remove,move,chooseFile,onDragStart,onDrop}:{step:ConversationFlowStep;index:number;total:number;patch:(value:Partial<ConversationFlowStep>)=>void;remove:()=>void;move:(direction:number)=>void;chooseFile:(file?:File)=>void;onDragStart:()=>void;onDrop:()=>void}){
  const Icon=icons[step.type],isMedia=["image","video","audio","document"].includes(step.type);
  const accept=step.type==="image"?"image/*":step.type==="video"?"video/*":step.type==="audio"?"audio/*":".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip";
  return <><article className={`flow-node flow-node-${step.type}`} draggable onDragStart={onDragStart} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();onDrop();}}>
    <header><span className="flow-drag"><GripVertical size={16}/></span><span className={`flow-node-icon ${step.type}`}><Icon size={17}/></span><div><small>Bloco {index+1}</small><b>{labels[step.type]}</b></div><div className="flow-node-actions"><button disabled={index===0} onClick={()=>move(-1)} aria-label="Mover para cima"><ArrowUp size={14}/></button><button disabled={index===total-1} onClick={()=>move(1)} aria-label="Mover para baixo"><ArrowDown size={14}/></button><button onClick={remove} aria-label="Excluir bloco"><Trash2 size={15}/></button></div></header>
    {step.type==="message"&&<textarea rows={4} maxLength={4000} value={step.text||""} onChange={event=>patch({text:event.target.value})} placeholder="Digite a mensagem que será enviada…"/>}
    {step.type==="poll"&&<div className="flow-poll-editor"><label>Pergunta<input maxLength={255} value={step.question||""} onChange={event=>patch({question:event.target.value})}/></label><b>Alternativas</b>{(step.options||[]).map((option,optionIndex)=><div key={optionIndex}><span>{optionIndex+1}</span><input maxLength={100} value={option} onChange={event=>patch({options:(step.options||[]).map((item,i)=>i===optionIndex?event.target.value:item)})}/><button disabled={(step.options||[]).length<=2} onClick={()=>patch({options:(step.options||[]).filter((_,i)=>i!==optionIndex)})}><X size={14}/></button></div>)}{(step.options||[]).length<12&&<button className="poll-add-option" onClick={()=>patch({options:[...(step.options||[]),`Opção ${(step.options||[]).length+1}`]})}><Plus size={14}/>Adicionar alternativa</button>}<label className="flow-check"><input type="checkbox" checked={step.allowMultipleAnswers===true} onChange={event=>patch({allowMultipleAnswers:event.target.checked})}/>Permitir várias respostas</label></div>}
    {isMedia&&<div className="flow-media-editor"><label className="flow-file-picker"><input type="file" accept={accept} onChange={event=>chooseFile(event.target.files?.[0])}/><span className={`flow-node-icon ${step.type}`}><Icon size={22}/></span><b>{step.filename||`Selecionar ${labels[step.type].toLowerCase()}`}</b><small>{step.data?"Arquivo pronto para ser enviado":"Até 8 MB"}</small></label>{step.data&&<button className="flow-clear-file" onClick={()=>patch({data:"",filename:"",mimetype:""})}>Remover arquivo</button>}{step.type!=="audio"&&<textarea rows={2} maxLength={1024} value={step.caption||""} onChange={event=>patch({caption:event.target.value})} placeholder="Legenda opcional"/>}</div>}
    {step.type==="delay"&&<label className="flow-delay-editor"><Clock3 size={20}/><span>Aguardar</span><input type="number" min={1} max={3600} value={step.delaySeconds||1} onChange={event=>patch({delaySeconds:Number(event.target.value)})}/><span>segundos</span></label>}
    {step.type==="action"&&<div className="flow-action-editor"><button className={step.action==="assign-current"?"active":""} onClick={()=>patch({action:"assign-current"})}><UserCheck size={18}/><span><b>Atribuir atendimento</b><small>Responsável será quem disparar o fluxo</small></span></button><button className={step.action==="close-ticket"?"active danger":""} onClick={()=>patch({action:"close-ticket"})}><CheckCircle2 size={18}/><span><b>Encerrar atendimento</b><small>Conclui e remove a atribuição</small></span></button></div>}
    {!['delay','action'].includes(step.type)&&<label className="flow-node-delay">Esperar antes de enviar <input type="number" min={0} max={3600} value={step.delaySeconds||0} onChange={event=>patch({delaySeconds:Number(event.target.value)})}/> segundos</label>}
  </article><div className="flow-connector"><span/></div></>;
}
