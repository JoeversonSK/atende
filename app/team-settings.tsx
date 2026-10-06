"use client";
import { useEffect, useState, type FormEvent } from "react";
import { operatorRequest } from "./atende-api";

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
  const [savingUsers,setSavingUsers]=useState<string[]>([]);
  const [savingRecipients,setSavingRecipients]=useState<string[]>([]);
  const [feedback,setFeedback]=useState("");
  const [error,setError]=useState("");
  const [newUsername,setNewUsername]=useState("");
  const [newDisplayName,setNewDisplayName]=useState("");
  const [newPassword,setNewPassword]=useState("");
  const [newPasswordConfirmation,setNewPasswordConfirmation]=useState("");
  const [creating,setCreating]=useState(false);
  async function api(path:string,body?:unknown) {
    const response=await operatorRequest(baseUrl,token,`/admin${path}`,{method:body===undefined?"GET":"PUT",...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await response.json();
    if(!response.ok) throw new Error(Array.isArray(data.message)?data.message.join(" "):data.message || "Não foi possível salvar.");
    return data;
  }
  useEffect(()=>{let live=true; setLoading(true); api("").then(data=>{if(live){setUsers(data.users);setRecipients(data.unassignedUserIds||[]);}}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[baseUrl,token]);
  async function createUser(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError("");setFeedback("");
    if(newPassword!==newPasswordConfirmation){setError("As senhas precisam ser iguais.");return;}
    setCreating(true);
    try{
      const response=await operatorRequest(baseUrl,token,"/admin/users",{
        method:"POST",
        body:JSON.stringify({username:newUsername,displayName:newDisplayName,password:newPassword}),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(Array.isArray(data.message)?data.message.join(" "):data.message||"Não foi possível criar a conta.");
      setUsers(current=>[...current,data]);
      setNewUsername("");setNewDisplayName("");setNewPassword("");setNewPasswordConfirmation("");
      setFeedback(`Conta de ${data.displayName} criada. A pessoa já pode entrar com a senha definida.`);
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível criar a conta.");}
    finally{setCreating(false);}
  }
  async function changeUser(user:Member,patch:Partial<Member>) {
    const next={...user,...patch};
    setSavingUsers(current=>[...current,user.id]);setError("");setFeedback("");
    setUsers(current=>current.map(item=>item.id===user.id?next:item));
    try {
      const updated=await api(`/users/${user.id}`,{role:next.role,active:next.active,canSend:next.canSend,canAssign:next.canAssign,dashboardVisible:next.dashboardVisible});
      setUsers(current=>current.map(item=>item.id===user.id?updated:item));
      if(!updated.active)setRecipients(current=>current.filter(id=>id!==user.id));
      setFeedback(`Permissões de ${updated.displayName} salvas.`);
    } catch(e){setUsers(current=>current.map(item=>item.id===user.id?user:item));setError(e instanceof Error?e.message:"Erro ao salvar.");}
    finally{setSavingUsers(current=>current.filter(id=>id!==user.id));}
  }
  async function changeRecipient(userId:string,checked:boolean){
    setSavingRecipients(current=>[...current,userId]);setError("");setFeedback("");
    setRecipients(current=>checked?[...current,userId]:current.filter(id=>id!==userId));
    try{await api(`/notifications/${userId}`,{enabled:checked});setFeedback("Destinatários das notificações atualizados.");}
    catch(e){setRecipients(current=>checked?current.filter(id=>id!==userId):[...new Set([...current,userId])]);setError(e instanceof Error?e.message:"Erro ao salvar.");}
    finally{setSavingRecipients(current=>current.filter(id=>id!==userId));}
  }
  return <><h2>Equipe e permissões</h2>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {feedback&&<p className="team-feedback" role="status">{feedback}</p>}
    <details className="team-create"><summary>Adicionar pessoa à equipe</summary>
      <form onSubmit={createUser} autoComplete="off">
        <label>Nome de exibição<input required maxLength={160} value={newDisplayName} onChange={e=>setNewDisplayName(e.target.value)} placeholder="Maria Silva · Atendimento"/></label>
        <label>Usuário<input required minLength={3} maxLength={80} pattern="[a-zA-Z0-9._-]+" autoCapitalize="none" value={newUsername} onChange={e=>setNewUsername(e.target.value)} placeholder="maria.silva"/></label>
        <label>Senha inicial<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label>
        <label>Confirme a senha<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={newPasswordConfirmation} onChange={e=>setNewPasswordConfirmation(e.target.value)}/></label>
        <p>A conta será criada como atendente ativo. Ajuste as permissões na tabela, se necessário.</p>
        <button className="solid-button" type="submit" disabled={creating}>{creating?"Criando…":"Criar conta"}</button>
      </form>
    </details>
    {loading?<p role="status">Carregando equipe…</p>:<>
    <div className="team-table-scroll"><table className="team-table"><thead><tr><th scope="col">Pessoa</th><th scope="col">Função</th>{columns.slice(0,1).map(column=><th key={column.key} scope="col" title={column.hint}>{column.label}</th>)}<th scope="col" title="Receber avisos de novas mensagens em conversas sem responsável">Notificar</th>{columns.slice(1).map(column=><th key={column.key} scope="col" title={column.hint}>{column.label}</th>)}</tr></thead><tbody>{users.map(user=><tr key={user.id} className={user.active?"":"team-row-inactive"}>
      <td><div className="team-person"><span className="preview-avatar" aria-hidden="true">{user.displayName.slice(0,1)}</span><span><b>{user.displayName}</b><small>@{user.username}</small></span></div></td>
      <td><select aria-label={`Função de ${user.displayName}`} value={user.role} disabled={savingUsers.includes(user.id)} onChange={e=>changeUser(user,{role:e.target.value})}><option value="agent">Atendente</option><option value="admin">Administrador</option></select></td>
      {columns.slice(0,1).map(column=><td key={column.key} className="team-check-cell"><input type="checkbox" aria-label={`${column.label} — ${user.displayName}`} title={column.hint} disabled={savingUsers.includes(user.id) || savingRecipients.includes(user.id)} checked={user[column.key]!==false} onChange={e=>changeUser(user,{[column.key]:e.target.checked})}/></td>)}
      <td className="team-check-cell"><input type="checkbox" aria-label={`Notificar — ${user.displayName}`} title="Avisar sobre novas mensagens sem responsável" disabled={savingUsers.includes(user.id) || savingRecipients.includes(user.id) || !user.active} checked={recipients.includes(user.id)} onChange={e=>changeRecipient(user.id,e.target.checked)}/></td>
      {columns.slice(1).map(column=><td key={column.key} className="team-check-cell"><input type="checkbox" aria-label={`${column.label} — ${user.displayName}`} title={column.hint} disabled={savingUsers.includes(user.id) || (user.role==="admin" && (column.key==="canSend" || column.key==="canAssign"))} checked={user.role==="admin" && (column.key==="canSend" || column.key==="canAssign") ? true : user[column.key]!==false} onChange={e=>changeUser(user,{[column.key]:e.target.checked})}/></td>)}
    </tr>)}</tbody></table></div>
    </>}
  </>;
}
