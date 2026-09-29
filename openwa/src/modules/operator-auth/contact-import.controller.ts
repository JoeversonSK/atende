import { BadRequestException, Body, Controller, Headers, Injectable, Param, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../auth/decorators/auth.decorators';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { EventsGateway } from '../events/events.gateway';
import { OperatorAuthService } from './operator-auth.service';
import { ContactData, emptyContact } from './contact-profile.controller';

type ImportRow = { firstName: string; lastName: string; phone: string; tags: string[] };
type Identity = { chatId: string; phone: string; name?: string; hasProfile: boolean; hidden?: boolean };
const assignmentTag = 'Sabrina - Atribuido';
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const isAssignmentTag = (value: string) => value.trim().localeCompare(assignmentTag, 'pt-BR', { sensitivity: 'base' }) === 0;
const usefulName = (value: unknown) => /[\p{L}\p{N}]/u.test(String(value ?? '')) ? String(value).trim() : '';
const nameKey = (value: unknown) => usefulName(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const distinctiveName = (value: string) => value.split(' ').length >= 2 && value.length >= 8;

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

  async reconcile(token: string, session: string) {
    await this.auth.requirePermission(token, 'canAssign');
    const context = await this.auth.connectionContext(token);
    if (context.sessionId !== session) throw new BadRequestException('Sessão do WhatsApp inválida.');
    const engine = this.engines.get(session);
    if (!engine) throw new BadRequestException('Conecte o WhatsApp para identificar as conversas antigas.');
    const chats = await engine.getChats();
    const lidsByName = new Map<string, string[]>();
    for (const chat of chats) {
      if (!chat.id.endsWith('@lid')) continue;
      const key = nameKey(chat.name);
      if (!distinctiveName(key)) continue;
      lidsByName.set(key, [...(lidsByName.get(key) || []), chat.id]);
    }
    const profiles = await this.db.query(
      `SELECT p.chat_id AS "chatId",p.data FROM openwa.contact_profiles p WHERE p.session_id=$1
       AND p.chat_id ~ '^[0-9]+@c[.]us$' AND COALESCE((p.data->>'directoryHidden')::boolean,false)=false
       AND NULLIF(p.data->>'phone','') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM openwa.messages m WHERE m."sessionId"=p.session_id AND m."chatId"=p.chat_id)`,
      [session],
    ) as { chatId: string; data: ContactData }[];
    const profilesByName = new Map<string, { chatId: string; data: ContactData }[]>();
    for (const profile of profiles) {
      const key = nameKey(profile.data.name);
      if (!distinctiveName(key) || !digits(profile.data.phone)) continue;
      profilesByName.set(key, [...(profilesByName.get(key) || []), profile]);
    }
    const candidates = [...profilesByName].filter(([key, values]) => values.length === 1 && lidsByName.get(key)?.length === 1)
      .map(([, values]) => values[0]);
    const errors: string[] = [];
    for (let index = 0; index < candidates.length; index += 25) {
      const batch = candidates.slice(index, index + 25).map(({ data }) => ({ firstName: data.name, lastName: '', phone: data.phone,
        tags: Array.isArray(data.tags) ? data.tags : [] }));
      try {
        await this.import(token, session, { contacts: batch });
      } catch (error) {
        for (const row of batch) {
          try { await this.import(token, session, { contacts: [row] }); }
          catch (individualError) { errors.push(individualError instanceof Error ? individualError.message : 'Não foi possível reconciliar um contato.'); }
        }
      }
    }
    const [count] = candidates.length ? await this.db.query(
      `SELECT COUNT(*)::integer AS total FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=ANY($2::text[])
       AND COALESCE((data->>'directoryHidden')::boolean,false)=true`,
      [session, candidates.map(candidate => candidate.chatId)],
    ) as { total: number }[] : [{ total: 0 }];
    return { candidates: candidates.length, reconciled: count.total, skipped: candidates.length - count.total,
      errors: errors.slice(0, 5) };
  }

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
              p.data->>'name' AS name, (p.chat_id IS NOT NULL) AS "hasProfile", COALESCE((p.data->>'directoryHidden')::boolean,false) AS hidden
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
            identities.push({ chatId: contact.id, phone: number, name: contact.name || contact.pushName, hasProfile: false });
        }
      } catch { /* Existing database identities remain usable when WhatsApp is disconnected. */ }
    }
    const chatNames = new Map<string, string>();
    let chatsLoaded = false;
    if (engine) {
      try {
        for (const chat of await engine.getChats()) {
          if (!chat.id.endsWith('@lid') || !nameKey(chat.name)) continue;
          chatNames.set(chat.id, chat.name);
          if (!identities.some(identity => identity.chatId === chat.id))
            identities.push({ chatId: chat.id, phone: '', name: chat.name, hasProfile: false });
        }
        chatsLoaded = true;
      } catch { /* Import can still use stored phone mappings, but will not guess unknown LID identities. */ }
    }
    const importedNameKeys = new Set(rows.map(row => nameKey([row.firstName, row.lastName].filter(Boolean).join(' '))));
    if (engine?.resolveContactPhone) {
      for (const identity of identities) {
        if (!identity.chatId.endsWith('@lid') || digits(identity.phone) ||
            !importedNameKeys.has(nameKey(chatNames.get(identity.chatId) || identity.name))) continue;
        try {
          const resolved = digits(await engine.resolveContactPhone(identity.chatId));
          if (resolved && resolved !== identity.chatId.split('@')[0]) identity.phone = resolved;
        } catch { /* A failed WhatsApp lookup is not proof that two contacts are different. */ }
      }
    }
    const identityByChat = new Map<string, Identity>();
    for (const identity of identities) {
      const previous = identityByChat.get(identity.chatId);
      if (!previous) { identityByChat.set(identity.chatId, { ...identity }); continue; }
      if (digits(previous.phone) && digits(identity.phone) && digits(previous.phone) !== digits(identity.phone))
        throw new BadRequestException(`O contato ${identity.chatId} apresenta telefones divergentes. Revise antes de importar.`);
      identityByChat.set(identity.chatId, {
        ...previous, phone: previous.phone || identity.phone, name: previous.name || identity.name,
        hasProfile: previous.hasProfile || identity.hasProfile, hidden: previous.hidden || identity.hidden,
      });
    }
    const uniqueIdentities = [...identityByChat.values()];
    const byPhone = new Map<string, Identity[]>();
    for (const identity of uniqueIdentities) {
      const phone = digits(identity.phone);
      if (!phone || identity.hidden) continue;
      const candidates = byPhone.get(phone) || [];
      if (!candidates.some(candidate => candidate.chatId === identity.chatId)) candidates.push(identity);
      byPhone.set(phone, candidates);
    }
    const unresolvedByName = new Map<string, string[]>();
    for (const identity of uniqueIdentities) {
      if (!identity.chatId.endsWith('@lid') || identity.hidden || digits(identity.phone)) continue;
      const key = nameKey(chatNames.get(identity.chatId) || identity.name);
      if (!distinctiveName(key)) continue;
      const matches = unresolvedByName.get(key) || [];
      if (!matches.includes(identity.chatId)) matches.push(identity.chatId);
      unresolvedByName.set(key, matches);
    }
    const sheetNameCounts = new Map<string, number>();
    for (const row of rows) {
      const key = nameKey([row.firstName, row.lastName].filter(Boolean).join(' '));
      if (distinctiveName(key)) sheetNameCounts.set(key, (sheetNameCounts.get(key) || 0) + 1);
    }

    const plans = rows.map(row => {
      const candidates = byPhone.get(row.phone) || [];
      const key = nameKey([row.firstName, row.lastName].filter(Boolean).join(' '));
      const nameMatches = distinctiveName(key) && sheetNameCounts.get(key) === 1 ? unresolvedByName.get(key) || [] : [];
      if (nameMatches.length > 1) throw new BadRequestException(`Mais de uma conversa sem telefone corresponde a ${row.firstName} ${row.lastName}. Revise manualmente antes de importar.`);
      if (!candidates.length && !nameMatches.length && !chatsLoaded && uniqueIdentities.some(identity => identity.chatId.endsWith('@lid') && !digits(identity.phone)))
        throw new BadRequestException('Não consegui consultar as conversas sem telefone. Conecte o WhatsApp antes de importar novos contatos para evitar duplicados.');
      const lid = nameMatches[0] || (candidates.length === 2 && candidates.filter(candidate => candidate.chatId.endsWith('@lid')).length === 1
        ? candidates.find(candidate => candidate.chatId.endsWith('@lid'))?.chatId : undefined);
      const chatId = lid || candidates[0]?.chatId || `${row.phone}@c.us`;
      const others = candidates.filter(candidate => candidate.chatId !== chatId);
      if (others.length > 1 || (!lid && candidates.length > 1) || others.some(candidate => !candidate.chatId.endsWith('@c.us')))
        throw new BadRequestException(`O telefone ${row.phone} está ligado a mais de uma conversa. Revise essa duplicidade antes de importar.`);
      return { row, chatId, duplicateId: lid ? others[0]?.chatId : undefined,
        existed: Boolean(lid || candidates.length) };
    });

    const assignments: { chatId: string; updatedAt: Date }[] = [];
    const outcome = await this.db.transaction(async db => {
      let created = 0, updated = 0, assigned = 0;
      for (const { row, chatId, duplicateId, existed } of plans) {
        for (const id of [chatId, duplicateId].filter((value): value is string => Boolean(value)).sort())
          await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([session, id])]);
        let duplicate: ContactData | undefined;
        if (duplicateId) {
          const [message] = await db.query('SELECT 1 FROM openwa.messages WHERE "sessionId"=$1 AND "chatId"=$2 LIMIT 1', [session, duplicateId]);
          if (message) throw new BadRequestException(`O cadastro duplicado de ${row.firstName} ${row.lastName} também tem mensagens. Revise manualmente antes de unificar.`);
          const [duplicateProfile] = await db.query('SELECT data FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2', [session, duplicateId]);
          duplicate = duplicateProfile?.data as ContactData | undefined;
        }
        const [profile] = await db.query('SELECT data FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2', [session, chatId]);
        const current = (profile?.data || emptyContact()) as ContactData;
        const fullName = [row.firstName, row.lastName].filter(Boolean).join(' ');
        const merged: ContactData = {
          ...current,
          name: fullName || usefulName(current.name),
          phone: row.phone,
          tags: mergeTags(mergeTags(current.tags, duplicate?.tags || []), row.tags),
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
        if (duplicateId) {
          await db.query(
            `UPDATE openwa.contact_profiles SET data=jsonb_set(data,'{directoryHidden}','true'::jsonb),revision=revision+1,updated_at=NOW()
             WHERE session_id=$1 AND chat_id=$2`, [session, duplicateId],
          );
          const [sourceOwner] = await db.query('SELECT assignee_id,assignee_name,updated_at FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2', [session, duplicateId]);
          if (sourceOwner) {
            await db.query(
              `INSERT INTO openwa.conversation_assignments (session_id,chat_id,assignee_id,assignee_name,updated_at)
               VALUES ($1,$2,$3,$4,$5) ON CONFLICT(session_id,chat_id) DO NOTHING`,
              [session, chatId, sourceOwner.assignee_id, sourceOwner.assignee_name, sourceOwner.updated_at],
            );
            await db.query('DELETE FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2', [session, duplicateId]);
          }
        }
        if (existed) updated++; else created++;
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

  @Post(':session/reconcile')
  reconcile(@Headers('x-atende-token') token = '', @Param('session') session: string) {
    return this.importer.reconcile(token, session);
  }

  @Post(':session/import')
  import(@Headers('x-atende-token') token = '', @Param('session') session: string, @Body() body: unknown) {
    return this.importer.import(token, session, body);
  }
}
