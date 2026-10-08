"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {Plus,Trash2} from "lucide-react";
import {errorMessage} from "./atende-api";
type Data={name:string;phone:string;email:string;company:string;document:string;cnpjs:string[];address:string;status:string;serviceType?:string;priority?:string;notes:{id:string;text:string;author:string;createdAt:string}[];events:{id:string;title:string;date:string}[];tags:string[];sequences:string[];campaigns:string[];custom:{id:string;label:string;value:string}[]};
type ProfileResult={data:Data;revision:number};
const empty:Data={name:"",phone:"",email:"",company:"",document:"",cnpjs:[],address:"",status:"open",serviceType:"remote",priority:"normal",notes:[],events:[],tags:[],sequences:[],campaigns:[],custom:[]};
export function ContactProfile({baseUrl,apiKey,token,sessionId,chatId,contactName,contactPhone="",canEdit,dirtyRef,onSaved}:{baseUrl:string;apiKey:string;token:string;sessionId:string;chatId:string;contactName:string;contactPhone?:string;canEdit:boolean;dirtyRef:{current:boolean};onSaved?:(data:Data)=>void}){
  const onSavedRef=useRef(onSaved);
  useEffect(()=>{onSavedRef.current=onSaved;},[onSaved]);
  const [data,setData]=useState<Data>(empty),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[savingPriority,setSavingPriority]=useState(false),[dirty,setDirty]=useState(false),[autoSaveBlocked,setAutoSaveBlocked]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [note,setNote]=useState(""),[fieldName,setFieldName]=useState(""),[fieldValue,setFieldValue]=useState("");
  const [drafts,setDrafts]=useState({tags:"",sequences:"",campaigns:""});
  const [availableTags,setAvailableTags]=useState<string[]>([]),[tagChoice,setTagChoice]=useState("");
  useEffect(()=>{dirtyRef.current=dirty;return()=>{dirtyRef.current=false;};},[dirty,dirtyRef]);
  const endpoint=`${baseUrl.replace(/\/$/,"")}/api/operator-auth/contacts/${encodeURIComponent(sessionId)}/${encodeURIComponent(chatId)}`;
  const fetchProfile=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch(endpoint,{signal,headers:{"X-Atende-Token":token}});
    const result=await response.json() as ProfileResult;if(!response.ok)throw new Error(errorMessage(result));
    if(!result.data.phone){try{const lookup=await fetch(`${baseUrl.replace(/\/$/,"")}/api/sessions/${encodeURIComponent(sessionId)}/contacts/${encodeURIComponent(chatId)}/phone`,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(6000)]):AbortSignal.timeout(6000),headers:{"X-API-Key":apiKey,"X-Atende-Token":token}});if(lookup.ok){const resolved=await lookup.json() as {phone?:string};if(typeof resolved.phone==="string"&&/^\d{7,15}$/.test(resolved.phone))result.data.phone=resolved.phone;}}catch{/* Keep manual entry available when WhatsApp is disconnected. */}}
    return result;
  },[endpoint,baseUrl,sessionId,chatId,token,apiKey]);
  const apply=useCallback((result:ProfileResult)=>{
    const cleanName=/[\p{L}\p{N}]/u.test(result.data.name||"")?result.data.name:"";
    const fallback=/^[+\d\s()-]+$/.test(contactName)||contactName.includes("@")||contactName==="Contato sem nome"?"":contactName;
    setData({...empty,...result.data,cnpjs:Array.isArray(result.data.cnpjs)?result.data.cnpjs:[],name:cleanName||(result.revision===0?fallback:""),...(result.revision===0?{phone:result.data.phone||contactPhone}:{})});setRevision(result.revision);setDirty(false);
  },[contactName,contactPhone]);
  useEffect(()=>{const abort=new AbortController();fetchProfile(abort.signal).then(apply).catch(e=>{if(e.name!=="AbortError")setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();},[fetchProfile,apply]);
  useEffect(()=>{const abort=new AbortController();fetch(`${baseUrl.replace(/\/$/,"")}/api/operator-auth/contacts/${encodeURIComponent(sessionId)}/catalog/tags`,{signal:abort.signal,headers:{"X-Atende-Token":token}}).then(async response=>response.ok?response.json():[]).then(tags=>{if(!abort.signal.aborted)setAvailableTags(Array.isArray(tags)?tags:[]);}).catch(()=>undefined);return()=>abort.abort();},[baseUrl,sessionId,token]);
  useEffect(()=>{if(!dirty)return;const leave=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};window.addEventListener("beforeunload",leave);return()=>window.removeEventListener("beforeunload",leave);},[dirty]);
  function change(patch:Partial<Data>){setData(current=>({...current,...patch}));setDirty(true);setAutoSaveBlocked(false);setError("");setNotice("");}
  const invalidCnpjs=data.cnpjs.some(cnpj=>cnpj.length!==14)||new Set(data.cnpjs).size!==data.cnpjs.length;
  useEffect(()=>{
    if(dirty||saving||loading)return;
    const abort=new AbortController();
    const timer=window.setInterval(async()=>{
      try{
        const response=await fetch(endpoint,{signal:abort.signal,headers:{"X-Atende-Token":token}});
        if(!response.ok)return;
        const result=await response.json() as ProfileResult;
        if(!abort.signal.aborted&&!dirtyRef.current&&result.revision!==revision)apply(result);
      }catch{/* The next refresh retries without discarding edits. */}
    },8000);
    return()=>{window.clearInterval(timer);abort.abort();};
  },[endpoint,token,revision,dirty,saving,loading,dirtyRef,apply]);
  const save=useCallback(async()=>{
    if(!dirty||saving)return;if(invalidCnpjs){setError("Preencha 14 dígitos em cada CNPJ e remova os repetidos neste contato.");return;}setSaving(true);setAutoSaveBlocked(false);setError("");setNotice("Salvando automaticamente…");
    try{const response=await fetch(endpoint,{method:"PUT",headers:{"Content-Type":"application/json","X-Atende-Token":token},body:JSON.stringify({revision,data})});const result=await response.json() as ProfileResult;if(!response.ok)throw new Error(errorMessage(result));apply(result);onSavedRef.current?.(result.data);setNotice("Informações salvas para a equipe.");}
    catch(e){setAutoSaveBlocked(true);setError(e instanceof Error?e.message:"Erro ao salvar.");setNotice("");}finally{setSaving(false);}
  },[dirty,saving,invalidCnpjs,revision,data,endpoint,token,apply]);
  useEffect(()=>{if(!canEdit||!dirty||saving||savingPriority||loading||autoSaveBlocked||invalidCnpjs)return;const timer=window.setTimeout(()=>void save(),650);return()=>window.clearTimeout(timer);},[canEdit,dirty,saving,savingPriority,loading,autoSaveBlocked,invalidCnpjs,save]);
  async function reload(){if(dirty&&!window.confirm("Descartar as alterações não salvas e recarregar o perfil?"))return;setLoading(true);setError("");try{apply(await fetchProfile());}catch(e){setError(e instanceof Error?e.message:"Erro ao carregar.");}finally{setLoading(false);}}
  async function savePriority(priority:string){
    const previous=data.priority||"normal";setData(current=>({...current,priority}));setSavingPriority(true);setError("");setNotice("Salvando prioridade…");
    try{const response=await fetch(`${endpoint}/priority`,{method:"PUT",headers:{"Content-Type":"application/json","X-Atende-Token":token},body:JSON.stringify({priority})});const result=await response.json() as ProfileResult;if(!response.ok)throw new Error(errorMessage(result));setRevision(result.revision);onSaved?.({...data,priority});setNotice("Prioridade atualizada no dashboard.");}
    catch(e){setData(current=>({...current,priority:previous}));setError(e instanceof Error?e.message:"Erro ao alterar a prioridade.");setNotice("");}finally{setSavingPriority(false);}
  }
  if(loading)return <div className="contact-crm"><p role="status">Carregando informações…</p></div>;
  return <div className="contact-crm">
    {error&&<p className="form-error" role="alert">{error}</p>}
    <fieldset disabled={!canEdit||saving}>
      <label className="crm-status">Chat<select value={data.status} onChange={e=>change({status:e.target.value})}><option value="open">Aberto</option><option value="pending">Pendente</option><option value="closed">Fechado</option></select></label>
      <div className="crm-content"><label>Prioridade<select value={data.priority||"normal"} disabled={savingPriority} onChange={e=>void savePriority(e.target.value)}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select><small>{savingPriority?"Atualizando o dashboard…":"A alteração é salva automaticamente."}</small></label></div>
      <details open><summary>Dados do usuário <span>{[data.name,data.phone,data.email,data.company,data.address].filter(Boolean).length+data.cnpjs.length}</span></summary><div className="crm-content">
        {([["name","Nome"],["phone","Telefone"],["email","E-mail"],["company","Empresa"],["address","Endereço"]] as const).map(([key,label])=><label key={key}>{label}<input value={data[key]} type={key==="email"?"email":"text"} maxLength={key==="address"?1000:key==="phone"?50:300} placeholder={key==="phone"?"Informe o número com DDD":""} onChange={e=>change({[key]:e.target.value})}/></label>)}
        <div><strong>CNPJs vinculados</strong>{data.cnpjs.map((cnpj,index)=><div className="crm-entry" key={index}><label>CNPJ {index+1}<input inputMode="numeric" maxLength={18} value={cnpj} placeholder="00.000.000/0000-00" onChange={e=>change({cnpjs:data.cnpjs.map((value,position)=>position===index?e.target.value.replace(/\D/g,"").slice(0,14):value)})}/></label><button type="button" aria-label={`Remover CNPJ ${index+1}`} onClick={()=>change({cnpjs:data.cnpjs.filter((_,position)=>position!==index)})}><Trash2 size={14}/></button></div>)}<button type="button" className="crm-add" disabled={data.cnpjs.length>=20} onClick={()=>change({cnpjs:[...data.cnpjs,""]})}><Plus size={15}/>Adicionar CNPJ</button>{invalidCnpjs&&<small role="alert">Preencha 14 dígitos em cada CNPJ antes de salvar.</small>}</div>
        <small>Dados internos do contato. Não alteram o cadastro no WhatsApp.</small>
      </div></details>
      <details><summary>Notas <span>{data.notes.length}</span></summary><div className="crm-content">
        {data.notes.map(n=><article className="crm-entry" key={n.id}><p>{n.text}</p><small>{n.author||"Você"} · {n.createdAt?new Date(n.createdAt).toLocaleString("pt-BR"):"Aguardando salvar"}</small><button type="button" aria-label="Remover nota" onClick={()=>change({notes:data.notes.filter(v=>v.id!==n.id)})}><Trash2 size={14}/></button></article>)}
        <label>Nova nota<textarea maxLength={5000} value={note} onChange={e=>setNote(e.target.value)}/></label><button className="crm-add" disabled={!note.trim()} onClick={()=>{change({notes:[...data.notes,{id:crypto.randomUUID(),text:note.trim(),author:"",createdAt:""}]});setNote("");}}><Plus size={15}/>Adicionar nota</button>
      </div></details>
      {([["tags","Etiquetas"],["sequences","Sequências"],["campaigns","Campanhas"]] as const).map(([key,label])=><details key={key}><summary>{label} <span>{data[key].length}</span></summary><div className="crm-content">
        {key!=="tags"&&<small>Associação informativa. Não dispara mensagens ou automações.</small>}
        <div className="crm-chips">{data[key].map(value=><span key={value}>{value}<button aria-label={`Remover ${value}`} onClick={()=>change({[key]:data[key].filter(v=>v!==value)})}>×</button></span>)}</div>
        {key==="tags"&&availableTags.some(tag=>!data.tags.includes(tag))&&<label>Usar etiqueta existente<select value={tagChoice} onChange={e=>{const value=e.target.value;setTagChoice("");if(value)change({tags:[...new Set([...data.tags,value])]});}}><option value="">Selecione uma etiqueta</option>{availableTags.filter(tag=>!data.tags.includes(tag)).map(tag=><option key={tag} value={tag}>{tag}</option>)}</select></label>}
        <label>{key==="tags"?"Nova etiqueta":`Nome da ${key==="sequences"?"sequência":"campanha"}`}<input list={key==="tags"?"known-contact-tags":undefined} maxLength={key==="tags"?80:160} value={drafts[key]} onChange={e=>setDrafts({...drafts,[key]:e.target.value})}/>{key==="tags"&&<datalist id="known-contact-tags">{availableTags.map(tag=><option key={tag} value={tag}/>)}</datalist>}</label>
        <button className="crm-add" disabled={!drafts[key].trim()} onClick={()=>{const value=drafts[key].trim();change({[key]:[...new Set([...data[key],value])]});if(key==="tags")setAvailableTags(current=>[...new Set([...current,value])].sort((a,b)=>a.localeCompare(b)));setDrafts({...drafts,[key]:""});}}><Plus size={15}/>Adicionar</button>
      </div></details>)}
      <details><summary>Campos personalizados <span>{data.custom.length}</span></summary><div className="crm-content">
        {data.custom.map(c=><div className="crm-entry" key={c.id}><label>{c.label}<input maxLength={2000} value={c.value} onChange={e=>change({custom:data.custom.map(v=>v.id===c.id?{...v,value:e.target.value}:v)})}/></label><button aria-label={`Remover campo ${c.label}`} onClick={()=>change({custom:data.custom.filter(v=>v.id!==c.id)})}><Trash2 size={14}/></button></div>)}
        <label>Nome do campo<input maxLength={100} value={fieldName} onChange={e=>setFieldName(e.target.value)}/></label><label>Valor<input maxLength={2000} value={fieldValue} onChange={e=>setFieldValue(e.target.value)}/></label><button className="crm-add" disabled={!fieldName.trim()} onClick={()=>{change({custom:[...data.custom,{id:crypto.randomUUID(),label:fieldName.trim(),value:fieldValue.trim()}]});setFieldName("");setFieldValue("");}}><Plus size={15}/>Adicionar campo</button>
      </div></details>
    </fieldset>
    <div className="crm-save">{canEdit?<><small>{invalidCnpjs&&dirty?"Complete os CNPJs para salvar.":saving||dirty&&!autoSaveBlocked?"Salvando alterações automaticamente…":"As alterações são salvas automaticamente."}</small>{autoSaveBlocked&&<button className="solid-button" disabled={saving} onClick={()=>void save()}>Tentar salvar novamente</button>}</>:<small>Seu acesso permite apenas consultar. A edição usa a permissão de atribuições.</small>}
      <button className="back-link" disabled={saving} onClick={reload}>Recarregar informações</button>{notice&&<small role="status">{notice}</small>}
    </div>
  </div>;
}
