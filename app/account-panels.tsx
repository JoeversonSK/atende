"use client";
import { useState, type FormEvent } from "react";
import { TeamSettings } from "./team-settings";
import { PasswordRecovery } from "./password-recovery";
import { ArrowLeft, Bell, Copy, Eye, EyeOff, LoaderCircle, LogOut, MessageCircle, Settings, Smartphone, UserRound, UsersRound } from "lucide-react";

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

export function SettingsScreen({ token, user, name, setName, saveName, logout, config, setConfig, connect, busy, qr, createSession, notificationsEnabled, enableNotifications, notice, close }: any) {
  const [tab, setTab] = useState("profile");
  const [connection, setConnection] = useState(config);
  const [saving, setSaving] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState("");
  async function copyKey() {
    try {
      await navigator.clipboard.writeText(connection.apiKey);
      setCopyFeedback("Chave copiada. Não compartilhe com terceiros.");
    } catch {
      setCopyFeedback("Não foi possível copiar automaticamente. Selecione a chave e use Ctrl+C.");
    }
  }
  async function saveProfile(e: FormEvent) { e.preventDefault(); setSaving(true); try { await saveName(); } finally { setSaving(false); } }
  return <section className="settings-page" aria-label="Configurações"><aside className="settings-nav"><button className="back-link" onClick={close}><ArrowLeft size={18} /> Voltar às conversas</button><h1>Configurações</h1><p>Seu espaço de trabalho.</p><nav>{[["profile", "Meu perfil", UserRound], ["notifications", "Notificações", Bell], ...(user?.role === "admin" ? [["team", "Equipe e permissões", UsersRound], ["connection", "WhatsApp", Smartphone]] : [])].map(([key, label, Icon]: any) => <button key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setKeyVisible(false); setCopyFeedback(""); }}><Icon size={19} />{label}</button>)}</nav><div className="settings-user"><span className="preview-avatar">{user?.displayName?.slice(0, 1)}</span><div><b>{user?.displayName}</b><small>@{user?.username}</small></div></div><button className="back-link" onClick={logout}><LogOut size={17} /> Sair da conta</button></aside>
    <div className="settings-content"><span className="eyebrow">PREFERÊNCIAS DO ATENDIMENTO</span>
      {tab === "profile" && <><h2>Meu perfil</h2><p>Como você aparece para a equipe e para seus clientes.</p><form className="settings-card" onSubmit={saveProfile}><div className="profile-heading"><span className="profile-circle">{name?.slice(0, 1) || "A"}</span><div><h3>Sua identidade</h3><p>O nome abaixo assina suas novas mensagens.</p></div></div><label>Nome de exibição<input required maxLength={160} value={name} onChange={e => setName(e.target.value)} /></label><label>Usuário<input readOnly value={user?.username || ""} /></label><small>Seu usuário de acesso permanece o mesmo.</small><button className="solid-button" disabled={saving}>{saving ? "Salvando…" : "Salvar alterações"}</button></form></>}
      {tab === "notifications" && <><h2>Notificações</h2><p>Acompanhe as novas mensagens dos seus atendimentos.</p><div className="settings-card"><div className="profile-heading"><Bell size={28} /><div><h3>Alertas neste navegador</h3><p>{notificationsEnabled ? "Permissão de notificações ativada." : "Ative a permissão para receber alertas."}</p></div></div><p>Os alertas de conversas atribuídas são direcionados ao responsável. Conversas de grupos não geram notificações.</p><button className="solid-button" onClick={enableNotifications}>Ativar notificações e som</button></div></>}
      {tab === "team" && user?.role === "admin" && <TeamSettings baseUrl={config.baseUrl} token={token} />}
      {tab === "connection" && user?.role === "admin" && <><h2>Conexão WhatsApp</h2><p>Configure o serviço usado pela central de atendimento.</p><form className="settings-card" onSubmit={e => { e.preventDefault(); void connect(connection); }}><h3>Configuração de conexão</h3><label>Endereço do serviço<input required type="url" value={connection.baseUrl} onChange={e => setConnection({ ...connection, baseUrl: e.target.value })} /></label><label htmlFor="connection-api-key">Chave de acesso</label><div className="api-key-control"><input id="connection-api-key" required type={keyVisible ? "text" : "password"} autoComplete="off" spellCheck={false} autoCapitalize="none" value={connection.apiKey} onChange={e => { setConnection({ ...connection, apiKey: e.target.value }); setCopyFeedback(""); }} /><button type="button" aria-label={keyVisible ? "Ocultar chave" : "Mostrar chave"} title={keyVisible ? "Ocultar chave" : "Mostrar chave"} aria-pressed={keyVisible} onClick={() => setKeyVisible(!keyVisible)}>{keyVisible ? <EyeOff size={18} /> : <Eye size={18} />}</button><button type="button" aria-label="Copiar chave" title="Copiar chave" disabled={!connection.apiKey} onClick={() => void copyKey()}><Copy size={18} /><span>Copiar</span></button></div><small role="status" aria-live="polite">{copyFeedback || "A chave fica oculta por segurança. Use o olho para visualizar."}</small><label>Sessão<input value={connection.sessionId} onChange={e => setConnection({ ...connection, sessionId: e.target.value })} placeholder="Deixe vazio para localizar a sessão" /></label><small>A configuração é salva neste navegador.</small><button className="solid-button" disabled={busy}>{busy ? "Conectando…" : "Salvar e conectar"}</button>{config.apiKey && !config.sessionId && <button type="button" className="back-link" onClick={createSession} disabled={busy}>Criar sessão e gerar QR Code</button>}{qr && <div className="wa-qr"><img src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`} alt="QR Code para conectar o WhatsApp" /></div>}</form></>}
      <p className="settings-feedback" role="status">{notice}</p>
    </div></section>;
}
