import { BadRequestException, Body, Controller, Get, Headers, Injectable, Post, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { Public } from '../auth/decorators/auth.decorators';
import { OperatorAuthService } from './operator-auth.service';

type Room = { id: string; displayName: string; lastMessage: string | null; lastAt: Date | null; unread: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TeamChatService {
  constructor(@InjectDataSource('data') private readonly db: DataSource, private readonly auth: OperatorAuthService) {}

  private schemaReady?: Promise<void>;
  private ensureSchema() {
    if (!this.schemaReady) this.schemaReady = (async () => {
      await this.db.query(`CREATE TABLE IF NOT EXISTS openwa.team_messages (
        id varchar(36) PRIMARY KEY, sender_id varchar(36) NOT NULL REFERENCES openwa.operator_users(id),
        recipient_id varchar(36) REFERENCES openwa.operator_users(id), body varchar(4000) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT NOW())`);
      await this.db.query('CREATE INDEX IF NOT EXISTS team_messages_room_idx ON openwa.team_messages(recipient_id,created_at DESC,id DESC)');
      await this.db.query('CREATE INDEX IF NOT EXISTS team_messages_sender_idx ON openwa.team_messages(sender_id,created_at DESC,id DESC)');
      await this.db.query(`CREATE TABLE IF NOT EXISTS openwa.team_message_reads (
        user_id varchar(36) NOT NULL REFERENCES openwa.operator_users(id) ON DELETE CASCADE,
        room_key varchar(36) NOT NULL, last_read_at timestamptz NOT NULL DEFAULT NOW(),
        PRIMARY KEY(user_id,room_key))`);
    })().catch(error => { this.schemaReady = undefined; throw error; });
    return this.schemaReady;
  }

  private async user(token: string) {
    const user = await this.auth.me(token);
    await this.ensureSchema();
    return user;
  }

  private async validateRoom(userId: string, room: string) {
    if (room === 'group') return;
    if (!uuid.test(room) || room === userId) throw new BadRequestException('Escolha uma conversa válida.');
    const [target] = await this.db.query('SELECT id FROM openwa.operator_users WHERE id=$1 AND active=true', [room]);
    if (!target) throw new BadRequestException('Este usuário não está ativo.');
  }

  async rooms(token: string) {
    const user = await this.user(token);
    const members = await this.db.query(
      `SELECT id,display_name AS "displayName" FROM openwa.operator_users WHERE active=true ORDER BY display_name,id`,
    ) as { id: string; displayName: string }[];
    const rooms = await this.db.query(
      `WITH rooms AS (
        SELECT 'group'::varchar AS id,'Grupo geral'::varchar AS "displayName"
        UNION ALL SELECT id,display_name FROM openwa.operator_users WHERE active=true AND id<>$1
      ) SELECT r.id,r."displayName",latest.body AS "lastMessage",latest.created_at AS "lastAt",
        (SELECT COUNT(*)::int FROM openwa.team_messages m
          WHERE m.sender_id<>$1 AND m.created_at>COALESCE(rd.last_read_at,'epoch'::timestamptz)
          AND ((r.id='group' AND m.recipient_id IS NULL)
            OR (r.id<>'group' AND m.sender_id=r.id AND m.recipient_id=$1))) AS unread
      FROM rooms r LEFT JOIN openwa.team_message_reads rd ON rd.user_id=$1 AND rd.room_key=r.id
      LEFT JOIN LATERAL (SELECT m.body,m.created_at FROM openwa.team_messages m
        WHERE (r.id='group' AND m.recipient_id IS NULL)
          OR (r.id<>'group' AND ((m.sender_id=$1 AND m.recipient_id=r.id)
            OR (m.sender_id=r.id AND m.recipient_id=$1)))
        ORDER BY m.created_at DESC,m.id DESC LIMIT 1) latest ON true
      ORDER BY CASE WHEN r.id='group' THEN 0 ELSE 1 END,latest.created_at DESC NULLS LAST,r."displayName"`,
      [user.id],
    ) as Room[];
    return { userId: user.id, members, rooms };
  }

  async messages(token: string, room: string, before?: string) {
    const user = await this.user(token);
    await this.validateRoom(user.id, room);
    if (before && !uuid.test(before)) throw new BadRequestException('Marcador de histórico inválido.');
    const rows = await this.db.query(
      `SELECT m.id,m.sender_id AS "senderId",u.display_name AS "senderName",m.recipient_id AS "recipientId",
        m.body,m.created_at AS "createdAt" FROM openwa.team_messages m
        JOIN openwa.operator_users u ON u.id=m.sender_id
        WHERE (($2='group' AND m.recipient_id IS NULL)
          OR ($2<>'group' AND ((m.sender_id=$1 AND m.recipient_id=$2)
            OR (m.sender_id=$2 AND m.recipient_id=$1))))
          AND ($3::varchar IS NULL OR (m.created_at,m.id)<(
            SELECT older.created_at,older.id FROM openwa.team_messages older WHERE older.id=$3))
        ORDER BY m.created_at DESC,m.id DESC LIMIT 100`,
      [user.id, room, before || null],
    );
    return rows.reverse();
  }

  async send(token: string, room: string, body: unknown) {
    const user = await this.user(token);
    await this.validateRoom(user.id, room);
    if (typeof body !== 'string' || !body.trim() || body.trim().length > 4000)
      throw new BadRequestException('Escreva uma mensagem de até 4.000 caracteres.');
    const [message] = await this.db.query(
      `WITH sent AS (INSERT INTO openwa.team_messages(id,sender_id,recipient_id,body)
        VALUES($1,$2,$3,$4) RETURNING *)
       SELECT sent.id,sent.sender_id AS "senderId",u.display_name AS "senderName",
         sent.recipient_id AS "recipientId",sent.body,sent.created_at AS "createdAt"
       FROM sent JOIN openwa.operator_users u ON u.id=sent.sender_id`,
      [randomUUID(), user.id, room === 'group' ? null : room, body.trim()],
    );
    return message;
  }

  async markRead(token: string, room: string) {
    const user = await this.user(token);
    await this.validateRoom(user.id, room);
    await this.db.query(
      `INSERT INTO openwa.team_message_reads(user_id,room_key,last_read_at) VALUES($1,$2,NOW())
       ON CONFLICT(user_id,room_key) DO UPDATE SET last_read_at=EXCLUDED.last_read_at`,
      [user.id, room],
    );
    return { success: true };
  }
}

@Public()
@Controller('operator-auth/team-chat')
export class TeamChatController {
  constructor(private readonly chat: TeamChatService) {}
  @Get('rooms') rooms(@Headers('x-atende-token') token = '') { return this.chat.rooms(token); }
  @Get('messages') messages(@Headers('x-atende-token') token = '', @Query('room') room = '', @Query('before') before?: string) {
    return this.chat.messages(token, room, before);
  }
  @Post('messages') send(@Headers('x-atende-token') token = '', @Body() input?: { room?: string; body?: unknown }) {
    return this.chat.send(token, input?.room || '', input?.body);
  }
  @Post('read') read(@Headers('x-atende-token') token = '', @Body() input?: { room?: string }) {
    return this.chat.markRead(token, input?.room || '');
  }
}
