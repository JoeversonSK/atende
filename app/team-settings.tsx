"use client";
import { useEffect, useState } from "react";
import { BellRing, ShieldCheck, UsersRound } from "lucide-react";

type Member = { id:string; username:string; displayName:string; role:string; active:boolean; canSend:boolean; canAssign:boolean; dashboardVisible:boolean };
const columns = [
  {key:"active", label:"Conta ativa", hint:"Permite entrar no sistema"},
  {key:"canSend", label:"Mensagens", hint:"Enviar mensagens e arquivos"},
  {key:"canAssign", label:"Atribuições", hint:"Assumir e remover atribuições"},
  {key:"dashboardVisible", label:"No dashboard", hint:"Exibir atendimentos desta pessoa no dashboard"},
] as const;

export function TeamSettings({ baseUrl, token }: {baseUrl:string;token:string}) {
  const [users,setUsers]=useState<Member[]>([]);
  const [recipients,setRecipients]=useState<string[]>([]);
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
  useEffect(()=>{let live=true; setLoading(true); api("").then(data=>{if(live){setUsers(data.users);setRecipients(data.unassignedUserIds||[]);}}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[baseUrl,token]);
  function edit(id:string,patch:Partial<Member>) {setUsers(current=>current.map(user=>user.id===id?{...user,...patch}:user));}
  async function save(user:Member) {
    setSaving(user.id);setError("");setFeedback("");
    try {
      const updated=await api(`/users/${user.id}`,{role:user.role,active:user.active,canSend:user.canSend,canAssign:user.canAssign,dashboardVisible:user.dashboardVisible});
      edit(user.id,updated);
      if(!updated.active)setRecipients(current=>current.filter(id=>id!==user.id));
      setFeedback(`Permissões de ${updated.displayName} salvas.`);
    } catch(e){setError(e instanceof Error?e.message:"Erro ao salvar.");}
    finally{setSaving("");}
  }
  async function saveRecipients(){
    setSaving("notifications");setError("");setFeedback("");
    try{const result=await api("/notifications",{userIds:recipients});setRecipients(result.unassignedUserIds);setFeedback("Destinatários das notificações atualizados.");}
    catch(e){setError(e instanceof Error?e.message:"Erro ao salvar.");}
    finally{setSaving("");}
  }
  return <><h2>Equipe e permissões</h2><p>Gerencie os acessos em uma visão única e escolha quem recebe avisos de novas conversas.</p>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {feedback&&<p className="team-feedback" role="status">{feedback}</p>}
    {loading?<p role="status">Carregando equipe…</p>:<>
    <section className="settings-card team-recipient-card"><div className="profile-heading"><BellRing size={26}/><div><h3>Conversas sem responsável</h3><p>Marque todas as pessoas que devem receber cada nova mensagem de uma conversa ainda não atribuída.</p></div></div>
      <div className="team-recipient-list">{users.filter(user=>user.active).map(user=><label key={user.id}><input type="checkbox" checked={recipients.includes(user.id)} disabled={!!saving} onChange={event=>setRecipients(current=>event.target.checked?[...current,user.id]:current.filter(id=>id!==user.id))}/><span><b>{user.displayName}</b><small>@{user.username}</small></span></label>)}</div>
      <p className="team-recipient-help">Depois que a conversa for atribuída, somente o responsável receberá esses avisos. Grupos não geram notificações.</p>
      <button className="solid-button" disabled={!!saving} onClick={saveRecipients}>{saving==="notifications"?"Salvando…":"Salvar destinatários"}</button>
    </section>
    <div className="team-heading"><UsersRound size={22}/><h3>Contas da equipe</h3><span>{users.length}</span></div>
    <p>Marque as permissões de cada pessoa e salve a linha. Administradores têm acesso completo; desativar uma conta encerra suas sessões.</p>
    <div className="team-table-scroll"><table className="team-table"><thead><tr><th scope="col">Pessoa</th><th scope="col">Função</th>{columns.map(column=><th key={column.key} scope="col" title={column.hint}>{column.label}</th>)}<th scope="col">Ações</th></tr></thead><tbody>{users.map(user=><tr key={user.id} className={user.active?"":"team-row-inactive"}>
      <td><div className="team-person"><span className="preview-avatar" aria-hidden="true">{user.displayName.slice(0,1)}</span><span><b>{user.displayName}</b><small>@{user.username}</small></span></div></td>
      <td><select aria-label={`Função de ${user.displayName}`} value={user.role} disabled={!!saving} onChange={e=>edit(user.id,{role:e.target.value})}><option value="agent">Atendente</option><option value="admin">Administrador</option></select></td>
      {columns.map(column=><td key={column.key} className="team-check-cell"><input type="checkbox" aria-label={`${column.label} — ${user.displayName}`} title={column.hint} disabled={!!saving || (user.role==="admin" && (column.key==="canSend" || column.key==="canAssign"))} checked={user.role==="admin" && (column.key==="canSend" || column.key==="canAssign") ? true : user[column.key]!==false} onChange={e=>edit(user.id,{[column.key]:e.target.checked})}/></td>)}
      <td><button className="team-save-button" disabled={!!saving} onClick={()=>save(user)}>{saving===user.id?"Salvando…":"Salvar"}</button></td>
    </tr>)}</tbody></table></div>
    <p className="team-table-note"><ShieldCheck size={16}/> Arraste horizontalmente em telas menores para ver todas as permissões.</p>
    </>}
  </>;
}
