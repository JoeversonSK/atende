import { BadRequestException, ConflictException, ForbiddenException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { DataSource } from 'typeorm';

export type OperatorUser = { id: string; username: string; displayName: string; role?: string; active?: boolean; canSend?: boolean; canAssign?: boolean; dashboardVisible?: boolean };
export type OperationHours = { enabled: boolean; days: { weekday: number; enabled: boolean; intervals: { start: string; end: string }[] }[]; autoReplyEnabled: boolean; autoReplyMessage: string };
export type ConversationFlowStep = {
  id?:string;
  type?:'message'|'image'|'video'|'audio'|'document'|'poll'|'delay'|'action';
  text?:string;
  delaySeconds?:number;
  data?:string;
  mimetype?:string;
  filename?:string;
  caption?:string;
  question?:string;
  options?:string[];
  allowMultipleAnswers?:boolean;
  action?:'assign-current'|'close-ticket';
};
export type ConversationFlowInput = { name:string; description?:string; active:boolean; kind:'regular'|'start'|'evaluation'; steps:ConversationFlowStep[]; pollOptions:string[] };
export type NotificationWebhookInput = { name:string; destinationType:'discord'|'json'; url:string; active:boolean; onlyUnassigned:boolean; includeGroups:boolean; includeText:boolean; includeMedia:boolean; senderName:string; title:string; color:string; fields:string[] };
const accessFields = 'id, username, display_name AS "displayName", role, active, can_send AS "canSend", can_assign AS "canAssign", dashboard_visible AS "dashboardVisible"';
const defaultOperationHours = (): OperationHours => ({ enabled:true, days:Array.from({length:7},(_,weekday)=>({weekday,enabled:weekday<6,intervals:[{start:'08:00',end:weekday===5?'12:00':'18:00'}]})), autoReplyEnabled:false, autoReplyMessage:'' });

@Injectable()
export class OperatorAuthService implements OnModuleInit {
  async connectionContext(token: string) {
    const user = await this.me(token);
    const sessions = await this.dataSource.query('SELECT id FROM openwa.sessions ORDER BY id');
    if (sessions.length !== 1) throw new ConflictException('O administrador precisa configurar uma única sessão do WhatsApp para o atendimento compartilhado.');
    const [login] = await this.dataSource.query('SELECT expires_at FROM openwa.operator_sessions WHERE token_hash=$1 AND expires_at>NOW()', [this.tokenHash(token)]);
    if (!login) throw new UnauthorizedException('Entre novamente.');
    return { user, sessionId: sessions[0].id as string, expiresAt: new Date(login.expires_at) };
  }
  async assignmentTarget(token: string, id?: string) {
    const user = await this.requirePermission(token, 'canAssign');
    const [target] = await this.dataSource.query('SELECT id, display_name AS "displayName" FROM openwa.operator_users WHERE id=$1 AND active=true', [id || user.id]);
    if (!target) throw new ForbiddenException('Escolha um atendente ativo.');
    return target;
  }
  constructor(@InjectDataSource('data') private readonly dataSource: DataSource) {}
  async onModuleInit() {
    await this.dataSource.query(`CREATE TABLE IF NOT EXISTS openwa.operator_users (id varchar(36) PRIMARY KEY, username varchar(80) NOT NULL UNIQUE, display_name varchar(160) NOT NULL, password_hash varchar(128) NOT NULL, password_salt varchar(64) NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW())`);
    await this.dataSource.query(`CREATE TABLE IF NOT EXISTS openwa.operator_sessions (token_hash varchar(64) PRIMARY KEY, user_id varchar(36) NOT NULL REFERENCES openwa.operator_users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW())`);
    await this.dataSource.query('CREATE TABLE IF NOT EXISTS openwa.operator_recovery (user_id varchar(36) PRIMARY KEY REFERENCES openwa.operator_users(id) ON DELETE CASCADE, token_hash varchar(64) NOT NULL, expires_at timestamptz NOT NULL)');
    await this.ensureAccessSchema();
  }
  async register(usernameInput: string, displayNameInput: string, password: string) {
    await this.ensureAccessSchema();
    const username = usernameInput.trim().toLowerCase(); const displayName = displayNameInput.trim();
    if (!/^[a-z0-9._-]{3,80}$/.test(username)) throw new ConflictException('Usuário deve ter de 3 a 80 caracteres.');
    if (!displayName || displayName.length > 160) throw new ConflictException('Informe um nome de exibição válido.');
    if (password.length < 8) throw new ConflictException('A senha deve ter pelo menos 8 caracteres.');
    if ((await this.dataSource.query('SELECT 1 FROM openwa.operator_users WHERE username = $1', [username])).length) throw new ConflictException('Este usuário já existe.');
    const salt = randomBytes(16).toString('hex'); const user: OperatorUser = { id: randomUUID(), username, displayName };
    await this.dataSource.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(7349201)');
      if ((await db.query('SELECT 1 FROM openwa.operator_users WHERE username=$1',[username])).length) throw new ConflictException('Este usuário já existe.');
      const first = !(await db.query('SELECT 1 FROM openwa.operator_users LIMIT 1')).length;
      await db.query('INSERT INTO openwa.operator_users (id, username, display_name, password_hash, password_salt, role) VALUES ($1,$2,$3,$4,$5,$6)', [user.id,username,displayName,this.passwordHash(password,salt),salt,first ? 'admin' : 'agent']);
    });
    return this.issue(user);
  }
  async login(usernameInput: string, password: string) {
    await this.ensureAccessSchema();
    const rows = await this.dataSource.query('SELECT id, username, display_name AS "displayName", password_hash AS "passwordHash", password_salt AS "passwordSalt" FROM openwa.operator_users WHERE username = $1', [usernameInput.trim().toLowerCase()]); const row = rows[0];
    if (!row || !this.verifyPassword(password, row.passwordSalt, row.passwordHash)) throw new UnauthorizedException('Usuário ou senha inválidos.');
    const [access] = await this.dataSource.query('SELECT active FROM openwa.operator_users WHERE id=$1',[row.id]);
    if (!access.active) throw new UnauthorizedException('Conta desativada. Procure o administrador.');
    return this.issue({ id: row.id, username: row.username, displayName: row.displayName });
  }
  async me(token: string) { return this.fromToken(token); }
  async resetPassword(usernameInput: string, code: string, password: string) {
    if (password.length < 8 || password.length > 128) throw new ConflictException('A senha deve ter de 8 a 128 caracteres.');
    return this.dataSource.transaction(async db => {
      const [user] = await db.query('SELECT id FROM openwa.operator_users WHERE username=$1 AND active=true FOR UPDATE',[usernameInput.trim().toLowerCase()]);
      const invalid = () => new UnauthorizedException('Código inválido ou expirado. Solicite outro ao responsável pelo servidor.');
      if (!user) throw invalid();
      const consumed = await db.query('WITH consumed AS (DELETE FROM openwa.operator_recovery WHERE user_id=$1 AND token_hash=$2 AND expires_at>NOW() RETURNING user_id) SELECT user_id FROM consumed',[user.id,this.tokenHash(code.trim())]);
      if (!consumed.length) throw invalid();
      const salt = randomBytes(16).toString('hex');
      await db.query('UPDATE openwa.operator_users SET password_hash=$1,password_salt=$2 WHERE id=$3',[this.passwordHash(password,salt),salt,user.id]);
      await db.query('DELETE FROM openwa.operator_sessions WHERE user_id=$1',[user.id]);
      return {success:true};
    });
  }
  async updateProfile(token: string, displayNameInput: string) { const user = await this.fromToken(token); const displayName = displayNameInput.trim(); if (!displayName || displayName.length > 160) throw new ConflictException('Informe um nome de exibição válido.'); await this.dataSource.query('UPDATE openwa.operator_users SET display_name = $1 WHERE id = $2', [displayName, user.id]); return { ...user, displayName }; }
  async logout(token: string) { await this.dataSource.query('DELETE FROM openwa.operator_sessions WHERE token_hash = $1', [this.tokenHash(token)]); }
  private async issue(user: OperatorUser) { const token = randomBytes(32).toString('base64url'); await this.dataSource.query("INSERT INTO openwa.operator_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')", [this.tokenHash(token), user.id]); return { user: await this.me(token), token }; }
  private async fromToken(token: string) {
    await this.ensureAccessSchema();
    if (!token) throw new UnauthorizedException('Faça login para continuar.');
    const rows = await this.dataSource.query(`SELECT ${accessFields} FROM openwa.operator_users WHERE active=true AND id=(SELECT user_id FROM openwa.operator_sessions WHERE token_hash=$1 AND expires_at>NOW())`,[this.tokenHash(token)]);
    if (!rows[0]) throw new UnauthorizedException('Sua sessão expirou ou sua conta foi desativada.');
    return rows[0] as OperatorUser;
  }
  private schemaReady?: Promise<void>;
  private ensureAccessSchema() {
    if (!this.schemaReady) this.schemaReady = this.dataSource.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(7349201)');
      await db.query("ALTER TABLE openwa.operator_users ADD COLUMN IF NOT EXISTS role varchar(16) NOT NULL DEFAULT 'agent', ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS can_send boolean NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS can_assign boolean NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS dashboard_visible boolean NOT NULL DEFAULT true");
      await db.query('CREATE TABLE IF NOT EXISTS openwa.operator_settings (id integer PRIMARY KEY CHECK (id=1), unassigned_user_id varchar(36) REFERENCES openwa.operator_users(id) ON DELETE SET NULL)');
      await db.query('ALTER TABLE openwa.operator_settings ADD COLUMN IF NOT EXISTS unassigned_user_ids text[]');
      await db.query("UPDATE openwa.operator_settings SET unassigned_user_ids=CASE WHEN unassigned_user_id IS NULL THEN ARRAY[]::text[] ELSE ARRAY[unassigned_user_id] END WHERE unassigned_user_ids IS NULL");
      await db.query("ALTER TABLE openwa.operator_settings ALTER COLUMN unassigned_user_ids SET DEFAULT ARRAY[]::text[]");
      await db.query("ALTER TABLE openwa.operator_settings ADD COLUMN IF NOT EXISTS operation_hours jsonb NOT NULL DEFAULT '{\"enabled\":true,\"days\":[]}'::jsonb");
      await db.query('ALTER TABLE openwa.operator_settings ADD COLUMN IF NOT EXISTS flows_seeded boolean NOT NULL DEFAULT false');
      await db.query('CREATE TABLE IF NOT EXISTS openwa.quick_replies (id varchar(36) PRIMARY KEY,shortcut varchar(60) NOT NULL UNIQUE,text varchar(10000) NOT NULL,updated_at timestamptz NOT NULL DEFAULT NOW())');
      await db.query('ALTER TABLE openwa.operator_settings ADD COLUMN IF NOT EXISTS flow_actions_migrated boolean NOT NULL DEFAULT false');
      await db.query('CREATE TABLE IF NOT EXISTS openwa.conversation_flows (id varchar(36) PRIMARY KEY, name varchar(100) NOT NULL, description varchar(240) NOT NULL DEFAULT \'\', active boolean NOT NULL DEFAULT true, steps jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW())');
      await db.query("ALTER TABLE openwa.conversation_flows ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'regular', ADD COLUMN IF NOT EXISTS poll_options jsonb NOT NULL DEFAULT '[]'::jsonb");
      await db.query(`CREATE TABLE IF NOT EXISTS openwa.notification_webhooks (id varchar(36) PRIMARY KEY,name varchar(100) NOT NULL,destination_type varchar(16) NOT NULL,url varchar(2048) NOT NULL,active boolean NOT NULL DEFAULT true,only_unassigned boolean NOT NULL DEFAULT true,include_groups boolean NOT NULL DEFAULT false,include_text boolean NOT NULL DEFAULT true,include_media boolean NOT NULL DEFAULT true,sender_name varchar(80) NOT NULL DEFAULT 'Atende',title varchar(120) NOT NULL DEFAULT 'Nova mensagem',color varchar(7) NOT NULL DEFAULT '#0b917a',fields jsonb NOT NULL DEFAULT '["contactName","phone","message","receivedAt"]'::jsonb,created_at timestamptz NOT NULL DEFAULT NOW(),updated_at timestamptz NOT NULL DEFAULT NOW())`);
      const legacyWebhook=process.env.DISCORD_UNASSIGNED_WEBHOOK_URL?.trim();
      if(legacyWebhook && !(await db.query('SELECT 1 FROM openwa.notification_webhooks LIMIT 1')).length) await db.query("INSERT INTO openwa.notification_webhooks (id,name,destination_type,url,active,only_unassigned,include_groups,include_text,include_media,sender_name,title,color,fields) VALUES ($1,'Discord · fila de espera','discord',$2,true,true,false,true,true,'Atende','Nova mensagem sem responsável','#0b917a',$3::jsonb)",[randomUUID(),legacyWebhook,JSON.stringify(['contactName','phone','message','messageType','receivedAt'])]);
      const inserted = await db.query('INSERT INTO openwa.operator_settings (id) VALUES (1) ON CONFLICT DO NOTHING RETURNING id');
      if (inserted.length) await db.query("UPDATE openwa.operator_users SET role='admin' WHERE id=(SELECT id FROM openwa.operator_users ORDER BY created_at,id LIMIT 1)");
      const seedFlows=await db.query('UPDATE openwa.operator_settings SET flows_seeded=true WHERE id=1 AND flows_seeded=false RETURNING id');
      if (seedFlows.length && !(await db.query('SELECT 1 FROM openwa.conversation_flows LIMIT 1')).length) {
        await db.query('INSERT INTO openwa.conversation_flows (id,name,description,kind,steps,poll_options) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb),($7,$8,$9,$10,$11::jsonb,$12::jsonb)',[
          randomUUID(),'Início do atendimento','Apresenta o atendente e assume a conversa','start',JSON.stringify([{text:'{{saudacao}} {{cliente}}, tudo bem?\nEstou responsável pelo seu atendimento.',delaySeconds:0}]),JSON.stringify([]),
          randomUUID(),'Avaliação do atendimento','Envia uma avaliação e encerra o atendimento','evaluation',JSON.stringify([{text:'Seu atendimento foi concluído. Por favor, escolha uma opção na avaliação abaixo.',delaySeconds:0}]),JSON.stringify(['1 - Muito ruim','2 - Ruim','3 - Regular','4 - Bom','5 - Excelente']),
        ]);
      }
      const migrateActions=await db.query('UPDATE openwa.operator_settings SET flow_actions_migrated=true WHERE id=1 AND flow_actions_migrated=false RETURNING id');
      if(migrateActions.length){
        await db.query("UPDATE openwa.conversation_flows SET kind='start',description='Apresenta o atendente e assume a conversa',updated_at=NOW() WHERE LOWER(name)=LOWER('Início do atendimento')");
        await db.query("UPDATE openwa.conversation_flows SET kind='evaluation',description='Envia uma avaliação e encerra o atendimento',poll_options=$1::jsonb,updated_at=NOW() WHERE LOWER(name)=LOWER('Avaliação do atendimento')",[JSON.stringify(['1 - Muito ruim','2 - Ruim','3 - Regular','4 - Bom','5 - Excelente'])]);
      }
    }).catch(error => { this.schemaReady=undefined; throw error; });
    return this.schemaReady;
  }
  async requirePermission(token: string, permission: 'canSend'|'canAssign') {
    const user=await this.me(token);
    if (user.role!=='admin' && !user[permission]) throw new ForbiddenException('Sua conta não tem permissão para esta ação.');
    return user;
  }
  async requireAdmin(token: string) { const user=await this.me(token); if(user.role!=='admin') throw new ForbiddenException('Apenas administradores podem gerenciar a equipe.'); return user; }
  async administration(token: string) {
    await this.requireAdmin(token);
    return {users: await this.dataSource.query(`SELECT ${accessFields} FROM openwa.operator_users ORDER BY created_at,id`),unassignedUserIds:(await this.dataSource.query('SELECT unassigned_user_ids FROM openwa.operator_settings WHERE id=1'))[0]?.unassigned_user_ids ?? []};
  }
  async updateUser(token: string,id: string,update: {role: string;active: boolean;canSend: boolean;canAssign: boolean;dashboardVisible:boolean}) {
    await this.requireAdmin(token);
    return this.dataSource.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(7349201)');
      await this.requireAdmin(token);
      const [existing]=await db.query('SELECT role,active FROM openwa.operator_users WHERE id=$1',[id]);
      if (!existing) throw new ConflictException('Conta não encontrada.');
      if(existing.role==='admin' && existing.active && (!update.active || update.role!=='admin')) {
        const admins=await db.query("SELECT id FROM openwa.operator_users WHERE role='admin' AND active=true");
        if(admins.length<=1) throw new ConflictException('Mantenha pelo menos um administrador ativo.');
      }
      const [user]=await db.query(`WITH changed AS (UPDATE openwa.operator_users SET role=$2,active=$3,can_send=$4,can_assign=$5,dashboard_visible=$6 WHERE id=$1 RETURNING *) SELECT ${accessFields} FROM changed`,[id,update.role,update.active,update.canSend,update.canAssign,update.dashboardVisible]);
      if(!update.active) { await db.query('DELETE FROM openwa.operator_sessions WHERE user_id=$1',[id]); await db.query('UPDATE openwa.operator_settings SET unassigned_user_id=NULL WHERE unassigned_user_id=$1',[id]); await db.query('UPDATE openwa.operator_settings SET unassigned_user_ids=array_remove(unassigned_user_ids,$1) WHERE id=1',[id]); }
      return user;
    });
  }
  async setRecipients(token: string,userIds: string[]) {
    await this.requireAdmin(token);
    return this.dataSource.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(7349201)');
      await this.requireAdmin(token);
      const uniqueIds=[...new Set(userIds)];
      if(uniqueIds.length!==userIds.length) throw new BadRequestException('Selecione cada pessoa apenas uma vez.');
      if(uniqueIds.length) {
        const active=await db.query('SELECT id FROM openwa.operator_users WHERE id=ANY($1::text[]) AND active=true',[uniqueIds]);
        if(active.length!==uniqueIds.length) throw new ConflictException('Selecione apenas contas ativas.');
      }
      await db.query('UPDATE openwa.operator_settings SET unassigned_user_ids=$1::text[],unassigned_user_id=NULL WHERE id=1',[uniqueIds]);
      return {unassignedUserIds:uniqueIds};
    });
  }
  async setRecipientEnabled(token: string,userId: string,enabled: boolean) {
    await this.requireAdmin(token);
    return this.dataSource.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(7349201)');
      await this.requireAdmin(token);
      if(enabled && !(await db.query('SELECT id FROM openwa.operator_users WHERE id=$1 AND active=true',[userId])).length) throw new ConflictException('Selecione uma conta ativa.');
      const [settings]=await db.query('SELECT unassigned_user_ids FROM openwa.operator_settings WHERE id=1');
      const current:string[]=settings?.unassigned_user_ids ?? [];
      const next=enabled ? [...new Set([...current,userId])] : current.filter(id=>id!==userId);
      await db.query('UPDATE openwa.operator_settings SET unassigned_user_ids=$1::text[],unassigned_user_id=NULL WHERE id=1',[next]);
      return {unassignedUserIds:next};
    });
  }
  async operationHours(token: string) {
    await this.me(token);
    await this.ensureAccessSchema();
    const value=(await this.dataSource.query('SELECT operation_hours FROM openwa.operator_settings WHERE id=1'))[0]?.operation_hours;
    return this.normalizeOperationHours(value);
  }
  async updateOperationHours(token: string,value: OperationHours) {
    await this.requireAdmin(token);
    await this.ensureAccessSchema();
    const normalized=this.normalizeOperationHours(value);
    if(normalized.autoReplyEnabled && !normalized.autoReplyMessage)throw new BadRequestException('Escreva a mensagem automática para o horário fechado.');
    await this.dataSource.query('UPDATE openwa.operator_settings SET operation_hours=$1::jsonb WHERE id=1',[JSON.stringify(normalized)]);
    return normalized;
  }
  async conversationFlows(token:string) {
    await this.me(token); await this.ensureAccessSchema();
    return this.dataSource.query('SELECT id,name,description,active,kind,steps,poll_options AS "pollOptions",created_at AS "createdAt",updated_at AS "updatedAt" FROM openwa.conversation_flows ORDER BY created_at,id');
  }
  async createConversationFlow(token:string,input:ConversationFlowInput) {
    await this.requireAdmin(token); await this.ensureAccessSchema(); const value=this.normalizeFlow(input);
    const [flow]=await this.dataSource.query('INSERT INTO openwa.conversation_flows (id,name,description,active,kind,steps,poll_options) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) RETURNING id,name,description,active,kind,steps,poll_options AS "pollOptions",created_at AS "createdAt",updated_at AS "updatedAt"',[randomUUID(),value.name,value.description,value.active,value.kind,JSON.stringify(value.steps),JSON.stringify(value.pollOptions)]); return flow;
  }
  async updateConversationFlow(token:string,id:string,input:ConversationFlowInput) {
    await this.requireAdmin(token); await this.ensureAccessSchema(); const value=this.normalizeFlow(input);
    const [flow]=await this.dataSource.query('UPDATE openwa.conversation_flows SET name=$2,description=$3,active=$4,kind=$5,steps=$6::jsonb,poll_options=$7::jsonb,updated_at=NOW() WHERE id=$1 RETURNING id,name,description,active,kind,steps,poll_options AS "pollOptions",created_at AS "createdAt",updated_at AS "updatedAt"',[id,value.name,value.description,value.active,value.kind,JSON.stringify(value.steps),JSON.stringify(value.pollOptions)]); if(!flow)throw new ConflictException('Fluxo não encontrado.'); return flow;
  }
  async quickReplies(token:string) {
    await this.me(token); await this.ensureAccessSchema();
    return this.dataSource.query('SELECT id,shortcut,text FROM openwa.quick_replies ORDER BY shortcut');
  }
  async saveQuickReply(token:string,id:string|undefined,input:{shortcut:string;text:string}) {
    await this.requireAdmin(token); await this.ensureAccessSchema();
    const shortcut=input.shortcut.trim().replace(/^\//,'').toLowerCase(), text=input.text.trim();
    if(!/^[a-z0-9_-]{1,60}$/.test(shortcut)||!text||text.length>10000)throw new BadRequestException('Informe um atalho válido e o texto da mensagem.');
    try {
      const result=id
        ? await this.dataSource.query('UPDATE openwa.quick_replies SET shortcut=$2,text=$3,updated_at=NOW() WHERE id=$1 RETURNING id,shortcut,text',[id,shortcut,text])
        : await this.dataSource.query('INSERT INTO openwa.quick_replies (id,shortcut,text) VALUES ($1,$2,$3) RETURNING id,shortcut,text',[randomUUID(),shortcut,text]);
      const row=id ? result[0]?.[0] : result[0];
      if(!row)throw new ConflictException('Mensagem rápida não encontrada.');
      return row;
    }catch(error){if((error as {code?:string}).code==='23505')throw new ConflictException('Esse atalho já está cadastrado.');throw error;}
  }
  async deleteQuickReply(token:string,id:string) {
    await this.requireAdmin(token); await this.ensureAccessSchema();
    await this.dataSource.query('DELETE FROM openwa.quick_replies WHERE id=$1',[id]);return {success:true};
  }
  async deleteConversationFlow(token:string,id:string) { await this.requireAdmin(token); await this.ensureAccessSchema(); const removed=await this.dataSource.query('DELETE FROM openwa.conversation_flows WHERE id=$1 RETURNING id',[id]); if(!removed.length)throw new ConflictException('Fluxo não encontrado.'); return {success:true}; }
  async notificationWebhooks(token:string){await this.requireAdmin(token);await this.ensureAccessSchema();return this.dataSource.query(`SELECT id,name,destination_type AS "destinationType",url,active,only_unassigned AS "onlyUnassigned",include_groups AS "includeGroups",include_text AS "includeText",include_media AS "includeMedia",sender_name AS "senderName",title,color,fields,created_at AS "createdAt",updated_at AS "updatedAt" FROM openwa.notification_webhooks ORDER BY created_at,id`);}
  async createNotificationWebhook(token:string,input:NotificationWebhookInput){await this.requireAdmin(token);await this.ensureAccessSchema();const value=this.normalizeNotificationWebhook(input);const [row]=await this.dataSource.query(`INSERT INTO openwa.notification_webhooks (id,name,destination_type,url,active,only_unassigned,include_groups,include_text,include_media,sender_name,title,color,fields) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) RETURNING id`,[randomUUID(),value.name,value.destinationType,value.url,value.active,value.onlyUnassigned,value.includeGroups,value.includeText,value.includeMedia,value.senderName,value.title,value.color,JSON.stringify(value.fields)]);return (await this.notificationWebhooks(token)).find((item:any)=>item.id===row.id);}
  async updateNotificationWebhook(token:string,id:string,input:NotificationWebhookInput){await this.requireAdmin(token);await this.ensureAccessSchema();const value=this.normalizeNotificationWebhook(input);const updated=await this.dataSource.query(`UPDATE openwa.notification_webhooks SET name=$2,destination_type=$3,url=$4,active=$5,only_unassigned=$6,include_groups=$7,include_text=$8,include_media=$9,sender_name=$10,title=$11,color=$12,fields=$13::jsonb,updated_at=NOW() WHERE id=$1 RETURNING id`,[id,value.name,value.destinationType,value.url,value.active,value.onlyUnassigned,value.includeGroups,value.includeText,value.includeMedia,value.senderName,value.title,value.color,JSON.stringify(value.fields)]);if(!updated.length)throw new ConflictException('Webhook não encontrado.');return (await this.notificationWebhooks(token)).find((item:any)=>item.id===id);}
  async deleteNotificationWebhook(token:string,id:string){await this.requireAdmin(token);await this.ensureAccessSchema();const removed=await this.dataSource.query('DELETE FROM openwa.notification_webhooks WHERE id=$1 RETURNING id',[id]);if(!removed.length)throw new ConflictException('Webhook não encontrado.');return {success:true};}
  async testNotificationWebhook(token:string,id:string){await this.requireAdmin(token);await this.ensureAccessSchema();const [hook]=await this.dataSource.query('SELECT * FROM openwa.notification_webhooks WHERE id=$1',[id]);if(!hook)throw new ConflictException('Webhook não encontrado.');const body=hook.destination_type==='discord'?{username:hook.sender_name||'Atende',allowed_mentions:{parse:[]},embeds:[{title:hook.title||'Teste do webhook',description:'Este é um teste enviado pelas configurações da central.',color:parseInt(String(hook.color||'#0b917a').slice(1),16),fields:[{name:'Contato',value:'Contato de teste',inline:true},{name:'WhatsApp',value:'5500000000000',inline:true}],timestamp:new Date().toISOString()}]}:{event:'test',source:'Atende',message:'Este é um teste enviado pelas configurações da central.',sentAt:new Date().toISOString()};try{const response=await fetch(hook.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);return {success:true,statusCode:response.status};}catch(error){return {success:false,error:error instanceof Error?error.message:'Falha ao enviar o teste.'};}}
  async notification(token: string,sessionId: string,chatId: string) {
    const user=await this.me(token);
    if(!chatId || /@(g.us|broadcast|newsletter)$/.test(chatId)) return {allowed:false};
    const [assigned]=await this.dataSource.query('SELECT assignee_id FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2',[sessionId,chatId]);
    if(assigned?.assignee_id) return {allowed:assigned.assignee_id===user.id};
    const recipients=(await this.dataSource.query('SELECT unassigned_user_ids FROM openwa.operator_settings WHERE id=1'))[0]?.unassigned_user_ids ?? [];
    return {allowed:recipients.includes(user.id)};
  }
  private passwordHash(password: string, salt: string) { return scryptSync(password, salt, 64).toString('hex'); }
  private verifyPassword(password: string, salt: string, expected: string) { const actual = Buffer.from(this.passwordHash(password, salt), 'hex'); const expectedBuffer = Buffer.from(expected, 'hex'); return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer); }
  private tokenHash(token: string) { return createHash('sha256').update(token).digest('hex'); }
  private normalizeOperationHours(value: unknown): OperationHours {
    if(!value || typeof value!=='object') return defaultOperationHours();
    const input=value as Partial<OperationHours>;
    const source=Array.isArray(input.days)?input.days:[];
    if(!source.length) return defaultOperationHours();
    const byDay=new Map(source.map(day=>[Number(day?.weekday),day]));
    const validTime=(time: unknown)=>typeof time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time);
    return {enabled:input.enabled!==false,autoReplyEnabled:input.autoReplyEnabled===true,autoReplyMessage:typeof input.autoReplyMessage==='string'?input.autoReplyMessage.trim().slice(0,4000):'',days:Array.from({length:7},(_,weekday)=>{
      const day=byDay.get(weekday);
      const intervals=Array.isArray(day?.intervals)?day.intervals.filter(interval=>validTime(interval?.start)&&validTime(interval?.end)&&interval.start<interval.end).slice(0,4).map(interval=>({start:interval.start,end:interval.end})):[];
      return {weekday,enabled:Boolean(day?.enabled)&&intervals.length>0,intervals:intervals.length?intervals:[{start:'08:00',end:weekday===5?'12:00':'18:00'}]};
    })};
  }
  private normalizeFlow(input:ConversationFlowInput):ConversationFlowInput {
    const name=String(input.name||'').trim(),description=String(input.description||'').trim();
    const steps=(Array.isArray(input.steps)?input.steps:[]).slice(0,30).map((raw,index):ConversationFlowStep|null=>{
      const type=String(raw.type||'message') as NonNullable<ConversationFlowStep['type']>;
      const id=String(raw.id||`etapa-${index+1}`).slice(0,80);
      const delaySeconds=Math.max(0,Math.min(3600,Math.floor(Number(raw.delaySeconds)||0)));
      if(type==='message'){
        const text=String(raw.text||'').trim();
        return text?{id,type,text,delaySeconds}:null;
      }
      if(['image','video','audio','document'].includes(type)){
        const data=String(raw.data||'').trim(),mimetype=String(raw.mimetype||'application/octet-stream').slice(0,160),filename=String(raw.filename||'arquivo').slice(0,240),caption=String(raw.caption||'').trim().slice(0,1024);
        if(!data || data.length>24_000_000)return null;
        return {id,type,data,mimetype,filename,caption,delaySeconds};
      }
      if(type==='poll'){
        const question=String(raw.question||'').trim().slice(0,255);
        const options=(Array.isArray(raw.options)?raw.options:[]).map(option=>String(option||'').trim()).filter(Boolean).slice(0,12);
        return question&&options.length>=2?{id,type,question,options,allowMultipleAnswers:raw.allowMultipleAnswers===true,delaySeconds}:null;
      }
      if(type==='delay')return {id,type,delaySeconds:Math.max(1,delaySeconds)};
      if(type==='action'&&['assign-current','close-ticket'].includes(String(raw.action)))return {id,type,action:raw.action as 'assign-current'|'close-ticket'};
      return null;
    }).filter((step):step is ConversationFlowStep=>Boolean(step));
    const kind=['regular','start','evaluation'].includes(input.kind)?input.kind:'regular';
    const pollOptions=Array.isArray(input.pollOptions)?input.pollOptions.map(option=>String(option||'').trim()).filter(Boolean).slice(0,12):[];
    if(!name||!steps.length)throw new ConflictException('Informe um nome e pelo menos um bloco válido no fluxo.');
    if(kind==='evaluation'&&(pollOptions.length<2||pollOptions.some(option=>option.length>100)))throw new ConflictException('A avaliação precisa ter de 2 a 12 alternativas válidas.');
    return {name,description,active:input.active!==false,kind,steps,pollOptions:kind==='evaluation'?pollOptions:[]};
  }
  private normalizeNotificationWebhook(input:NotificationWebhookInput):NotificationWebhookInput{
    const url=new URL(String(input.url||'').trim());
    if(url.protocol!=='https:')throw new ConflictException('Use um endereço HTTPS para o webhook.');
    const host=url.hostname.toLowerCase();
    if(host==='localhost'||host==='127.0.0.1'||host==='::1'||/^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host))throw new ConflictException('O webhook precisa usar um endereço público.');
    if(input.destinationType==='discord'&&(!/(^|\.)discord(?:app)?\.com$/.test(host)||!url.pathname.startsWith('/api/webhooks/')))throw new ConflictException('Informe um webhook válido do Discord.');
    const allowed=['contactName','phone','message','messageType','receivedAt','contactProfile','messageDetails','assignment'];
    const fields=[...new Set((Array.isArray(input.fields)?input.fields:[]).filter(field=>allowed.includes(field)))];
    if(!fields.length)throw new ConflictException('Escolha pelo menos uma informação para enviar.');
    return {name:String(input.name||'').trim().slice(0,100),destinationType:input.destinationType==='json'?'json':'discord',url:url.toString(),active:input.active!==false,onlyUnassigned:input.onlyUnassigned!==false,includeGroups:input.includeGroups===true,includeText:input.includeText!==false,includeMedia:input.includeMedia!==false,senderName:String(input.senderName||'Atende').trim().slice(0,80)||'Atende',title:String(input.title||'Nova mensagem').trim().slice(0,120)||'Nova mensagem',color:/^#[0-9a-f]{6}$/i.test(String(input.color||''))?input.color:'#0b917a',fields};
  }
}
