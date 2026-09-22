"use client";
import {useState, type FormEvent} from "react";
import {ArrowLeft,KeyRound} from "lucide-react";
export function PasswordRecovery({baseUrl,initialUsername,back}:{baseUrl:string;initialUsername:string;back:()=>void}){
  const [username,setUsername]=useState(initialUsername);
  const [code,setCode]=useState("");
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [done,setDone]=useState(false);
  async function submit(event:FormEvent){
    event.preventDefault();setError("");
    if(password!==confirm){setError("As senhas precisam ser iguais.");return;}
    setBusy(true);
    try{
      const response=await fetch(`${baseUrl.replace(/\/$/,"")}/api/operator-auth/reset-password`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,code:code.trim(),password})});
      const data=await response.json();
      if(!response.ok)throw new Error(Array.isArray(data.message)?data.message.join(" "):data.message||"Não foi possível redefinir a senha.");
      setDone(true);setPassword("");setConfirm("");setCode("");
    }catch(e){setError(e instanceof Error?e.message:"Servidor indisponível. Tente novamente.");}
    finally{setBusy(false);}
  }
  return <main className="auth-page recovery-page"><section className="auth-form-area"><div className="auth-form">
    <button className="back-link" onClick={back} disabled={busy}><ArrowLeft size={18}/>Voltar ao login</button>
    <KeyRound size={32}/><h2>Recuperar acesso</h2>
    {done?<><p role="status">Senha atualizada! Entre com a nova senha. Os acessos anteriores desta conta foram encerrados.</p><button className="solid-button" onClick={back}>Ir para o login</button></>:
    <form onSubmit={submit}><p>Solicite um código ao responsável pelo computador onde o Docker está instalado.</p>
      <details className="recovery-help"><summary>Sou o responsável pelo servidor</summary><p>Na pasta do projeto, execute este comando no terminal:</p><code>docker compose exec openwa node scripts/recover-operator.cjs {/^[a-zA-Z0-9._-]{3,80}$/.test(username)?username:"SEU_USUARIO"}</code><p>O código vale por 15 minutos e só pode ser usado uma vez. Gerar outro invalida o anterior. Nenhum e-mail será enviado.</p></details>
      <label>Usuário<input required minLength={3} maxLength={80} pattern="[a-zA-Z0-9._-]+" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)}/></label>
      <label>Código de recuperação<input required minLength={32} maxLength={128} autoComplete="one-time-code" spellCheck={false} value={code} onChange={e=>setCode(e.target.value)}/></label>
      <label>Nova senha<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <label>Confirme a nova senha<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <button className="solid-button" disabled={busy}>{busy?"Salvando…":"Salvar nova senha"}</button>
    </form>}
  </div></section></main>;
}
