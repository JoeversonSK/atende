"use client";
import { useEffect, useState } from "react";
import { ShieldCheck, UsersRound } from "lucide-react";
type Member = { id:string; username:string; displayName:string; role:string; active:boolean; canSend:boolean; canAssign:boolean };
export function TeamSettings({ baseUrl, token }: {baseUrl:string;token:string}) {
  const [users,setUsers]=useState<Member[]>([]);
  const [recipient,setRecipient]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState("");
  const [feedback,setFeedback]=useState("");
  const [error,setError]=useState("");
  async function api(path:string,body?:unknown) {
    const response=await fetch(`${baseUrl.replace(/\/$/,"")}/api/operator-auth/admin${path}`,{method:body===undefined?"GET":"PUT",headers:{"Content-Type":"application/json","X-Atende-Token":token},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await response.json();
    if(!response.ok) throw new Error(Array.isArray(data.message)?data.message.join(" "):data.message || "Não foi possível salvar.");
    return data;
  }
  useEffect(()=>{let live=true; setLoading(true); api("").then(data=>{if(live){setUsers(data.users);setRecipient(data.unassignedUserId||"");}}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[baseUrl,token]);
  function edit(id:string,patch:Partial<Member>) {setUsers(current=>current.map(user=>user.id===id?{...user,...patch}:user));}
  async function save(user:Member) {
    setSaving(user.id);setError("");setFeedback("");
    try {
      const updated=await api(`/users/${user.id}`,{role:user.role,active:user.active,canSend:user.canSend,canAssign:user.canAssign});
      edit(user.id,updated);
      if(!updated.active && recipient===user.id)setRecipient("");
      setFeedback(`Permissões de ${updated.displayName} salvas.`);
    } catch(e){setError(e instanceof Error?e.message:"Erro ao salvar.");}
    finally{setSaving("");}
  }
  async function saveRecipient(){
    setSaving("notifications");setError("");setFeedback("");
    try{await api("/notifications",{userId:recipient||null});setFeedback("Responsável pelas notificações atualizado.");}
    catch(e){setError(e instanceof Error?e.message:"Erro ao salvar.");}
    finally{setSaving("");}
  }
  return <><h2>Equipe e permissões</h2><p>Organize os acessos e direcione cada novo atendimento.</p>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {feedback&&<p className="team-feedback" role="status">{feedback}</p>}
    {loading?<p role="status">Carregando equipe…</p>:<>
    <section className="settings-card"><div className="profile-heading"><ShieldCheck size={28}/><div><h3>Conversas sem responsável</h3><p>Somente a conta escolhida recebe os alertas das conversas ainda não atribuídas.</p></div></div>
      <label>Receber novas conversas<select value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">Ninguém — alertas desativados</option>{users.filter(u=>u.active).map(u=><option key={u.id} value={u.id}>{u.displayName} (@{u.username})</option>)}</select></label>
      <small>Após a atribuição, apenas o responsável recebe os alertas. Grupos não geram notificações.</small>
      <button className="solid-button" disabled={!!saving} onClick={saveRecipient}>{saving==="notifications"?"Salvando…":"Salvar responsável"}</button>
    </section>
    <div className="team-heading"><UsersRound size={22}/><h3>Contas da equipe</h3><span>{users.length}</span></div>
    <p>Administradores gerenciam a equipe e têm todas as permissões. Desativar uma conta encerra suas sessões. Novas contas começam como atendentes.</p>
    <div className="team-grid">{users.map(user=><section className="settings-card team-member" key={user.id}>
      <div className="profile-heading"><span className="preview-avatar">{user.displayName.slice(0,1)}</span><div><h3>{user.displayName}</h3><small>@{user.username}</small></div><span className={user.active?"member-status":"member-status inactive"}>{user.active?"Ativo":"Desativado"}</span></div>
      <label>Função<select value={user.role} onChange={e=>edit(user.id,{role:e.target.value})}><option value="agent">Atendente</option><option value="admin">Administrador</option></select></label>
      <label className="team-check"><input type="checkbox" checked={user.active} onChange={e=>edit(user.id,{active:e.target.checked})}/>Conta ativa</label>
      <label className="team-check"><input type="checkbox" disabled={user.role==="admin"} checked={user.role==="admin"||user.canSend} onChange={e=>edit(user.id,{canSend:e.target.checked})}/>Enviar mensagens e arquivos</label>
      <label className="team-check"><input type="checkbox" disabled={user.role==="admin"} checked={user.role==="admin"||user.canAssign} onChange={e=>edit(user.id,{canAssign:e.target.checked})}/>Assumir e remover atribuições</label>
      <button className="solid-button" disabled={!!saving} onClick={()=>save(user)}>{saving===user.id?"Salvando…":"Salvar permissões"}</button>
    </section>)}</div></>}
  </>;
}
