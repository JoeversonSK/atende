import { ConflictException, ForbiddenException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { DataSource } from 'typeorm';

export type OperatorUser = { id: string; username: string; displayName: string; role?: string; active?: boolean; canSend?: boolean; canAssign?: boolean };
const accessFields = 'id, username, display_name AS "displayName", role, active, can_send AS "canSend", can_assign AS "canAssign"';

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
      await db.query("ALTER TABLE openwa.operator_users ADD COLUMN IF NOT EXISTS role varchar(16) NOT NULL DEFAULT 'agent', ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS can_send boolean NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS can_assign boolean NOT NULL DEFAULT true");
      await db.query('CREATE TABLE IF NOT EXISTS openwa.operator_settings (id integer PRIMARY KEY CHECK (id=1), unassigned_user_id varchar(36) REFERENCES openwa.operator_users(id) ON DELETE SET NULL)');
      const inserted = await db.query('INSERT INTO openwa.operator_settings (id) VALUES (1) ON CONFLICT DO NOTHING RETURNING id');
      if (inserted.length) await db.query("UPDATE openwa.operator_users SET role='admin' WHERE id=(SELECT id FROM openwa.operator_users ORDER BY created_at,id LIMIT 1)");
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
    return {users: await this.dataSource.query(`SELECT ${accessFields} FROM openwa.operator_users ORDER BY created_at,id`),unassignedUserId:(await this.dataSource.query('SELECT unassigned_user_id FROM openwa.operator_settings WHERE id=1'))[0]?.unassigned_user_id ?? null};
  }
  async updateUser(token: string,id: string,update: {role: string;active: boolean;canSend: boolean;canAssign: boolean}) {
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
      const [user]=await db.query(`WITH changed AS (UPDATE openwa.operator_users SET role=$2,active=$3,can_send=$4,can_assign=$5 WHERE id=$1 RETURNING *) SELECT ${accessFields} FROM changed`,[id,update.role,update.active,update.canSend,update.canAssign]);
      if(!update.active) { await db.query('DELETE FROM openwa.operator_sessions WHERE user_id=$1',[id]); await db.query('UPDATE openwa.operator_settings SET unassigned_user_id=NULL WHERE unassigned_user_id=$1',[id]); }
      return user;
    });
  }
  async setRecipient(token: string,userId: string|null) {
    await this.requireAdmin(token);
    return this.dataSource.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(7349201)');
      await this.requireAdmin(token);
      if(userId && !(await db.query('SELECT id FROM openwa.operator_users WHERE id=$1 AND active=true',[userId])).length) throw new ConflictException('Selecione uma conta ativa.');
      await db.query('UPDATE openwa.operator_settings SET unassigned_user_id=$1 WHERE id=1',[userId]);
      return {unassignedUserId:userId};
    });
  }
  async notification(token: string,sessionId: string,chatId: string) {
    const user=await this.me(token);
    if(!chatId || /@(g.us|broadcast|newsletter)$/.test(chatId)) return {allowed:false};
    const [assigned]=await this.dataSource.query('SELECT assignee_id FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2',[sessionId,chatId]);
    const recipient=assigned?.assignee_id || (await this.dataSource.query('SELECT unassigned_user_id FROM openwa.operator_settings WHERE id=1'))[0]?.unassigned_user_id;
    return {allowed:recipient===user.id};
  }
  private passwordHash(password: string, salt: string) { return scryptSync(password, salt, 64).toString('hex'); }
  private verifyPassword(password: string, salt: string, expected: string) { const actual = Buffer.from(this.passwordHash(password, salt), 'hex'); const expectedBuffer = Buffer.from(expected, 'hex'); return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer); }
  private tokenHash(token: string) { return createHash('sha256').update(token).digest('hex'); }
}
