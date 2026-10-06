"use client";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { TeamSettings } from "./team-settings";
import { PasswordRecovery } from "./password-recovery";
import { FlowSettings } from "./flow-settings";
import { WebhookSettings } from "./webhook-settings";
import { AutomationSettings } from "./automation-settings";
import { QuickReplySettings } from "./quick-replies";
import { ArrowLeft, Bell, Clock3, Copy, Eye, EyeOff, GitBranch, LoaderCircle, LogOut, MessageCircle, Play, Plus, Smartphone, Trash2, UserRound, UsersRound, Volume2, Webhook, Workflow } from "lucide-react";

export function LoginScreen({ baseUrl, registering, setRegistering, username, setUsername, name, setName, password, setPassword, error, busy, submit }: any) {
  const [recovering,setRecovering] = useState(false);
  const [visible, setVisible] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [validation, setValidation] = useState("");
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (registering && password !== confirm) { setValidation("As senhas precisam ser iguais."); return; }
    setValidation(""); void submit();
  }
  if(recovering) return <PasswordRecovery baseUrl={baseUrl} initialUsername={username} back={()=>{setRecovering(false);setPassword("");setValidation("");}}/>;
  return <main className="auth-page">
    <section className="auth-story"><div className="brand"><MessageCircle size={26} /> atende<span>ESPAÇO DE TRABALHO</span></div><div><span className="eyebrow">MAIS PROXIMIDADE. MENOS ESPERA.</span><h1>Boas conversas.<br />Uma equipe<br /><em>conectada.</em></h1><p>Seu atendimento em um só lugar, com organização e espaço para cada pessoa da equipe.</p><div className="auth-preview"><div className="preview-avatar">A</div><div><b>Um atendimento com a sua identidade</b><p>Seu nome acompanha cada nova mensagem.</p></div><span className="status-dot" /></div></div><small>Atende · Central de atendimento</small></section>
    <section className="auth-form-area"><form className="auth-form" onSubmit={handleSubmit}><span className="eyebrow">SUA CONTA, SEU ATENDIMENTO</span><h2>{registering ? "Faça parte da equipe" : "Bom ter você por aqui"}</h2><p>{registering ? "Crie seu acesso e escolha como será identificado nas conversas." : "Entre na sua conta para continuar os atendimentos."}</p>
      {registering && <label>Nome de exibição<input required maxLength={160} autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Maria Silva · Atendimento" /></label>}
      <label>Usuário<input required minLength={3} maxLength={80} pattern="[a-zA-Z0-9._-]+" autoCapitalize="none" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="maria.silva" /></label>
      {registering && <small>Use letras sem acento, números, ponto, hífen ou sublinhado.</small>}
      <label>Senha<div className="password-field"><input required minLength={8} maxLength={128} type={visible ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Pelo menos 8 caracteres" /><button type="button" aria-label={visible ? "Ocultar senha" : "Mostrar senha"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
      {registering && <label>Confirme a senha<input required type={visible ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repita sua senha" /></label>}
      {!registering && <button type="button" className="back-link" disabled={busy} onClick={()=>{setPassword("");setRecovering(true);}}>Esqueci minha senha</button>}
      {(validation || error) && <p className="form-error" role="alert">{validation || error}</p>}
      <button className="solid-button" disabled={busy} type="submit">{busy && <LoaderCircle className="wa-spin" size={18} />}{busy ? "Aguarde…" : registering ? "Criar minha conta" : "Entrar no atendimento"}</button>
      <p className="auth-switch">{registering ? "Já tem uma conta?" : "Primeiro acesso?"} <button type="button" onClick={() => { setRegistering(!registering); setValidation(""); setConfirm(""); }}>{registering ? "Entrar" : "Criar conta"}</button></p>
    </form></section>
  </main>;
}

type WorkInterval={start:string;end:string};
type WorkDay={weekday:number;enabled:boolean;intervals:WorkInterval[]};
type OperationHours={enabled:boolean;days:WorkDay[];autoReplyEnabled:boolean;autoReplyMessage:string};
const weekNames=["Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado","Domingo"];
const shortWeekNames=["seg","ter","qua","qui","sex","sáb","dom"];
const initialHours=():OperationHours=>({enabled:true,days:weekNames.map((_,weekday)=>({weekday,enabled:weekday<6,intervals:[{start:"08:00",end:weekday===5?"12:00":"18:00"}]})),autoReplyEnabled:false,autoReplyMessage:""});

function OperationHoursSettings({baseUrl,token}:{baseUrl:string;token:string}){
  const [hours,setHours]=useState<OperationHours>(initialHours);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [feedback,setFeedback]=useState("");
  const endpoint=`${baseUrl.replace(/\/$/,"")}/api/operator-auth`;
  useEffect(()=>{let live=true;fetch(`${endpoint}/operation-hours`,{headers:{"X-Atende-Token":token}}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.message||"Não foi possível carregar os horários.");if(live)setHours(data);}).catch(error=>{if(live)setFeedback(error instanceof Error?error.message:"Não foi possível carregar os horários.");}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[endpoint,token]);
  const editDay=(weekday:number,change:(day:WorkDay)=>WorkDay)=>setHours(current=>({...current,days:current.days.map(day=>day.weekday===weekday?change(day):day)}));
  const editInterval=(weekday:number,index:number,patch:Partial<WorkInterval>)=>editDay(weekday,day=>({...day,intervals:day.intervals.map((interval,i)=>i===index?{...interval,...patch}:interval)}));
  const copyWeekdays=()=>setHours(current=>{const source=current.days[0];return {...current,days:current.days.map(day=>day.weekday>0&&day.weekday<5?{...day,enabled:source.enabled,intervals:source.intervals.map(interval=>({...interval}))}:day)};});
  async function save(){setSaving(true);setFeedback("");try{for(const day of hours.days.filter(day=>day.enabled))for(const interval of day.intervals)if(interval.start>=interval.end)throw new Error(`Revise o horário de ${weekNames[day.weekday]}.`);if(hours.autoReplyEnabled&&!hours.autoReplyMessage.trim())throw new Error("Escreva a mensagem automática para o horário fechado.");const response=await fetch(`${endpoint}/admin/operation-hours`,{method:"PUT",headers:{"Content-Type":"application/json","X-Atende-Token":token},body:JSON.stringify(hours)});const data=await response.json();if(!response.ok)throw new Error(Array.isArray(data.message)?data.message.join(" "):data.message||"Não foi possível salvar.");setHours(data);setFeedback("Horário de funcionamento salvo para toda a equipe.");}catch(error){setFeedback(error instanceof Error?error.message:"Não foi possível salvar.");}finally{setSaving(false);}}
  return <>
    <h2>Horário de funcionamento</h2>
    <p>Defina quando a equipe está disponível para atender seus clientes.</p>
    <div className="hours-layout">
      <section className="settings-card hours-card">
        <div className="profile-heading"><span className="settings-icon"><Clock3 size={24}/></span><div><h3>Funcionamento da central</h3><p>Configure os dias e períodos de atendimento.</p></div><label className="settings-switch"><input type="checkbox" checked={hours.enabled} onChange={event=>setHours(current=>({...current,enabled:event.target.checked}))}/><span/></label></div>
        {loading?<p>Carregando horários…</p>:<>
          <div className="weekday-pills">{hours.days.map(day=><button type="button" key={day.weekday} className={day.enabled?"active":""} onClick={()=>editDay(day.weekday,current=>({...current,enabled:!current.enabled}))}>{shortWeekNames[day.weekday]}</button>)}</div>
          <button type="button" className="copy-hours" onClick={copyWeekdays}>Copiar segunda-feira para os dias úteis</button>
          <div className="hours-list">{hours.days.map(day=><div className={`hours-row ${day.enabled&&hours.enabled?"":"disabled"}`} key={day.weekday}>
            <label className="day-toggle"><input type="checkbox" checked={day.enabled} disabled={!hours.enabled} onChange={event=>editDay(day.weekday,current=>({...current,enabled:event.target.checked}))}/><span>{weekNames[day.weekday]}</span></label>
            <div className="hours-periods">{day.enabled&&hours.enabled?day.intervals.map((interval,index)=><div className="hours-period" key={index}><input aria-label={`Início de ${weekNames[day.weekday]}`} type="time" value={interval.start} onChange={event=>editInterval(day.weekday,index,{start:event.target.value})}/><span>até</span><input aria-label={`Fim de ${weekNames[day.weekday]}`} type="time" value={interval.end} onChange={event=>editInterval(day.weekday,index,{end:event.target.value})}/>{day.intervals.length>1&&<button type="button" aria-label="Remover período" onClick={()=>editDay(day.weekday,current=>({...current,intervals:current.intervals.filter((_,i)=>i!==index)}))}><Trash2 size={17}/></button>}</div>):<span className="closed-day">Fechado</span>}</div>
            {day.enabled&&hours.enabled&&day.intervals.length<4&&<button type="button" className="add-period" title="Adicionar período" onClick={()=>editDay(day.weekday,current=>({...current,intervals:[...current.intervals,{start:"13:00",end:"18:00"}]}))}><Plus size={18}/></button>}
          </div>)}</div>
          <div className="hours-auto-reply"><label className="team-check"><input type="checkbox" checked={hours.autoReplyEnabled} disabled={!hours.enabled} onChange={event=>setHours(current=>({...current,autoReplyEnabled:event.target.checked}))}/><span>Responder automaticamente fora do horário</span></label><p>Envia uma resposta por cliente por dia, apenas quando a central estiver fechada. Não responde a grupos.</p><textarea aria-label="Mensagem automática fora do horário" maxLength={4000} rows={5} disabled={!hours.enabled} value={hours.autoReplyMessage} onChange={event=>setHours(current=>({...current,autoReplyMessage:event.target.value}))} placeholder="Olá! Recebemos sua mensagem fora do nosso horário de atendimento. Retornaremos assim que possível."/><small>{hours.autoReplyMessage.length}/4000 caracteres</small></div>
          <button className="solid-button" disabled={saving} onClick={()=>void save()}>{saving?"Salvando…":"Salvar funcionamento"}</button>
        </>}
      </section>
      <aside className="hours-help"><h3>Como funciona</h3><p>Esses horários ficam salvos no servidor e são iguais em todos os computadores.</p><p>Você pode adicionar até quatro períodos por dia, útil para intervalos de almoço.</p><strong>{hours.enabled?"Horário de atendimento ativo":"Controle de horário desativado"}</strong></aside>
    </div>
    {feedback&&<p className="settings-feedback" role="status">{feedback}</p>}
  </>;
}

function NotificationSoundControls({ notificationPreferences, updateNotificationPreferences, customSound, customSoundBusy, uploadNotificationSound, removeNotificationSound }: any) {
  return <div className="notification-sound-controls">
    <label>Som do alerta<select value={notificationPreferences.soundType} disabled={!notificationPreferences.sound} onChange={event => updateNotificationPreferences({ soundType: event.target.value })}>
      <option value="classic">Clássico</option><option value="soft">Suave</option><option value="bell">Campainha</option><option value="urgent">Chamado urgente</option>
      {(customSound || notificationPreferences.soundType === "custom") && <option value="custom">Meu áudio</option>}
    </select></label>
    <label className="notification-volume">Volume <b>{notificationPreferences.volume}%</b><input type="range" min="0" max="100" step="5" disabled={!notificationPreferences.sound} value={notificationPreferences.volume} style={{ "--volume-percent": `${notificationPreferences.volume}%` } as CSSProperties} onChange={event => updateNotificationPreferences({ volume: Number(event.target.value) })}/></label>
    <div className="custom-sound-control">
      <label>Áudio personalizado<input type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/mp4,audio/aac" disabled={customSoundBusy} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadNotificationSound(file); event.target.value = ""; }}/></label>
      <small>MP3, WAV, OGG ou outro áudio compatível, até 2 MB. Fica salvo na sua conta.</small>
      {customSound && <div className="custom-sound-preview"><span title={customSound.filename}>{customSound.filename}</span><audio controls preload="none" src={`data:${customSound.mimetype};base64,${customSound.base64}`}/><button type="button" disabled={customSoundBusy} onClick={() => void removeNotificationSound()}>Remover áudio</button></div>}
    </div>
  </div>;
}

export function SettingsScreen({ token, user, name, setName, saveName, logout, config, connect, busy, qr, createSession, notificationsEnabled, enableNotifications, notificationPreferences, updateNotificationPreferences, customSound, customSoundBusy, uploadNotificationSound, removeNotificationSound, testNotification, notice, close }: any) {
  const [tab,setTab]=useState(user?.role==="admin"?"hours":"profile");
  const [connection,setConnection]=useState(config);
  const [saving,setSaving]=useState(false);
  const [keyVisible,setKeyVisible]=useState(false);
  const [copyFeedback,setCopyFeedback]=useState("");
  async function copyKey(){try{await navigator.clipboard.writeText(connection.apiKey);setCopyFeedback("Chave copiada. Não compartilhe com terceiros.");}catch{setCopyFeedback("Não foi possível copiar automaticamente. Selecione a chave e use Ctrl+C.");}}
  async function saveProfile(event:FormEvent){event.preventDefault();setSaving(true);try{await saveName();}finally{setSaving(false);}}
  const secureContext=typeof window!=="undefined"&&window.isSecureContext;
  const entries=[["profile","Meu perfil",UserRound],["notifications","Notificações",Bell],...(user?.role==="admin"?[["hours","Funcionamento",Clock3],["quickReplies","Mensagens rápidas",MessageCircle],["flows","Fluxos de conversa",GitBranch],["automations","Automações",Workflow],["webhooks","Webhooks",Webhook],["team","Equipe e permissões",UsersRound],["connection","Conexão WhatsApp",Smartphone]]:[])] as any[];
  return <section className="settings-page" aria-label="Configurações"><header className="settings-topbar"><button onClick={close}><ArrowLeft size={19}/>Conversas</button><div><span className="preview-avatar">{user?.displayName?.slice(0,1)}</span><b>{user?.displayName}</b></div></header><div className="settings-layout"><aside className="settings-nav"><small>CONFIGURAÇÕES</small><nav>{entries.map(([key,label,Icon])=><button key={key} className={tab===key?"active":""} onClick={()=>{setTab(key);setKeyVisible(false);setCopyFeedback("");}}><Icon size={18}/>{label}</button>)}</nav><div className="settings-user"><span className="preview-avatar">{user?.displayName?.slice(0,1)}</span><div><b>{user?.displayName}</b><small>@{user?.username}</small></div></div><button className="back-link" onClick={logout}><LogOut size={17}/>Sair da conta</button></aside><main className="settings-content">
    {tab==="hours"&&user?.role==="admin"&&<OperationHoursSettings baseUrl={config.baseUrl} token={token}/>}
    {tab==="quickReplies"&&user?.role==="admin"&&<QuickReplySettings baseUrl={config.baseUrl} token={token}/>}
    {tab==="flows"&&user?.role==="admin"&&<FlowSettings baseUrl={config.baseUrl} token={token}/>}
    {tab==="webhooks"&&user?.role==="admin"&&<WebhookSettings baseUrl={config.baseUrl} token={token}/>}
    {tab==="automations"&&user?.role==="admin"&&<AutomationSettings baseUrl={config.baseUrl} token={token}/>}
    {tab==="profile"&&<><h2>Meu perfil</h2><p>Como você aparece para a equipe e para seus clientes.</p><form className="settings-card" onSubmit={saveProfile}><div className="profile-heading"><span className="profile-circle">{name?.slice(0,1)||"A"}</span><div><h3>Sua identidade</h3><p>O nome abaixo assina suas novas mensagens.</p></div></div><label>Nome de exibição<input required maxLength={160} value={name} onChange={event=>setName(event.target.value)}/></label><label>Usuário<input readOnly value={user?.username||""}/></label><small>Seu usuário de acesso permanece o mesmo.</small><button className="solid-button" disabled={saving}>{saving?"Salvando…":"Salvar alterações"}</button></form></>}
    {tab==="notifications"&&<><h2>Notificações</h2><p>Personalize os avisos da sua conta.</p><div className="notification-settings-grid"><div className="settings-card"><div className="profile-heading"><Bell size={28}/><div><h3>Alertas neste navegador</h3><p>{notificationsEnabled?"Notificações ativadas e preferências salvas.":secureContext?"Conexão segura. Ative para receber cada nova mensagem.":"Este endereço não permite notificações fora do sistema."}</p></div><label className="settings-switch"><input type="checkbox" checked={notificationsEnabled} onChange={event=>event.target.checked?void enableNotifications():updateNotificationPreferences({enabled:false})}/><span/></label></div><p>Cada mensagem recebida gera um aviso independente. O áudio personalizado acompanha sua conta; as demais preferências ficam neste navegador.</p>{secureContext?<div className="notification-actions"><button className="solid-button" onClick={enableNotifications}>{notificationsEnabled?"Reativar permissão":"Ativar notificações"}</button><button onClick={testNotification}><Play size={16}/>Testar agora</button></div>:<div className="https-notification-help"><strong>Use o endereço seguro neste computador</strong><p>Instale o certificado uma única vez e depois acesse <b>https://suporte-5</b>.</p><div><a href="/atende-local-ca.crt" download>Baixar certificado</a><a href="/COMO-ATIVAR-NOTIFICACOES.txt" download>Baixar instruções</a></div></div>}</div>
    <div className="settings-card notification-preferences"><div className="profile-heading"><Volume2 size={26}/><div><h3>Tipos de aviso</h3><p>Escolha o que deve gerar som e notificação.</p></div></div><div className="notification-toggles"><label><input type="checkbox" checked={notificationPreferences.notifyMessages} onChange={event=>updateNotificationPreferences({notifyMessages:event.target.checked})}/><span><b>Novas mensagens</b><small>Avisar em todas as mensagens recebidas.</small></span></label><label><input type="checkbox" checked={notificationPreferences.notifyAssignments} onChange={event=>updateNotificationPreferences({notifyAssignments:event.target.checked})}/><span><b>Atendimentos encaminhados</b><small>Avisar quando outro atendente encaminhar uma conversa.</small></span></label><label><input type="checkbox" checked={notificationPreferences.desktop} onChange={event=>updateNotificationPreferences({desktop:event.target.checked})}/><span><b>Notificação do Windows</b><small>Mostrar o aviso mesmo fora da página.</small></span></label><label><input type="checkbox" checked={notificationPreferences.sound} onChange={event=>updateNotificationPreferences({sound:event.target.checked})}/><span><b>Som</b><small>Reproduzir um alerta junto da notificação.</small></span></label><label><input type="checkbox" checked={notificationPreferences.showPreview} onChange={event=>updateNotificationPreferences({showPreview:event.target.checked})}/><span><b>Mostrar mensagem</b><small>Exibir o conteúdo recebido no aviso.</small></span></label></div><NotificationSoundControls notificationPreferences={notificationPreferences} updateNotificationPreferences={updateNotificationPreferences} customSound={customSound} customSoundBusy={customSoundBusy} uploadNotificationSound={uploadNotificationSound} removeNotificationSound={removeNotificationSound}/></div></div></>}
    {tab==="team"&&user?.role==="admin"&&<TeamSettings baseUrl={config.baseUrl} token={token}/>}
    {tab==="connection"&&user?.role==="admin"&&<><h2>Conexão WhatsApp</h2><p>Configure o serviço usado pela central de atendimento.</p><form className="settings-card" onSubmit={event=>{event.preventDefault();void connect(connection);}}><h3>Configuração de conexão</h3><label>Endereço do serviço<input required type="url" value={connection.baseUrl} onChange={event=>setConnection({...connection,baseUrl:event.target.value})}/></label><label htmlFor="connection-api-key">Chave de acesso</label><div className="api-key-control"><input id="connection-api-key" required type={keyVisible?"text":"password"} autoComplete="off" spellCheck={false} autoCapitalize="none" value={connection.apiKey} onChange={event=>{setConnection({...connection,apiKey:event.target.value});setCopyFeedback("");}}/><button type="button" aria-label={keyVisible?"Ocultar chave":"Mostrar chave"} onClick={()=>setKeyVisible(!keyVisible)}>{keyVisible?<EyeOff size={18}/>:<Eye size={18}/>}</button><button type="button" disabled={!connection.apiKey} onClick={()=>void copyKey()}><Copy size={18}/><span>Copiar</span></button></div><small role="status">{copyFeedback||"A chave fica oculta por segurança. Use o olho para visualizar."}</small><label>Sessão<input value={connection.sessionId} onChange={event=>setConnection({...connection,sessionId:event.target.value})} placeholder="Deixe vazio para localizar a sessão"/></label><small>A configuração é salva neste navegador.</small><button className="solid-button" disabled={busy}>{busy?"Conectando…":"Salvar e conectar"}</button>{config.apiKey&&!config.sessionId&&<button type="button" className="back-link" onClick={createSession} disabled={busy}>Criar sessão e gerar QR Code</button>}{qr&&<div className="wa-qr"><img src={qr.startsWith("data:")?qr:`data:image/png;base64,${qr}`} alt="QR Code para conectar o WhatsApp"/></div>}</form></>}
    <p className="settings-feedback" role="status">{notice}</p></main></div></section>;
}
