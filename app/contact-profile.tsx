"use client";
import {useEffect,useState} from "react";
import {Plus,Trash2} from "lucide-react";
type Data={name:string;phone:string;email:string;company:string;document:string;address:string;status:string;serviceType?:string;priority?:string;notes:{id:string;text:string;author:string;createdAt:string}[];events:{id:string;title:string;date:string}[];tags:string[];sequences:string[];campaigns:string[];custom:{id:string;label:string;value:string}[]};
const empty:Data={name:"",phone:"",email:"",company:"",document:"",address:"",status:"open",serviceType:"remote",priority:"normal",notes:[],events:[],tags:[],sequences:[],campaigns:[],custom:[]};
export function ContactProfile({baseUrl,apiKey,token,sessionId,chatId,contactName,contactPhone="",canEdit,dirtyRef,onSaved}:{baseUrl:string;apiKey:string;token:string;sessionId:string;chatId:string;contactName:string;contactPhone?:string;canEdit:boolean;dirtyRef:{current:boolean};onSaved?:(data:Data)=>void}){
  const [data,setData]=useState<Data>(empty),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [note,setNote]=useState(""),[fieldName,setFieldName]=useState(""),[fieldValue,setFieldValue]=useState("");
  const [drafts,setDrafts]=useState({tags:"",sequences:"",campaigns:""});
  useEffect(()=>{dirtyRef.current=dirty;return()=>{dirtyRef.current=false;};},[dirty,dirtyRef]);
  const endpoint=`${baseUrl.replace(/\/$/,"")}/api/operator-auth/contacts/${encodeURIComponent(sessionId)}/${encodeURIComponent(chatId)}`;
  async function fetchProfile(signal?:AbortSignal){
    const response=await fetch(endpoint,{signal,headers:{"X-Atende-Token":token}});
    const result=await response.json();if(!response.ok)throw new Error(result.message||"Não foi possível carregar o perfil.");
    if(!result.data.phone){try{const lookup=await fetch(`${baseUrl.replace(/\/$/,"")}/api/sessions/${encodeURIComponent(sessionId)}/contacts/${encodeURIComponent(chatId)}/phone`,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(6000)]):AbortSignal.timeout(6000),headers:{"X-API-Key":apiKey,"X-Atende-Token":token}});if(lookup.ok){const resolved=await lookup.json();if(typeof resolved.phone==="string"&&/^\d{7,15}$/.test(resolved.phone))result.data.phone=resolved.phone;}}catch{/* Keep manual entry available when WhatsApp is disconnected. */}}
    return result;
  }
  function apply(result:{data:Data;revision:number}){
    setData({...empty,...result.data,...(result.revision===0?{name:result.data.name||(/^[+\d\s()-]+$/.test(contactName)||contactName.includes("@")?"":contactName),phone:result.data.phone||contactPhone}:{})});setRevision(result.revision);setDirty(false);
  }
  useEffect(()=>{const abort=new AbortController();fetchProfile(abort.signal).then(apply).catch(e=>{if(e.name!=="AbortError")setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();},[endpoint,token]);
  useEffect(()=>{if(!dirty)return;const leave=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};window.addEventListener("beforeunload",leave);return()=>window.removeEventListener("beforeunload",leave);},[dirty]);
  function change(patch:Partial<Data>){setData(current=>({...current,...patch}));setDirty(true);setNotice("");}
  useEffect(()=>{
    if(dirty||saving||loading)return;
    const abort=new AbortController();
    const timer=window.setInterval(async()=>{
      try{
        const response=await fetch(endpoint,{signal:abort.signal,headers:{"X-Atende-Token":token}});
        if(!response.ok)return;
        const result=await response.json();
        if(!abort.signal.aborted&&!dirtyRef.current&&result.revision!==revision)apply(result);
      }catch{/* The next refresh retries without discarding edits. */}
    },8000);
    return()=>{window.clearInterval(timer);abort.abort();};
  },[endpoint,token,revision,dirty,saving,loading]);
  async function save(){
    setSaving(true);setError("");setNotice("");
    try{const response=await fetch(endpoint,{method:"PUT",headers:{"Content-Type":"application/json","X-Atende-Token":token},body:JSON.stringify({revision,data})});const result=await response.json();if(!response.ok)throw new Error(result.message||"Não foi possível salvar.");apply(result);onSaved?.(result.data);setNotice("Informações salvas para a equipe.");}
    catch(e){setError(e instanceof Error?e.message:"Erro ao salvar.");}finally{setSaving(false);}
  }
  async function reload(){if(dirty&&!window.confirm("Descartar as alterações não salvas e recarregar o perfil?"))return;setLoading(true);setError("");try{apply(await fetchProfile());}catch(e){setError(e instanceof Error?e.message:"Erro ao carregar.");}finally{setLoading(false);}}
  if(loading)return <div className="contact-crm"><p role="status">Carregando informações…</p></div>;
  return <div className="contact-crm">
    {error&&<p className="form-error" role="alert">{error}</p>}
    <fieldset disabled={!canEdit||saving}>
      <label className="crm-status">Chat<select value={data.status} onChange={e=>change({status:e.target.value})}><option value="open">Aberto</option><option value="pending">Pendente</option><option value="closed">Fechado</option></select></label>
      <div className="crm-content"><label>Prioridade<select value={data.priority||"normal"} onChange={e=>change({priority:e.target.value})}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select></label></div>
      <details open><summary>Dados do usuário <span>{[data.name,data.phone,data.email,data.company,data.document,data.address].filter(Boolean).length}</span></summary><div className="crm-content">
        {([["name","Nome"],["phone","Telefone"],["email","E-mail"],["company","Empresa"],["document","CPF / CNPJ"],["address","Endereço"]] as const).map(([key,label])=><label key={key}>{label}<input value={data[key]} type={key==="email"?"email":"text"} maxLength={key==="address"?1000:key==="phone"||key==="document"?50:300} placeholder={key==="phone"?"Informe o número com DDD":""} onChange={e=>change({[key]:e.target.value})}/></label>)}
        <small>Dados internos do contato. Não alteram o cadastro no WhatsApp.</small>
      </div></details>
      <details><summary>Notas <span>{data.notes.length}</span></summary><div className="crm-content">
        {data.notes.map(n=><article className="crm-entry" key={n.id}><p>{n.text}</p><small>{n.author||"Você"} · {n.createdAt?new Date(n.createdAt).toLocaleString("pt-BR"):"Aguardando salvar"}</small><button type="button" aria-label="Remover nota" onClick={()=>change({notes:data.notes.filter(v=>v.id!==n.id)})}><Trash2 size={14}/></button></article>)}
        <label>Nova nota<textarea maxLength={5000} value={note} onChange={e=>setNote(e.target.value)}/></label><button className="crm-add" disabled={!note.trim()} onClick={()=>{change({notes:[...data.notes,{id:crypto.randomUUID(),text:note.trim(),author:"",createdAt:""}]});setNote("");}}><Plus size={15}/>Adicionar nota</button>
      </div></details>
      {([["tags","Etiquetas"],["sequences","Sequências"],["campaigns","Campanhas"]] as const).map(([key,label])=><details key={key}><summary>{label} <span>{data[key].length}</span></summary><div className="crm-content">
        {key!=="tags"&&<small>Associação informativa. Não dispara mensagens ou automações.</small>}
        <div className="crm-chips">{data[key].map(value=><span key={value}>{value}<button aria-label={`Remover ${value}`} onClick={()=>change({[key]:data[key].filter(v=>v!==value)})}>×</button></span>)}</div>
        <label>{key==="tags"?"Nova etiqueta":`Nome da ${key==="sequences"?"sequência":"campanha"}`}<input maxLength={key==="tags"?80:160} value={drafts[key]} onChange={e=>setDrafts({...drafts,[key]:e.target.value})}/></label>
        <button className="crm-add" disabled={!drafts[key].trim()} onClick={()=>{change({[key]:[...new Set([...data[key],drafts[key].trim()])]});setDrafts({...drafts,[key]:""});}}><Plus size={15}/>Adicionar</button>
      </div></details>)}
      <details><summary>Campos personalizados <span>{data.custom.length}</span></summary><div className="crm-content">
        {data.custom.map(c=><div className="crm-entry" key={c.id}><label>{c.label}<input maxLength={2000} value={c.value} onChange={e=>change({custom:data.custom.map(v=>v.id===c.id?{...v,value:e.target.value}:v)})}/></label><button aria-label={`Remover campo ${c.label}`} onClick={()=>change({custom:data.custom.filter(v=>v.id!==c.id)})}><Trash2 size={14}/></button></div>)}
        <label>Nome do campo<input maxLength={100} value={fieldName} onChange={e=>setFieldName(e.target.value)}/></label><label>Valor<input maxLength={2000} value={fieldValue} onChange={e=>setFieldValue(e.target.value)}/></label><button className="crm-add" disabled={!fieldName.trim()} onClick={()=>{change({custom:[...data.custom,{id:crypto.randomUUID(),label:fieldName.trim(),value:fieldValue.trim()}]});setFieldName("");setFieldValue("");}}><Plus size={15}/>Adicionar campo</button>
      </div></details>
    </fieldset>
    <div className="crm-save">{canEdit?<><button className="solid-button" disabled={saving||!dirty} onClick={save}>{saving?"Salvando…":"Salvar informações"}</button>{dirty&&<small>Salve antes de trocar de conversa.</small>}</>:<small>Seu acesso permite apenas consultar. A edição usa a permissão de atribuições.</small>}
      <button className="back-link" disabled={saving} onClick={reload}>Recarregar informações</button>{notice&&<small role="status">{notice}</small>}
    </div>
  </div>;
}
