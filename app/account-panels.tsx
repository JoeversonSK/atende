"use client";
import { useEffect, useState, type CSSProperties, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { errorMessage, operatorRequest, type ApiConfig } from "./atende-api";
import type { OperatorIdentity } from "./operator-activity";
import type { NotificationPreferences } from "./conversations/workspace-storage";
import { TeamSettings } from "./team-settings";
import { PasswordRecovery } from "./password-recovery";
import { FlowSettings } from "./flow-settings";
import { WebhookSettings } from "./webhook-settings";
import { AutomationSettings } from "./automation-settings";
import { QuickReplySettings } from "./quick-replies";
import { ArrowLeft, Bell, Clock3, Copy, Eye, EyeOff, GitBranch, LoaderCircle, LogOut, MessageCircle, Music2, Play, Plus, Smartphone, Trash2, UserRound, UsersRound, Webhook, Workflow, type LucideIcon } from "lucide-react";

type LoginProps = {
  baseUrl: string; registering: boolean; setRegistering: (value: boolean) => void;
  username: string; setUsername: Dispatch<SetStateAction<string>>;
  name: string; setName: Dispatch<SetStateAction<string>>;
  password: string; setPassword: Dispatch<SetStateAction<string>>;
  error: string; busy: boolean; submit: () => Promise<void>;
};
type CustomSound = { filename: string; mimetype: string; base64: string };
type SoundControlsProps = {
  notificationPreferences: NotificationPreferences;
  updateNotificationPreferences: (patch: Partial<NotificationPreferences>) => void;
  customSound: CustomSound | null; customSoundBusy: boolean;
  uploadNotificationSound: (file: File) => Promise<void>;
  removeNotificationSound: () => Promise<void>;
};
type SettingsProps = SoundControlsProps & {
  token: string; user: OperatorIdentity; name: string;
  setName: Dispatch<SetStateAction<string>>; saveName: () => Promise<void>;
  logout: () => Promise<void>; config: ApiConfig; connect: (config?: ApiConfig) => Promise<void>;
  busy: boolean; qr: string | null; createSession: () => Promise<void>;
  notificationsEnabled: boolean; enableNotifications: () => Promise<void>;
  testNotification: () => Promise<void>; notice: string; close: () => void;
};

export function LoginScreen({ baseUrl, registering, setRegistering, username, setUsername, name, setName, password, setPassword, error, busy, submit }: LoginProps) {
  const [recovering,setRecovering] = useState(false);
  const [visible, setVisible] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [validation, setValidation] = useState("");
  const [registrationOpen,setRegistrationOpen] = useState(false);
  useEffect(()=>{
    let live=true;
    operatorRequest(baseUrl,null,"/registration-status")
      .then(async response=>{if(!response.ok)throw new Error("Não foi possível consultar o cadastro.");return response.json() as Promise<{registrationOpen?:boolean}>;})
      .then(data=>{if(live){setRegistrationOpen(data.registrationOpen===true);if(!data.registrationOpen)setRegistering(false);}})
      .catch(()=>{if(live){setRegistrationOpen(false);setRegistering(false);}});
    return()=>{live=false;};
  },[baseUrl,setRegistering]);
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
      {registrationOpen && <p className="auth-switch">{registering ? "Já tem uma conta?" : "Primeiro acesso?"} <button type="button" onClick={() => { setRegistering(!registering); setValidation(""); setConfirm(""); }}>{registering ? "Entrar" : "Criar conta"}</button></p>}
    </form></section>
  </main>;
}

type WorkInterval={start:string;end:string};
type WorkDay={weekday:number;enabled:boolean;intervals:WorkInterval[]};
type OperationHours={enabled:boolean;days:WorkDay[];autoReplyEnabled:boolean;autoReplyMessage:string};
const weekNames=["Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado","Domingo"];
const initialHours=():OperationHours=>({enabled:true,days:weekNames.map((_,weekday)=>({weekday,enabled:weekday<6,intervals:[{start:"08:00",end:weekday===5?"12:00":"18:00"}]})),autoReplyEnabled:false,autoReplyMessage:""});

function OperationHoursSettings({baseUrl,token}:{baseUrl:string;token:string}){
  const [hours,setHours]=useState<OperationHours>(initialHours);
  const [savedHours,setSavedHours]=useState<OperationHours|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [feedback,setFeedback]=useState("");
  const [clock,setClock]=useState(()=>Date.now());
  useEffect(()=>{let live=true;operatorRequest(baseUrl,token,"/operation-hours").then(async response=>{const data=await response.json() as OperationHours;if(!response.ok)throw new Error(errorMessage(data));if(live){setHours(data);setSavedHours(data);}}).catch(error=>{if(live)setFeedback(error instanceof Error?error.message:"Não foi possível carregar os horários.");}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[baseUrl,token]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),60_000);return()=>clearInterval(timer);},[]);
  const editDay=(weekday:number,change:(day:WorkDay)=>WorkDay)=>setHours(current=>({...current,days:current.days.map(day=>day.weekday===weekday?change(day):day)}));
  const editInterval=(weekday:number,index:number,patch:Partial<WorkInterval>)=>editDay(weekday,day=>({...day,intervals:day.intervals.map((interval,i)=>i===index?{...interval,...patch}:interval)}));
  const copyWeekdays=()=>setHours(current=>{const source=current.days[0];return {...current,days:current.days.map(day=>day.weekday>0&&day.weekday<5?{...day,enabled:source.enabled,intervals:source.intervals.map(interval=>({...interval}))}:day)};});
  const invalidIntervals=new Set<string>();
  for(const day of hours.days.filter(day=>hours.enabled&&day.enabled)){
    if(!day.intervals.length)invalidIntervals.add(`${day.weekday}-empty`);
    day.intervals.forEach((interval,index)=>{
      if(!/^\d{2}:\d{2}$/.test(interval.start)||!/^\d{2}:\d{2}$/.test(interval.end)||interval.start>=interval.end)
        invalidIntervals.add(`${day.weekday}-${index}`);
      if(day.intervals.some((other,otherIndex)=>otherIndex!==index&&interval.start<other.end&&other.start<interval.end))
        invalidIntervals.add(`${day.weekday}-${index}`);
    });
  }
  const weekday=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",weekday:"short"}).format(new Date(clock));
  const today=hours.days[["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(weekday)];
  const time=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(clock));
  const openNow=hours.enabled&&today?.enabled&&today.intervals.some(interval=>interval.start<=time&&time<interval.end);
  const missingReply=hours.enabled&&hours.autoReplyEnabled&&!hours.autoReplyMessage.trim();
  const dirty=savedHours!==null&&JSON.stringify(hours)!==JSON.stringify(savedHours);
  const saveBlocked=loading||saving||!dirty||invalidIntervals.size>0||missingReply;
  async function save(){setSaving(true);setFeedback("");try{if(invalidIntervals.size)throw new Error("Corrija os horários destacados antes de salvar.");if(missingReply)throw new Error("Escreva a mensagem automática para o horário fechado.");const response=await operatorRequest(baseUrl,token,"/admin/operation-hours",{method:"PUT",body:JSON.stringify(hours)});const data=await response.json() as OperationHours;if(!response.ok)throw new Error(errorMessage(data));setHours(data);setSavedHours(data);setFeedback("Horário de funcionamento salvo para toda a equipe.");}catch(error){setFeedback(error instanceof Error?error.message:"Não foi possível salvar.");}finally{setSaving(false);}}
  return <>
    <h2>Horário de funcionamento</h2>
    <p>Defina quando a equipe está disponível para atender seus clientes.</p>
    <div className="hours-layout">
      <div className="hours-main">
        <section className="settings-card hours-card">
          <div className="hours-card-heading"><div><h3>Funcionamento da central</h3><p>Marque os dias e defina os períodos de atendimento.</p></div><label className="settings-switch" aria-label="Ativar funcionamento da central"><input type="checkbox" checked={hours.enabled} onChange={event=>setHours(current=>({...current,enabled:event.target.checked}))}/><span/></label></div>
          {loading?<p>Carregando horários…</p>:<>
            <div className="hours-card-guide"><span>Até 4 períodos por dia, útil para intervalos de almoço.</span><button type="button" className="copy-hours" onClick={copyWeekdays}>Copiar segunda para os dias úteis</button></div>
            <div className="hours-list">{hours.days.map(day=><div className={`hours-row ${day.enabled&&hours.enabled?"":"disabled"}`} key={day.weekday}>
              <label className="hours-day-toggle"><input type="checkbox" checked={day.enabled} disabled={!hours.enabled} onChange={event=>editDay(day.weekday,current=>({...current,enabled:event.target.checked}))}/><span className="hours-toggle-track"/><b>{weekNames[day.weekday]}</b></label>
              <div className="hours-periods">{day.enabled?day.intervals.map((interval,index)=><div className="hours-period" key={index}><input className={invalidIntervals.has(`${day.weekday}-${index}`)?"invalid":""} aria-invalid={invalidIntervals.has(`${day.weekday}-${index}`)} aria-label={`Início de ${weekNames[day.weekday]}, período ${index+1}`} type="time" disabled={!hours.enabled} value={interval.start} onChange={event=>editInterval(day.weekday,index,{start:event.target.value})}/><span>até</span><input className={invalidIntervals.has(`${day.weekday}-${index}`)?"invalid":""} aria-invalid={invalidIntervals.has(`${day.weekday}-${index}`)} aria-label={`Fim de ${weekNames[day.weekday]}, período ${index+1}`} type="time" disabled={!hours.enabled} value={interval.end} onChange={event=>editInterval(day.weekday,index,{end:event.target.value})}/>{day.intervals.length>1&&<button type="button" className="remove-period" aria-label={`Remover período ${index+1} de ${weekNames[day.weekday]}`} disabled={!hours.enabled} onClick={()=>editDay(day.weekday,current=>({...current,intervals:current.intervals.filter((_,i)=>i!==index)}))}>×</button>}{index===day.intervals.length-1&&day.intervals.length<4&&<button type="button" className="add-period" aria-label={`Adicionar período em ${weekNames[day.weekday]}`} disabled={!hours.enabled} onClick={()=>editDay(day.weekday,current=>({...current,intervals:[...current.intervals,{start:current.intervals.at(-1)?.end||"",end:""}]}))}><Plus size={17}/></button>}</div>):<span className="closed-day">Fechado</span>}{day.enabled&&!day.intervals.length&&<button type="button" className="add-period" disabled={!hours.enabled} onClick={()=>editDay(day.weekday,current=>({...current,intervals:[{start:"",end:""}]}))}>Adicionar período</button>}</div>
            </div>)}</div>
          </>}
        </section>
        <section className="settings-card hours-auto-reply"><div className="hours-reply-heading"><div><h3>Resposta fora do horário</h3><p>Uma resposta por cliente por dia, só quando a central estiver fechada. Não responde a grupos.</p></div><label className="settings-switch" aria-label="Ativar resposta fora do horário"><input type="checkbox" checked={hours.autoReplyEnabled} disabled={!hours.enabled} onChange={event=>setHours(current=>({...current,autoReplyEnabled:event.target.checked}))}/><span/></label></div><textarea aria-label="Mensagem automática fora do horário" maxLength={4000} rows={4} disabled={!hours.enabled||!hours.autoReplyEnabled} value={hours.autoReplyMessage} onChange={event=>setHours(current=>({...current,autoReplyMessage:event.target.value}))} placeholder="Olá! Recebemos sua mensagem fora do nosso horário de atendimento. Retornaremos assim que possível."/><div className="hours-reply-foot"><span>As quebras de linha são mantidas.</span><span>{hours.autoReplyMessage.length}/4000</span></div></section>
        <div className="hours-save-bar"><span>{loading?"Carregando horários…":savedHours===null?"Não foi possível carregar os horários":invalidIntervals.size?"Corrija os horários destacados":missingReply?"Escreva a resposta fora do horário":dirty?"Alterações não salvas":"Nenhuma alteração"}</span><button type="button" className="solid-button" disabled={saveBlocked} onClick={()=>void save()}>{saving?"Salvando…":"Salvar funcionamento"}</button></div>
      </div>
      <aside className="hours-help"><div className={`hours-status ${openNow?"open":""}`}><span className="status-dot"/>{!hours.enabled?"Controle desativado":openNow?"Aberta agora":"Fechada agora"}</div><ul><li>Os horários ficam salvos no servidor e valem para todos os computadores.</li><li>Dias desmarcados aparecem como fechados.</li><li>Com a resposta fora do horário ligada, clientes que chamarem com a central fechada recebem a mensagem.</li></ul></aside>
    </div>
    {feedback&&<p className="settings-feedback" role="status">{feedback}</p>}
  </>;
}

function NotificationSoundControls({ notificationPreferences, updateNotificationPreferences, customSound, customSoundBusy, uploadNotificationSound, removeNotificationSound }: SoundControlsProps) {
  return <div className="notification-sound-controls">
    <h4>Som do alerta</h4>
    <div className="notification-sound-row"><label>Tom<select value={notificationPreferences.soundType} disabled={!notificationPreferences.sound} onChange={event => updateNotificationPreferences({ soundType: event.target.value as NotificationPreferences["soundType"] })}>
      <option value="classic">Clássico</option><option value="soft">Suave</option><option value="bell">Campainha</option><option value="urgent">Chamado urgente</option>
      {(customSound || notificationPreferences.soundType === "custom") && <option value="custom">Meu áudio</option>}
    </select></label>
    <label className="notification-volume">Volume <span className="notification-volume-row"><input type="range" min="0" max="100" step="5" disabled={!notificationPreferences.sound} value={notificationPreferences.volume} style={{ "--volume-percent": `${notificationPreferences.volume}%` } as CSSProperties} onChange={event => updateNotificationPreferences({ volume: Number(event.target.value) })}/><output>{notificationPreferences.volume}%</output></span></label></div>
    <div className="custom-sound-control">
      <h4>Áudio personalizado</h4>
      <label className="custom-sound-upload"><span className="custom-sound-upload-icon"><Music2 size={18}/></span><span><b>{customSoundBusy ? "Enviando áudio…" : "Escolher arquivo de áudio"}</b><small>MP3, WAV, OGG ou outro compatível, até 2 MB. Fica salvo na conta.</small></span><input type="file" aria-label="Escolher arquivo de áudio personalizado" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/mp4,audio/aac" disabled={customSoundBusy} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadNotificationSound(file); event.target.value = ""; }}/></label>
      {customSound && <div className="custom-sound-preview"><span title={customSound.filename}>{customSound.filename}</span><audio controls preload="none" src={`data:${customSound.mimetype};base64,${customSound.base64}`}/><button type="button" disabled={customSoundBusy} onClick={() => void removeNotificationSound()}>Remover áudio</button></div>}
    </div>
    <small className="notification-saved-state">Preferências salvas neste navegador.</small>
  </div>;
}

function NotificationToggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="notification-toggle-row"><span className="notification-toggle-copy"><b>{title}</b><small>{description}</small></span><input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)}/><span className="notification-toggle-track" aria-hidden="true"/></label>;
}

function NotificationSettings({ notificationsEnabled, enableNotifications, testNotification, secureContext, notificationPreferences, updateNotificationPreferences, customSound, customSoundBusy, uploadNotificationSound, removeNotificationSound }: SoundControlsProps & Pick<SettingsProps, "notificationsEnabled" | "enableNotifications" | "testNotification"> & { secureContext: boolean }) {
  return <div className="notification-settings"><h2>Notificações</h2><p>Personalize os avisos da sua conta.</p>
    <div className="notification-settings-grid"><section className="settings-card notification-browser-card">
      <div className="notification-card-heading"><div><h3>Alertas neste navegador</h3><p>Receba avisos mesmo com outra aba aberta.</p></div><label className="settings-switch notification-master-switch"><input type="checkbox" aria-label="Ativar alertas neste navegador" checked={notificationsEnabled} onChange={event => event.target.checked ? void enableNotifications() : updateNotificationPreferences({ enabled: false })}/><span/></label></div>
      <div className={`notification-status${notificationsEnabled ? " is-active" : ""}`} role="status"><span/>{notificationsEnabled ? "Notificações ativadas" : secureContext ? "Notificações desativadas" : "Este endereço não permite notificações fora do sistema"}</div>
      <p className="notification-browser-description">Cada mensagem recebida gera um aviso independente. O áudio personalizado acompanha sua conta; as demais preferências ficam neste navegador.</p>
      {secureContext ? <div className="notification-actions"><button className="solid-button" type="button" onClick={enableNotifications}>{notificationsEnabled ? "Reativar permissão" : "Ativar notificações"}</button><button type="button" onClick={testNotification}><Play size={16}/>Testar agora</button></div> : <div className="https-notification-help"><strong>Use o endereço seguro neste computador</strong><p>Instale o certificado uma única vez e depois acesse <b>https://suporte-5</b>.</p><div><a href="/atende-local-ca.crt" download>Baixar certificado</a><a href="/COMO-ATIVAR-NOTIFICACOES.txt" download>Baixar instruções</a></div></div>}
    </section>
    <section className="settings-card notification-preferences"><div className="notification-card-heading"><div><h3>Tipos de aviso</h3><p>Escolha o que deve gerar som e notificação.</p></div></div>
      <div className="notification-toggles">
        <NotificationToggle title="Novas mensagens" description="Avisar em todas as mensagens recebidas." checked={notificationPreferences.notifyMessages} onChange={checked => updateNotificationPreferences({ notifyMessages: checked })}/>
        <NotificationToggle title="Atendimentos encaminhados" description="Avisar quando outro atendente encaminhar uma conversa." checked={notificationPreferences.notifyAssignments} onChange={checked => updateNotificationPreferences({ notifyAssignments: checked })}/>
        <NotificationToggle title="Notificação do Windows" description="Mostrar o aviso mesmo fora da página." checked={notificationPreferences.desktop} onChange={checked => updateNotificationPreferences({ desktop: checked })}/>
        <NotificationToggle title="Mostrar mensagem" description="Exibir o conteúdo recebido no aviso." checked={notificationPreferences.showPreview} onChange={checked => updateNotificationPreferences({ showPreview: checked })}/>
        <NotificationToggle title="Som" description="Reproduzir um alerta junto da notificação." checked={notificationPreferences.sound} onChange={checked => updateNotificationPreferences({ sound: checked })}/>
      </div>
      <NotificationSoundControls notificationPreferences={notificationPreferences} updateNotificationPreferences={updateNotificationPreferences} customSound={customSound} customSoundBusy={customSoundBusy} uploadNotificationSound={uploadNotificationSound} removeNotificationSound={removeNotificationSound}/>
    </section></div>
  </div>;
}

export function SettingsScreen({ token, user, name, setName, saveName, logout, config, connect, busy, qr, createSession, notificationsEnabled, enableNotifications, notificationPreferences, updateNotificationPreferences, customSound, customSoundBusy, uploadNotificationSound, removeNotificationSound, testNotification, notice, close }: SettingsProps) {
  const [tab,setTab]=useState(user?.role==="admin"?"hours":"profile");
  const [connection,setConnection]=useState(config);
  const [saving,setSaving]=useState(false);
  const [keyVisible,setKeyVisible]=useState(false);
  const [copyFeedback,setCopyFeedback]=useState("");
  async function copyKey(){try{await navigator.clipboard.writeText(connection.apiKey);setCopyFeedback("Chave copiada. Não compartilhe com terceiros.");}catch{setCopyFeedback("Não foi possível copiar automaticamente. Selecione a chave e use Ctrl+C.");}}
  async function saveProfile(event:FormEvent){event.preventDefault();setSaving(true);try{await saveName();}finally{setSaving(false);}}
  const secureContext=typeof window!=="undefined"&&window.isSecureContext;
  const entries: Array<[string,string,LucideIcon]>=[["profile","Meu perfil",UserRound],["notifications","Notificações",Bell],...(user?.role==="admin"?[["hours","Funcionamento",Clock3],["quickReplies","Mensagens rápidas",MessageCircle],["flows","Fluxos de conversa",GitBranch],["automations","Automações",Workflow],["webhooks","Webhooks",Webhook],["team","Equipe e permissões",UsersRound],["connection","Conexão WhatsApp",Smartphone]] as Array<[string,string,LucideIcon]>:[])];
  return <section className="settings-page" aria-label="Configurações"><header className="settings-topbar"><button onClick={close}><ArrowLeft size={19}/>Conversas</button><div><span className="preview-avatar">{user?.displayName?.slice(0,1)}</span><b>{user?.displayName}</b></div></header><div className="settings-layout"><aside className="settings-nav"><small>CONFIGURAÇÕES</small><nav>{entries.map(([key,label,Icon])=><button key={key} className={tab===key?"active":""} onClick={()=>{setTab(key);setKeyVisible(false);setCopyFeedback("");}}><Icon size={18}/>{label}</button>)}</nav><div className="settings-user"><span className="preview-avatar">{user?.displayName?.slice(0,1)}</span><div><b>{user?.displayName}</b><small>@{user?.username}</small></div></div><button className="back-link" onClick={logout}><LogOut size={17}/>Sair da conta</button></aside><main className="settings-content">
    {tab==="hours"&&user?.role==="admin"&&<OperationHoursSettings baseUrl={config.baseUrl} token={token}/>}
    {tab==="quickReplies"&&user?.role==="admin"&&<QuickReplySettings baseUrl={config.baseUrl} token={token}/>}
    {tab==="flows"&&user?.role==="admin"&&<FlowSettings baseUrl={config.baseUrl} token={token}/>}
    {tab==="webhooks"&&user?.role==="admin"&&<WebhookSettings baseUrl={config.baseUrl} token={token}/>}
    {tab==="automations"&&user?.role==="admin"&&<AutomationSettings baseUrl={config.baseUrl} token={token}/>}
    {tab==="profile"&&<><h2>Meu perfil</h2><p>Como você aparece para a equipe e para seus clientes.</p><form className="settings-card" onSubmit={saveProfile}><div className="profile-heading"><span className="profile-circle">{name?.slice(0,1)||"A"}</span><div><h3>Sua identidade</h3><p>O nome abaixo assina suas novas mensagens.</p></div></div><label>Nome de exibição<input required maxLength={160} value={name} onChange={event=>setName(event.target.value)}/></label><label>Usuário<input readOnly value={user?.username||""}/></label><small>Seu usuário de acesso permanece o mesmo.</small><button className="solid-button" disabled={saving}>{saving?"Salvando…":"Salvar alterações"}</button></form></>}
    {tab==="notifications"&&<NotificationSettings notificationsEnabled={notificationsEnabled} enableNotifications={enableNotifications} testNotification={testNotification} secureContext={secureContext} notificationPreferences={notificationPreferences} updateNotificationPreferences={updateNotificationPreferences} customSound={customSound} customSoundBusy={customSoundBusy} uploadNotificationSound={uploadNotificationSound} removeNotificationSound={removeNotificationSound}/>}
    {tab==="team"&&user?.role==="admin"&&<TeamSettings baseUrl={config.baseUrl} token={token}/>}
    {tab==="connection"&&user?.role==="admin"&&<><h2>Conexão WhatsApp</h2><p>Configure o serviço usado pela central de atendimento.</p><form className="settings-card" onSubmit={event=>{event.preventDefault();void connect(connection);}}><h3>Configuração de conexão</h3><label>Endereço do serviço<input required type="url" value={connection.baseUrl} onChange={event=>setConnection({...connection,baseUrl:event.target.value})}/></label><label htmlFor="connection-api-key">Chave de acesso</label><div className="api-key-control"><input id="connection-api-key" required type={keyVisible?"text":"password"} autoComplete="off" spellCheck={false} autoCapitalize="none" value={connection.apiKey} onChange={event=>{setConnection({...connection,apiKey:event.target.value});setCopyFeedback("");}}/><button type="button" aria-label={keyVisible?"Ocultar chave":"Mostrar chave"} onClick={()=>setKeyVisible(!keyVisible)}>{keyVisible?<EyeOff size={18}/>:<Eye size={18}/>}</button><button type="button" disabled={!connection.apiKey} onClick={()=>void copyKey()}><Copy size={18}/><span>Copiar</span></button></div><small role="status">{copyFeedback||"A chave fica oculta por segurança. Use o olho para visualizar."}</small><label>Sessão<input value={connection.sessionId} onChange={event=>setConnection({...connection,sessionId:event.target.value})} placeholder="Deixe vazio para localizar a sessão"/></label><small>A configuração é salva neste navegador.</small><button className="solid-button" disabled={busy}>{busy?"Conectando…":"Salvar e conectar"}</button>{config.apiKey&&!config.sessionId&&<button type="button" className="back-link" onClick={createSession} disabled={busy}>Criar sessão e gerar QR Code</button>}{qr&&<div className="wa-qr"><img src={qr.startsWith("data:")?qr:`data:image/png;base64,${qr}`} alt="QR Code para conectar o WhatsApp"/></div>}</form></>}
    <p className="settings-feedback" role="status">{notice}</p></main></div></section>;
}
