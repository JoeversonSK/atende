import { BadRequestException, Body, Controller, Headers, Injectable, Param, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../auth/decorators/auth.decorators';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { EventsGateway } from '../events/events.gateway';
import { OperatorAuthService } from './operator-auth.service';
import { ContactData, emptyContact } from './contact-profile.controller';

type ImportRow = { firstName: string; lastName: string; phone: string; tags: string[] };
type Identity = { chatId: string; phone: string; hasProfile: boolean };
const assignmentTag = 'Sabrina - Atribuido';
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const isAssignmentTag = (value: string) => value.trim().localeCompare(assignmentTag, 'pt-BR', { sensitivity: 'base' }) === 0;
const usefulName = (value: unknown) => /[\p{L}\p{N}]/u.test(String(value ?? '')) ? String(value).trim() : '';

/** A number is an identifier, not a quantity. Only add Brazil's country code to local 10/11-digit numbers. */
export function normalizeImportPhone(value: unknown): string {
  const raw = String(value ?? '').trim();
  let phone = digits(raw);
  if (phone.startsWith('00') && phone.length > 13) phone = phone.slice(2);
  if (!raw.startsWith('+') && /^\d{10,11}$/.test(phone)) phone = `55${phone}`;
  if (!/^\d{7,15}$/.test(phone)) throw new BadRequestException(`Telefone inválido: ${String(value ?? '').slice(0, 40)}`);
  return phone;
}

function mergeTags(existing: unknown, incoming: string[]) {
  const tags = Array.isArray(existing) ? existing.filter((tag): tag is string => typeof tag === 'string') : [];
  const seen = new Set(tags.map(tag => tag.trim().toLocaleLowerCase('pt-BR')));
  for (const tag of incoming) {
    const key = tag.trim().toLocaleLowerCase('pt-BR');
    if (key && !seen.has(key) && key !== 'lançar atendimento') {
      tags.push(tag.trim());
      seen.add(key);
    }
  }
  return tags;
}

@Injectable()
export class ContactImportService {
  constructor(
    @InjectDataSource('data') private readonly db: DataSource,
    private readonly auth: OperatorAuthService,
    private readonly engines: EngineRegistry,
    private readonly events: EventsGateway,
  ) {}

  async import(token: string, session: string, input: unknown) {
    await this.auth.requirePermission(token, 'canAssign');
    const context = await this.auth.connectionContext(token);
    if (context.sessionId !== session) throw new BadRequestException('Sessão do WhatsApp inválida.');
    const source = input && typeof input === 'object' && 'contacts' in input ? (input as { contacts: unknown }).contacts : null;
    if (!Array.isArray(source) || !source.length || source.length > 200)
      throw new BadRequestException('Envie de 1 a 200 contatos por vez.');

    const rows: ImportRow[] = [];
    const phones = new Set<string>();
    for (const raw of source) {
      if (!raw || typeof raw !== 'object') throw new BadRequestException('Linha de contato inválida.');
      const row = raw as Record<string, unknown>;
      const firstName = usefulName(row.firstName);
      const lastName = usefulName(row.lastName);
      const phone = normalizeImportPhone(row.phone);
      if (firstName.length > 160 || lastName.length > 160) throw new BadRequestException('Nome muito longo.');
      if (phones.has(phone)) throw new BadRequestException(`Telefone repetido no mesmo lote: ${phone}`);
      phones.add(phone);
      if (!Array.isArray(row.tags) || row.tags.length > 50 || row.tags.some(tag => typeof tag !== 'string' || tag.length > 80))
        throw new BadRequestException(`Etiquetas inválidas para ${phone}.`);
      rows.push({ firstName, lastName, phone, tags: row.tags.map(tag => tag.trim()).filter(Boolean) });
    }

    const needsSabrina = rows.some(row => row.tags.some(isAssignmentTag));
    let sabrina: { id: string; display_name: string } | undefined;
    if (needsSabrina) {
      const candidates = await this.db.query(
        `SELECT id, display_name, username FROM openwa.operator_users
         WHERE active=true AND (LOWER(username)='sabrina' OR LOWER(SPLIT_PART(BTRIM(display_name),' ',1))='sabrina')
         ORDER BY CASE WHEN LOWER(username)='sabrina' THEN 0 ELSE 1 END`,
      ) as { id: string; display_name: string; username: string }[];
      if (!candidates.length || (candidates.length > 1 && candidates[0].username.toLowerCase() !== 'sabrina'))
        throw new BadRequestException('Não encontrei uma única atendente ativa chamada Sabrina. Confira a equipe antes de importar.');
      sabrina = candidates[0];
    }

    const identities = await this.db.query(
      `SELECT ids.chat_id AS "chatId", COALESCE(NULLIF(p.data->>'phone',''), CASE WHEN ids.chat_id ~ '^[0-9]+@(c[.]us|s[.]whatsapp[.]net)$' THEN split_part(ids.chat_id,'@',1) ELSE lm.phone END, '') AS phone,
              (p.chat_id IS NOT NULL) AS "hasProfile"
       FROM (SELECT chat_id FROM openwa.contact_profiles WHERE session_id=$1
             UNION SELECT "chatId" FROM openwa.messages WHERE "sessionId"=$1
             UNION SELECT chat_id FROM openwa.conversation_assignments WHERE session_id=$1) ids
       LEFT JOIN openwa.contact_profiles p ON p.session_id=$1 AND p.chat_id=ids.chat_id
       LEFT JOIN openwa.lid_mappings lm ON ids.chat_id LIKE '%@lid' AND lm.lid=split_part(ids.chat_id,'@',1)`,
      [session],
    ) as Identity[];
    const engine = this.engines.get(session);
    if (engine) {
      try {
        for (const contact of await engine.getContacts()) {
          if (!contact.id || !contact.number || !contact.id.endsWith('@lid')) continue;
          const number = digits(contact.number);
          if (number && number !== contact.id.split('@')[0])
            identities.push({ chatId: contact.id, phone: number, hasProfile: false });
        }
      } catch { /* Existing database identities remain usable when WhatsApp is disconnected. */ }
    }
    const byPhone = new Map<string, Identity[]>();
    for (const identity of identities) {
      const phone = digits(identity.phone);
      if (!phone) continue;
      const candidates = byPhone.get(phone) || [];
      if (!candidates.some(candidate => candidate.chatId === identity.chatId)) candidates.push(identity);
      byPhone.set(phone, candidates);
    }
    // Never choose arbitrarily between two existing chats with the same phone: that would overwrite one history.
    for (const row of rows) {
      const candidates = byPhone.get(row.phone) || [];
      if (candidates.length > 1) throw new BadRequestException(`O telefone ${row.phone} está ligado a mais de uma conversa. Corrija essa duplicidade antes de importar.`);
    }

    const assignments: { chatId: string; updatedAt: Date }[] = [];
    const outcome = await this.db.transaction(async db => {
      let created = 0, updated = 0, assigned = 0;
      for (const row of rows) {
        const existing = byPhone.get(row.phone)?.[0];
        const chatId = existing?.chatId || `${row.phone}@c.us`;
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([session, chatId])]);
        const [profile] = await db.query('SELECT data FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2', [session, chatId]);
        const current = (profile?.data || emptyContact()) as ContactData;
        const fullName = [row.firstName, row.lastName].filter(Boolean).join(' ');
        const merged: ContactData = {
          ...current,
          name: fullName || usefulName(current.name),
          phone: row.phone,
          tags: mergeTags(current.tags, row.tags),
          directoryHidden: false,
        };
        if (row.tags.some(isAssignmentTag) && current.status === 'closed') {
          merged.status = 'open';
          delete merged.closedAt;
          delete merged.queueOpenedAt;
        }
        await db.query(
          `INSERT INTO openwa.contact_profiles (session_id,chat_id,data,revision) VALUES ($1,$2,$3::jsonb,1)
           ON CONFLICT(session_id,chat_id) DO UPDATE SET data=EXCLUDED.data,revision=openwa.contact_profiles.revision+1,updated_at=NOW()`,
          [session, chatId, JSON.stringify(merged)],
        );
        if (existing) updated++; else created++;
        if (sabrina && row.tags.some(isAssignmentTag)) {
          const [assignment] = await db.query(
            `INSERT INTO openwa.conversation_assignments (session_id,chat_id,assignee_id,assignee_name,updated_at)
             VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT(session_id,chat_id) DO UPDATE SET
             assignee_id=EXCLUDED.assignee_id,assignee_name=EXCLUDED.assignee_name,
             updated_at=CASE WHEN openwa.conversation_assignments.assignee_id IS DISTINCT FROM EXCLUDED.assignee_id THEN NOW() ELSE openwa.conversation_assignments.updated_at END
             RETURNING updated_at`,
            [session, chatId, sabrina.id, sabrina.display_name],
          );
          assignments.push({ chatId, updatedAt: assignment.updated_at });
          assigned++;
        }
      }
      return { created, updated, assigned };
    });
    for (const assignment of assignments) {
      try {
        this.events.emitConversationAssigned(session, {
          chatId: assignment.chatId,
          assigneeId: sabrina!.id,
          assigneeName: sabrina!.display_name,
          assignedById: context.user.id,
          assignedByName: context.user.displayName,
          updatedAt: assignment.updatedAt,
        });
      } catch { /* The import is committed; a notification failure must not invite a duplicate retry. */ }
    }
    return outcome;
  }
}

@Public()
@Controller('operator-auth/contacts')
export class ContactImportController {
  constructor(private readonly importer: ContactImportService) {}

  @Post(':session/import')
  import(@Headers('x-atende-token') token = '', @Param('session') session: string, @Body() body: unknown) {
    return this.importer.import(token, session, body);
  }
}
