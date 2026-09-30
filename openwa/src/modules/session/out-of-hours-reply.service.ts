import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { IWhatsAppEngine, IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';

type Hours = {
  enabled?: boolean;
  autoReplyEnabled?: boolean;
  autoReplyMessage?: string;
  days?: { weekday: number; enabled: boolean; intervals: { start: string; end: string }[] }[];
};

const weekdays: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function outsideBusinessHours(hours: Hours, at: Date): { outside: boolean; localDate: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map(part => [part.type, part.value]));
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localTime = `${parts.hour}:${parts.minute}`;
  const day = hours.days?.find(item => item.weekday === weekdays[parts.weekday]);
  const open = day?.enabled && day.intervals?.some(interval => interval.start <= localTime && localTime < interval.end);
  return { outside: !open, localDate };
}

@Injectable()
export class OutOfHoursReplyService implements OnModuleInit {
  constructor(@InjectDataSource('data') private readonly db: DataSource, private readonly engines: EngineRegistry) {}

  async onModuleInit() {
    await this.db.query(`CREATE TABLE IF NOT EXISTS openwa.out_of_hours_replies (
      session_id varchar(36) NOT NULL, chat_id varchar(255) NOT NULL, local_date date NOT NULL,
      sent_at timestamptz NOT NULL DEFAULT NOW(), PRIMARY KEY (session_id, chat_id, local_date)
    )`);
  }

  async reply(sessionId: string, engine: IWhatsAppEngine, incoming: IncomingMessage): Promise<boolean> {
    if (incoming.fromMe || incoming.isGroup || incoming.isStatusBroadcast || !/@(c\.us|lid)$/.test(incoming.chatId)) return false;
    const now = new Date();
    const receivedAt = Number(incoming.timestamp);
    if (receivedAt > 0 && receivedAt < now.getTime() / 1000 - 600) return false;
    const [row] = await this.db.query('SELECT operation_hours FROM openwa.operator_settings WHERE id=1');
    const hours: Hours = row?.operation_hours ?? {};
    const text = String(hours.autoReplyMessage || '').trim();
    if (hours.enabled !== true || hours.autoReplyEnabled !== true || !text) return false;
    const { outside, localDate } = outsideBusinessHours(hours, now);
    if (!outside || !this.engines.isLive(sessionId, engine)) return false;
    const claimed = await this.db.query(`INSERT INTO openwa.out_of_hours_replies (session_id,chat_id,local_date)
      VALUES ($1,$2,$3::date) ON CONFLICT DO NOTHING RETURNING session_id`, [sessionId, incoming.chatId, localDate]);
    if (!claimed.length) return false;
    try {
      if (!this.engines.isLive(sessionId, engine)) {
        await this.db.query('DELETE FROM openwa.out_of_hours_replies WHERE session_id=$1 AND chat_id=$2 AND local_date=$3::date', [sessionId, incoming.chatId, localDate]);
        return false;
      }
      await engine.sendTextMessage(incoming.chatId, text);
      return true;
    } catch (error) {
      await this.db.query('DELETE FROM openwa.out_of_hours_replies WHERE session_id=$1 AND chat_id=$2 AND local_date=$3::date', [sessionId, incoming.chatId, localDate]);
      throw error;
    }
  }
}
