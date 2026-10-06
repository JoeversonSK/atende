import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  Injectable,
  OnModuleInit,
  Optional,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { Public } from '../auth/decorators/auth.decorators';
import { OperatorAuthService } from './operator-auth.service';
import { WebhookService } from '../webhook/webhook.service';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { IWhatsAppEngine, PollVoteEvent } from '../../engine/interfaces/whatsapp-engine.interface';
import { ConversationFlowStep } from './operator-auth.service';

const ratingOptions = [1, 2, 3, 4, 5].map(value => '⭐'.repeat(value));
const completedServiceTag = 'Lançar atendimento';
const completedServiceAgents = new Set(['wesley', 'joeverson', 'thiago', 'crislainy', 'gabryel']);
type Queryable = { query(query: string, parameters?: any[]): Promise<any> };
type AssignmentOwner = { assignee_id?: unknown; assignee_name?: unknown; updated_at?: unknown };

export type ContactData = {
  name: string;
  phone: string;
  directoryHidden?: boolean;
  email: string;
  company: string;
  document: string;
  address: string;
  status: string;
  closedAt?: number;
  queueOpenedAt?: number;
  serviceType?: string;
  priority?: string;
  notes: { id: string; text: string; author: string; createdAt: string }[];
  events: { id: string; title: string; date: string }[];
  tags: string[];
  sequences: string[];
  campaigns: string[];
  custom: { id: string; label: string; value: string }[];
};
export const emptyContact = (): ContactData => ({
  name: '',
  phone: '',
  email: '',
  company: '',
  document: '',
  address: '',
  status: 'open',
  serviceType: 'remote',
  priority: 'normal',
  notes: [],
  events: [],
  tags: [],
  sequences: [],
  campaigns: [],
  custom: [],
});
@Injectable()
export class ContactProfileService implements OnModuleInit {
  private isCompletedServiceTag(tag: unknown) {
    return String(tag || '').localeCompare(completedServiceTag, 'pt-BR', { sensitivity: 'base' }) === 0;
  }
  private sharedTags(data?: Partial<ContactData> | null) {
    return (Array.isArray(data?.tags) ? data.tags : [])
      .map(tag => String(tag))
      .filter(tag => !this.isCompletedServiceTag(tag));
  }
  private isCompletedServiceOwner(owner?: AssignmentOwner | null) {
    const firstName = String(owner?.assignee_name || '')
      .trim()
      .split(/\s+/)[0]
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return Boolean(owner?.assignee_id) && completedServiceAgents.has(firstName);
  }
  private async markAssignedCompletion(db: Queryable, session: string, chat: string, owner?: AssignmentOwner | null) {
    if (!this.isCompletedServiceOwner(owner)) return;
    await db.query(
      'INSERT INTO openwa.contact_operator_tags (session_id,chat_id,operator_id,tag) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [session, chat, String(owner?.assignee_id), completedServiceTag],
    );
  }
  private async dataForOperator(db: Queryable, session: string, chat: string, data: ContactData, operatorId: string) {
    const rows = await db.query(
      'SELECT tag FROM openwa.contact_operator_tags WHERE session_id=$1 AND chat_id=$2 AND operator_id=$3 ORDER BY tag',
      [session, chat, operatorId],
    );
    return {
      ...data,
      tags: Array.from(new Set([...this.sharedTags(data), ...rows.map((row: { tag: string }) => row.tag)])),
    };
  }
  async registerFlowContinuation(token: string, session: string, chat: string, input: unknown) {
    const user = await this.auth.requirePermission(token, 'canSend');
    this.identifiers(session, chat);
    const value =
      input && typeof input === 'object'
        ? (input as { steps?: ConversationFlowStep[]; expectedOptions?: string[]; pollMessageId?: string })
        : {};
    const steps = Array.isArray(value.steps) ? value.steps.slice(0, 30) : [];
    const expectedOptions = Array.isArray(value.expectedOptions)
      ? value.expectedOptions
          .map(option => String(option || '').trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];
    const pollMessageId = String(value.pollMessageId || '').trim();
    if (expectedOptions.length < 2) throw new BadRequestException('A lista precisa ter pelo menos duas alternativas.');
    if (!pollMessageId || pollMessageId.length > 255)
      throw new BadRequestException('Não foi possível acompanhar a resposta desta enquete.');
    await this.db.query(
      `INSERT INTO openwa.support_flow_runs (session_id,chat_id,steps,expected_options,poll_message_id,actor_id,actor_name,updated_at)
      VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,NOW()) ON CONFLICT(session_id,chat_id) DO UPDATE SET steps=EXCLUDED.steps,expected_options=EXCLUDED.expected_options,poll_message_id=EXCLUDED.poll_message_id,actor_id=EXCLUDED.actor_id,actor_name=EXCLUDED.actor_name,updated_at=NOW()`,
      [session, chat, JSON.stringify(steps), JSON.stringify(expectedOptions), pollMessageId, user.id, user.displayName],
    );
    return { success: true, waiting: true };
  }
  async handleFlowListResponse(session: string, engine: IWhatsAppEngine, chat: string, selected: string) {
    const [run] = await this.db.query(
      "SELECT steps,expected_options,actor_id,actor_name FROM openwa.support_flow_runs WHERE session_id=$1 AND chat_id=$2 AND updated_at>NOW()-INTERVAL '30 days'",
      [session, chat],
    );
    if (!run) return false;
    const expected = Array.isArray(run.expected_options) ? run.expected_options : [];
    if (!expected.includes(String(selected || '').trim())) return false;
    const removed = await this.db.query(
      'DELETE FROM openwa.support_flow_runs WHERE session_id=$1 AND chat_id=$2 RETURNING session_id',
      [session, chat],
    );
    if (!removed.length) return false;
    const steps = Array.isArray(run.steps) ? (run.steps as ConversationFlowStep[]) : [];
    await this.executeFlowContinuation(
      session,
      chat,
      engine,
      steps,
      String(run.actor_id || ''),
      String(run.actor_name || ''),
    );
    return true;
  }
  async handleFlowPollVote(session: string, engine: IWhatsAppEngine, event: PollVoteEvent) {
    if (event.selectedOptions.length !== 1) return false;
    const [run] = await this.db.query(
      "SELECT chat_id,steps,expected_options,actor_id,actor_name FROM openwa.support_flow_runs WHERE session_id=$1 AND poll_message_id=$2 AND updated_at>NOW()-INTERVAL '30 days'",
      [session, event.pollMessageId],
    );
    if (!run) return false;
    const selected = String(event.selectedOptions[0] || '').trim(),
      expected = Array.isArray(run.expected_options) ? run.expected_options : [];
    if (!expected.includes(selected)) return false;
    const removed = await this.db.query(
      'DELETE FROM openwa.support_flow_runs WHERE session_id=$1 AND chat_id=$2 AND poll_message_id=$3 RETURNING session_id',
      [session, run.chat_id, event.pollMessageId],
    );
    if (!removed.length) return false;
    const selectedAt =
      Number.isFinite(event.timestamp) && event.timestamp > 0 ? event.timestamp : Math.floor(Date.now() / 1000);
    await this.db.query(
      `INSERT INTO openwa.messages (id,"sessionId","waMessageId","chatId","from","to",body,type,direction,timestamp,metadata,status,"createdAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,'poll_response','incoming',$8,$9::jsonb,'sent',NOW())`,
      [
        randomUUID(),
        session,
        `flow-poll-vote:${randomUUID()}`,
        run.chat_id,
        event.voterId || run.chat_id,
        session,
        selected,
        selectedAt,
        JSON.stringify({ pollMessageId: event.pollMessageId, selectedOptions: event.selectedOptions }),
      ],
    );
    const steps = Array.isArray(run.steps) ? (run.steps as ConversationFlowStep[]) : [];
    await this.executeFlowContinuation(
      session,
      String(run.chat_id),
      engine,
      steps,
      String(run.actor_id || ''),
      String(run.actor_name || ''),
    );
    return true;
  }
  private async executeFlowContinuation(
    session: string,
    chat: string,
    engine: IWhatsAppEngine,
    steps: ConversationFlowStep[],
    actorId: string,
    actorName: string,
  ) {
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index],
        type = step.type || 'message',
        delay = Math.max(0, Math.min(3600, Number(step.delaySeconds) || 0));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay * 1000));
      if (type === 'delay') continue;
      if (type === 'message') {
        if (step.text) await engine.sendTextMessage(chat, step.text);
        continue;
      }
      if (type === 'poll') {
        const options = (step.options || [])
          .map(option => String(option || '').trim())
          .filter(Boolean)
          .slice(0, 12);
        if (!step.question || options.length < 2) continue;
        const poll = await engine.sendPollMessage(chat, { name: step.question, options, allowMultipleAnswers: false });
        const remaining = steps.slice(index + 1);
        if (remaining.length)
          await this.db.query(
            `INSERT INTO openwa.support_flow_runs (session_id,chat_id,steps,expected_options,poll_message_id,actor_id,actor_name,updated_at)
          VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,NOW()) ON CONFLICT(session_id,chat_id) DO UPDATE SET steps=EXCLUDED.steps,expected_options=EXCLUDED.expected_options,poll_message_id=EXCLUDED.poll_message_id,actor_id=EXCLUDED.actor_id,actor_name=EXCLUDED.actor_name,updated_at=NOW()`,
            [session, chat, JSON.stringify(remaining), JSON.stringify(options), poll.id, actorId, actorName],
          );
        return;
      }
      if (['image', 'video', 'audio', 'document'].includes(type) && step.data) {
        const media = {
          data: step.data,
          mimetype: step.mimetype || 'application/octet-stream',
          filename: step.filename || 'arquivo',
          caption: step.caption || undefined,
        };
        if (type === 'image') await engine.sendImageMessage(chat, media);
        else if (type === 'video') await engine.sendVideoMessage(chat, media);
        else if (type === 'audio') await engine.sendAudioMessage(chat, media);
        else await engine.sendDocumentMessage(chat, media);
        continue;
      }
      if (type === 'action' && step.action === 'assign-current' && actorId) {
        await this.db.query(
          'INSERT INTO openwa.conversation_assignments (session_id,chat_id,assignee_name,assignee_id,updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT(session_id,chat_id) DO UPDATE SET assignee_name=EXCLUDED.assignee_name,assignee_id=EXCLUDED.assignee_id,updated_at=NOW()',
          [session, chat, actorName, actorId],
        );
      } else if (type === 'action' && step.action === 'close-ticket') await this.closeForFlow(session, chat);
    }
  }
  private async closeForFlow(session: string, chat: string) {
    await this.db.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([session, chat])]);
      const [current] = await db.query(
        'SELECT data,revision FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',
        [session, chat],
      );
      const [owner] = await db.query(
        'SELECT assignee_id,assignee_name,updated_at FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2 FOR UPDATE',
        [session, chat],
      );
      await db.query('DELETE FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2', [session, chat]);
      if (current?.data?.status === 'closed') return;
      if (owner) {
        const seconds = owner.updated_at
          ? Math.max(0, Math.floor((Date.now() - new Date(owner.updated_at).getTime()) / 1000))
          : 0;
        await db.query(
          'INSERT INTO openwa.support_completions (id,session_id,chat_id,assignee_id,assignee_name,duration_seconds) VALUES ($1,$2,$3,$4,$5,$6)',
          [randomUUID(), session, chat, owner.assignee_id, owner.assignee_name, seconds],
        );
      }
      await this.markAssignedCompletion(db, session, chat, owner);
      const base = { ...(current?.data || emptyContact()) } as ContactData;
      const data = {
        ...base,
        status: 'closed',
        closedAt: Date.now(),
        tags: this.sharedTags(base),
      };
      await db.query(
        'INSERT INTO openwa.contact_profiles (session_id,chat_id,data,revision) VALUES ($1,$2,$3,$4) ON CONFLICT(session_id,chat_id) DO UPDATE SET data=EXCLUDED.data,revision=EXCLUDED.revision,updated_at=NOW()',
        [session, chat, JSON.stringify(data), (current?.revision || 0) + 1],
      );
    });
  }
  async startEvaluation(token: string, session: string, chat: string) {
    await this.auth.requirePermission(token, 'canSend');
    await this.auth.requirePermission(token, 'canAssign');
    this.identifiers(session, chat);
    const engine = this.engines.require(
      session,
      () => new ConflictException('O WhatsApp precisa estar conectado para enviar a avaliação.'),
    );
    const technicians = (
      (await this.db.query(
        'SELECT id,display_name AS name FROM openwa.operator_users WHERE active=true ORDER BY display_name,id',
      )) as { id: string; name: string }[]
    ).map(item => ({ ...item, option: item.name.slice(0, 88) }));
    if (!technicians.length)
      throw new ConflictException('Cadastre pelo menos um técnico ativo antes de enviar a avaliação.');
    const duplicateOptions = new Set<string>();
    for (const technician of technicians) {
      let option = technician.option,
        suffix = 2;
      while (duplicateOptions.has(option)) {
        option = `${technician.name.slice(0, 82)} (${suffix++})`;
      }
      technician.option = option;
      duplicateOptions.add(option);
    }
    const pageOptions = Array.from(
      { length: Math.ceil(technicians.length / 12) },
      (_, page) => `Técnicos ${page * 12 + 1} a ${Math.min((page + 1) * 12, technicians.length)}`,
    );
    try {
      await engine.sendTextMessage(chat, 'Valorizamos sua opinião! Por favor, avalie como foi seu atendimento 😁🌟:');
      const poll = await engine.sendPollMessage(chat, {
        name: 'Quem realizou seu atendimento?',
        options: technicians.length <= 12 ? technicians.map(item => item.option) : pageOptions,
        allowMultipleAnswers: false,
      });
      await this.db.query(
        `INSERT INTO openwa.support_evaluations (session_id,chat_id,stage,technicians,poll_message_id,technician_id,technician_name,rating,completed_at,updated_at)
        VALUES ($1,$2,$4,$3::jsonb,$5,NULL,NULL,NULL,NULL,NOW()) ON CONFLICT(session_id,chat_id) DO UPDATE SET stage=EXCLUDED.stage,technicians=EXCLUDED.technicians,poll_message_id=EXCLUDED.poll_message_id,technician_id=NULL,technician_name=NULL,rating=NULL,completed_at=NULL,updated_at=NOW()`,
        [
          session,
          chat,
          JSON.stringify(technicians),
          technicians.length > 12 ? 'technician_page' : 'technician',
          poll.id,
        ],
      );
    } catch (error) {
      await this.db.query('DELETE FROM openwa.support_evaluations WHERE session_id=$1 AND chat_id=$2', [session, chat]);
      throw error;
    }
    const closed = await this.close(token, session, chat);
    return { success: true, data: closed.data, revision: closed.revision };
  }
  async handleEvaluationPollVote(session: string, engine: IWhatsAppEngine, event: PollVoteEvent) {
    if (event.selectedOptions.length !== 1) return false;
    return this.db.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify(['evaluation', session, event.pollMessageId]),
      ]);
      const [evaluation] = await db.query(
        "SELECT * FROM openwa.support_evaluations WHERE session_id=$1 AND poll_message_id=$2 AND completed_at IS NULL AND updated_at>NOW()-INTERVAL '30 days' FOR UPDATE",
        [session, event.pollMessageId],
      );
      if (!evaluation) return false;
      const selected = event.selectedOptions[0],
        technicians = Array.isArray(evaluation.technicians) ? evaluation.technicians : [];
      if (evaluation.stage === 'technician_page') {
        const pages = Array.from(
            { length: Math.ceil(technicians.length / 12) },
            (_, page) => `Técnicos ${page * 12 + 1} a ${Math.min((page + 1) * 12, technicians.length)}`,
          ),
          page = pages.indexOf(selected);
        if (page < 0) return false;
        const options = technicians.slice(page * 12, page * 12 + 12).map((item: { option: string }) => item.option);
        const poll = await engine.sendPollMessage(evaluation.chat_id, {
          name: 'Quem realizou seu atendimento?',
          options,
          allowMultipleAnswers: false,
        });
        await db.query(
          "UPDATE openwa.support_evaluations SET stage='technician',poll_message_id=$3,updated_at=NOW() WHERE session_id=$1 AND chat_id=$2",
          [session, evaluation.chat_id, poll.id],
        );
        return true;
      }
      if (evaluation.stage === 'technician') {
        const technician = technicians.find((item: { option?: string }) => item.option === selected);
        if (!technician) return false;
        await engine.sendTextMessage(
          evaluation.chat_id,
          'Certo, agora nos informe sua nota com base nas opções abaixo:',
        );
        const poll = await engine.sendPollMessage(evaluation.chat_id, {
          name: 'Selecione uma opção',
          options: ratingOptions,
          allowMultipleAnswers: false,
        });
        await db.query(
          "UPDATE openwa.support_evaluations SET stage='rating',poll_message_id=$3,technician_id=$4,technician_name=$5,updated_at=NOW() WHERE session_id=$1 AND chat_id=$2",
          [session, evaluation.chat_id, poll.id, technician.id, technician.name],
        );
        return true;
      }
      if (evaluation.stage === 'rating') {
        const rating = ratingOptions.indexOf(selected) + 1;
        if (rating < 1) return false;
        await engine.sendTextMessage(
          evaluation.chat_id,
          'Ficamos muito contentes com sua satisfação! Quando possível, poderia nos avaliar no link abaixo? 💬',
        );
        await engine.sendTextMessage(evaluation.chat_id, 'https://g.page/r/Ced-TdsdSgWfEB0/review');
        await engine.sendTextMessage(
          evaluation.chat_id,
          'Sua opinião colabora para aprimorarmos cada vez mais nossos serviços.\n\nMuito obrigado ☀️😁',
        );
        await db.query(
          "UPDATE openwa.support_evaluations SET stage='completed',rating=$3,completed_at=NOW(),updated_at=NOW() WHERE session_id=$1 AND chat_id=$2",
          [session, evaluation.chat_id, rating],
        );
        return true;
      }
      return false;
    });
  }
  async start(token: string, session: string, chat: string) {
    const user = await this.auth.assignmentTarget(token);
    this.identifiers(session, chat);
    const result = await this.db.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([session, chat])]);
      const [current] = await db.query(
        'SELECT data,revision FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',
        [session, chat],
      );
      const data = {
        ...(current?.data || emptyContact()),
        status: 'open',
        serviceType: 'remote',
        closedAt: undefined,
        queueOpenedAt: undefined,
      };
      data.tags = this.sharedTags(data);
      const [saved] = await db.query(
        'INSERT INTO openwa.contact_profiles (session_id,chat_id,data,revision) VALUES ($1,$2,$3,$4) ON CONFLICT(session_id,chat_id) DO UPDATE SET data=EXCLUDED.data,revision=EXCLUDED.revision,updated_at=NOW() RETURNING data,revision',
        [session, chat, JSON.stringify(data), (current?.revision || 0) + 1],
      );
      const [assignment] = await db.query(
        'INSERT INTO openwa.conversation_assignments (session_id,chat_id,assignee_name,assignee_id,updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT(session_id,chat_id) DO UPDATE SET assignee_name=EXCLUDED.assignee_name,assignee_id=EXCLUDED.assignee_id,updated_at=CASE WHEN openwa.conversation_assignments.assignee_id IS DISTINCT FROM EXCLUDED.assignee_id THEN NOW() ELSE openwa.conversation_assignments.updated_at END RETURNING assignee_name AS "assigneeName",assignee_id AS "assigneeId",updated_at AS "updatedAt"',
        [session, chat, user.displayName, user.id],
      );
      return {
        data: await this.dataForOperator(db, session, chat, saved.data, user.id),
        revision: saved.revision,
        assignment,
      };
    });
    this.publish(session, 'conversation.assigned', { chatId: chat, assignee: result.assignment, contactProfile: result.data, actorId: user.id });
    return result;
  }
  async close(token: string, session: string, chat: string) {
    const user = await this.auth.requirePermission(token, 'canAssign');
    this.identifiers(session, chat);
    const result = await this.db.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([session, chat])]);
      const [current] = await db.query(
        'SELECT data,revision FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',
        [session, chat],
      );
      const [owner] = await db.query(
        'SELECT assignee_id,assignee_name,updated_at FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2 FOR UPDATE',
        [session, chat],
      );
      await db.query('DELETE FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2', [session, chat]);
      if (current?.data?.status === 'closed')
        return {
          ...current,
          data: await this.dataForOperator(db, session, chat, current.data, user.id),
        };
      if (owner) {
        const seconds = owner.updated_at
          ? Math.max(0, Math.floor((Date.now() - new Date(owner.updated_at).getTime()) / 1000))
          : 0;
        await db.query(
          'INSERT INTO openwa.support_completions (id,session_id,chat_id,assignee_id,assignee_name,duration_seconds) VALUES ($1,$2,$3,$4,$5,$6)',
          [randomUUID(), session, chat, owner.assignee_id, owner.assignee_name, seconds],
        );
      }
      await this.markAssignedCompletion(db, session, chat, owner);
      const base = { ...(current?.data || emptyContact()) } as ContactData;
      const data = {
        ...base,
        status: 'closed',
        closedAt: Date.now(),
        tags: this.sharedTags(base),
      };
      const [saved] = await db.query(
        'INSERT INTO openwa.contact_profiles (session_id,chat_id,data,revision) VALUES ($1,$2,$3,$4) ON CONFLICT(session_id,chat_id) DO UPDATE SET data=EXCLUDED.data,revision=EXCLUDED.revision,updated_at=NOW() RETURNING data,revision',
        [session, chat, JSON.stringify(data), (current?.revision || 0) + 1],
      );
      return {
        ...saved,
        data: await this.dataForOperator(db, session, chat, saved.data, user.id),
      };
    });
    this.publish(session, 'conversation.closed', { chatId: chat, contactProfile: result.data, actorId: user.id });
    return result;
  }
  // Called only by the live, deduplicated inbound pipeline, never by history imports.
  async reopenOnIncoming(session: string, chat: string, timestamp: number, fromMe = false, isGroup = false) {
    if (
      fromMe ||
      isGroup ||
      /@(g\\.us|broadcast|newsletter)$/.test(chat) ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0
    )
      return false;
    return this.db.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([session, chat])]);
      const [current] = await db.query(
        'SELECT data,revision,updated_at FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',
        [session, chat],
      );
      if (current?.data?.status !== 'closed') return false;
      const closedAt = current.data.closedAt || new Date(current.updated_at).getTime();
      // WhatsApp timestamps have second precision; exclude earlier seconds and offline history.
      if (timestamp < Math.floor(closedAt / 1000)) return false;
      const data = {
        ...current.data,
        status: 'open',
        serviceType: 'remote',
        queueOpenedAt: timestamp,
        tags: this.sharedTags(current.data),
      };
      await db.query('DELETE FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2', [session, chat]);
      await db.query(
        'UPDATE openwa.contact_profiles SET data=$3,revision=revision+1,updated_at=NOW() WHERE session_id=$1 AND chat_id=$2',
        [session, chat, JSON.stringify(data)],
      );
      return true;
    });
  }
  async overview(token: string, session: string) {
    const user = await this.auth.me(token);
    this.identifiers(session, 'overview');
    const contacts = await this.db.query(
      'SELECT chat_id AS "chatId",data FROM openwa.contact_profiles WHERE session_id=$1',
      [session],
    );
    const operatorTags = await this.db.query(
      'SELECT chat_id AS "chatId",tag FROM openwa.contact_operator_tags WHERE session_id=$1 AND operator_id=$2',
      [session, user.id],
    );
    const tagsByChat = new Map<string, string[]>();
    for (const row of operatorTags as { chatId: string; tag: string }[]) {
      const tags = tagsByChat.get(row.chatId) || [];
      tags.push(row.tag);
      tagsByChat.set(row.chatId, tags);
    }
    for (const contact of contacts as { chatId: string; data: ContactData }[]) {
      contact.data = {
        ...contact.data,
        tags: Array.from(new Set([...this.sharedTags(contact.data), ...(tagsByChat.get(contact.chatId) || [])])),
      };
    }
    const agents = await this.db.query(
      `SELECT id,display_name AS "displayName",
        CASE WHEN activity_until IS NOT NULL AND activity_until<=NOW() THEN 'available' ELSE activity_status END AS "activityStatus",
        CASE WHEN activity_until IS NOT NULL AND activity_until<=NOW() THEN '' ELSE activity_note END AS "activityNote",
        CASE WHEN activity_until IS NOT NULL AND activity_until<=NOW() THEN NULL ELSE activity_until END AS "activityUntil"
        FROM openwa.operator_users WHERE active=true AND dashboard_visible=true ORDER BY display_name`,
    );
    const activity = await this.db.query(
      `WITH activity AS (
      SELECT "chatId",MAX(timestamp) FILTER (WHERE direction='incoming') AS incoming,
      MAX(timestamp) FILTER (WHERE direction='outgoing' AND status NOT IN ('failed','pending')) AS outgoing
      FROM openwa.messages WHERE "sessionId"=$1 GROUP BY "chatId"
    ) SELECT a."chatId",a.incoming,a.outgoing,
      CASE WHEN owner.chat_id IS NOT NULL THEN NULL ELSE (SELECT MIN(m.timestamp) FROM openwa.messages m WHERE m."sessionId"=$1 AND m."chatId"=a."chatId" AND m.direction='incoming' AND m.timestamp>COALESCE(a.outgoing,0) AND m.timestamp>=COALESCE((SELECT (p.data->>'queueOpenedAt')::bigint FROM openwa.contact_profiles p WHERE p.session_id=$1 AND p.chat_id=a."chatId"),0)) END AS "queueSince",
      CASE WHEN a.outgoing>COALESCE(a.incoming,0) THEN a.outgoing ELSE NULL END AS "waitingSince"
      ,(SELECT m."chatName" FROM openwa.messages m WHERE m."sessionId"=$1 AND m."chatId"=a."chatId" AND m."chatName" IS NOT NULL ORDER BY m.timestamp DESC NULLS LAST LIMIT 1) AS name
      ,owner.assignee_id AS "assigneeId",COALESCE(agent.display_name,owner.assignee_name) AS "assigneeName",owner.updated_at AS "assignedAt"
      FROM activity a LEFT JOIN openwa.conversation_assignments owner ON owner.session_id=$1 AND owner.chat_id=a."chatId" LEFT JOIN openwa.operator_users agent ON agent.id=owner.assignee_id
      WHERE a."chatId" NOT LIKE '%@g.us' AND a."chatId" NOT LIKE '%@broadcast' AND a."chatId" NOT LIKE '%@newsletter'`,
      [session],
    );
    const onsiteActive = await this.db.query(
      `SELECT v.id,v.user_id AS "assigneeId",u.display_name AS "assigneeName",v.client_name AS "clientName",v.started_at AS "startedAt"
       FROM openwa.operator_onsite_visits v JOIN openwa.operator_users u ON u.id=v.user_id
       WHERE v.session_id=$1 AND v.ended_at IS NULL AND u.active=true AND u.dashboard_visible=true ORDER BY v.started_at`, [session],
    );
    const completed = await this.db.query(
      `WITH finished AS (
        SELECT assignee_id,assignee_name,duration_seconds,closed_at FROM openwa.support_completions WHERE session_id=$1
        UNION ALL
        SELECT v.user_id,u.display_name,GREATEST(0,EXTRACT(EPOCH FROM (v.ended_at-v.started_at))::integer),v.ended_at
        FROM openwa.operator_onsite_visits v JOIN openwa.operator_users u ON u.id=v.user_id
        WHERE v.session_id=$1 AND v.ended_at IS NOT NULL
       ) SELECT c.assignee_id AS "assigneeId",COALESCE(u.display_name,c.assignee_name,'Sem responsável') AS "assigneeName",
         COUNT(*)::int AS count,SUM(c.duration_seconds)::bigint AS "totalSeconds"
       FROM finished c LEFT JOIN openwa.operator_users u ON u.id=c.assignee_id
       WHERE (c.closed_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date
       GROUP BY c.assignee_id,COALESCE(u.display_name,c.assignee_name,'Sem responsável')`, [session],
    );
    return { contacts, agents, activity, completed, onsiteActive };
  }
  constructor(
    @InjectDataSource('data') private readonly db: DataSource,
    private readonly auth: OperatorAuthService,
    private readonly engines: EngineRegistry,
    @Optional() private readonly webhooks?: WebhookService,
  ) {}
  private publish(session: string, event: string, data: Record<string, unknown>) {
    void this.webhooks?.dispatch(session, event, data).catch(() => undefined);
  }
  async onModuleInit() {
    await this.db.query(
      'CREATE TABLE IF NOT EXISTS openwa.contact_profiles (session_id varchar(255) NOT NULL,chat_id varchar(255) NOT NULL,data jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(session_id,chat_id))',
    );
    await this.ensureCompletions();
    await this.db.query(
      'CREATE TABLE IF NOT EXISTS openwa.contact_operator_tags (session_id varchar(255) NOT NULL,chat_id varchar(255) NOT NULL,operator_id varchar(36) NOT NULL,tag varchar(80) NOT NULL,created_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(session_id,chat_id,operator_id,tag))',
    );
    await this.db.query(
      'CREATE INDEX IF NOT EXISTS contact_operator_tags_owner_idx ON openwa.contact_operator_tags(session_id,operator_id,tag)',
    );
    await this.db.query(
      `INSERT INTO openwa.contact_operator_tags (session_id,chat_id,operator_id,tag)
      SELECT latest.session_id,latest.chat_id,latest.assignee_id,$1 FROM (
        SELECT DISTINCT ON (p.session_id,p.chat_id) p.session_id,p.chat_id,c.assignee_id
        FROM openwa.contact_profiles p
        JOIN openwa.support_completions c ON c.session_id=p.session_id AND c.chat_id=p.chat_id
        WHERE COALESCE(p.data->'tags','[]'::jsonb) ? $1
          AND c.assignee_id IS NOT NULL
          AND LOWER(SPLIT_PART(BTRIM(COALESCE(c.assignee_name,'')),' ',1))=ANY($2::text[])
        ORDER BY p.session_id,p.chat_id,c.closed_at DESC
      ) latest ON CONFLICT DO NOTHING`,
      [completedServiceTag, Array.from(completedServiceAgents)],
    );
    await this.db.query(
      `UPDATE openwa.contact_profiles p SET data=jsonb_set(
        p.data,'{tags}',COALESCE((
          SELECT jsonb_agg(item.tag) FROM jsonb_array_elements_text(COALESCE(p.data->'tags','[]'::jsonb)) AS item(tag)
          WHERE LOWER(item.tag)<>LOWER($1)
        ),'[]'::jsonb),true
      ),revision=revision+1,updated_at=NOW()
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.data->'tags','[]'::jsonb)) AS item(tag)
        WHERE LOWER(item.tag)=LOWER($1)
      )`,
      [completedServiceTag],
    );
    await this.db.query(
      "CREATE TABLE IF NOT EXISTS openwa.support_evaluations (session_id varchar(255) NOT NULL,chat_id varchar(255) NOT NULL,stage varchar(20) NOT NULL,technicians jsonb NOT NULL DEFAULT '[]'::jsonb,poll_message_id varchar(255),technician_id varchar(36),technician_name varchar(160),rating integer,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT NOW(),updated_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(session_id,chat_id))",
    );
    await this.db.query('ALTER TABLE openwa.support_evaluations ADD COLUMN IF NOT EXISTS poll_message_id varchar(255)');
    await this.db.query(
      'CREATE INDEX IF NOT EXISTS support_evaluations_poll_idx ON openwa.support_evaluations(session_id,poll_message_id)',
    );
    await this.db.query(
      "CREATE TABLE IF NOT EXISTS openwa.support_flow_runs (session_id varchar(255) NOT NULL,chat_id varchar(255) NOT NULL,steps jsonb NOT NULL DEFAULT '[]'::jsonb,expected_options jsonb NOT NULL DEFAULT '[]'::jsonb,poll_message_id varchar(255),actor_id varchar(36),actor_name varchar(160),updated_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(session_id,chat_id))",
    );
    await this.db.query('ALTER TABLE openwa.support_flow_runs ADD COLUMN IF NOT EXISTS poll_message_id varchar(255)');
    await this.db.query(
      'CREATE INDEX IF NOT EXISTS support_flow_runs_poll_idx ON openwa.support_flow_runs(session_id,poll_message_id)',
    );
  }
  private async ensureCompletions() {
    await this.db.query(
      'CREATE TABLE IF NOT EXISTS openwa.support_completions (id varchar(36) PRIMARY KEY,session_id varchar(255) NOT NULL,chat_id varchar(255) NOT NULL,assignee_id varchar(36),assignee_name varchar(160),closed_at timestamptz NOT NULL DEFAULT NOW(),duration_seconds integer NOT NULL DEFAULT 0)',
    );
    await this.db.query(
      'CREATE INDEX IF NOT EXISTS support_completions_session_closed_idx ON openwa.support_completions(session_id,closed_at)',
    );
  }
  private identifiers(session: string, chat: string) {
    if (!session || !chat || session.length > 255 || chat.length > 255)
      throw new BadRequestException('Contato inválido.');
  }
  async get(token: string, session: string, chat: string) {
    const user = await this.auth.me(token);
    this.identifiers(session, chat);
    const [row] = await this.db.query(
      'SELECT data,revision FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',
      [session, chat],
    );
    if (!row) return { data: emptyContact(), revision: 0 };
    return { ...row, data: await this.dataForOperator(this.db, session, chat, row.data, user.id) };
  }
  async hideFromDirectory(token: string, session: string, chat: string) {
    await this.auth.requirePermission(token, 'canAssign');
    const context = await this.auth.connectionContext(token);
    if (context.sessionId !== session) throw new BadRequestException('Sessão do WhatsApp inválida.');
    this.identifiers(session, chat);
    await this.db.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([session, chat])]);
      const [profile] = await db.query('SELECT data FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2', [session, chat]);
      const data = { ...(profile?.data || emptyContact()), directoryHidden: true };
      await db.query(
        `INSERT INTO openwa.contact_profiles (session_id,chat_id,data,revision) VALUES ($1,$2,$3::jsonb,1)
         ON CONFLICT(session_id,chat_id) DO UPDATE SET data=EXCLUDED.data,revision=openwa.contact_profiles.revision+1,updated_at=NOW()`,
        [session, chat, JSON.stringify(data)],
      );
    });
    return { success: true };
  }
  async tags(token: string, session: string) {
    const user = await this.auth.me(token);
    this.identifiers(session, 'tags');
    const rows = await this.db.query(
      `SELECT DISTINCT tags.tag FROM openwa.contact_profiles p CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(p.data->'tags','[]'::jsonb)) AS tags(tag) WHERE p.session_id=$1 AND BTRIM(tags.tag)<>'' ORDER BY tags.tag`,
      [session],
    );
    const operatorRows = await this.db.query(
      'SELECT DISTINCT tag FROM openwa.contact_operator_tags WHERE session_id=$1 AND operator_id=$2 ORDER BY tag',
      [session, user.id],
    );
    return Array.from(
      new Set([
        ...rows.map((row: { tag: string }) => row.tag).filter((tag: string) => !this.isCompletedServiceTag(tag)),
        ...operatorRows.map((row: { tag: string }) => row.tag),
      ]),
    ).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  async priority(token: string, session: string, chat: string, body: unknown) {
    const user = await this.auth.requirePermission(token, 'canAssign');
    this.identifiers(session, chat);
    const value = String((body as { priority?: unknown })?.priority || '');
    if (!['low', 'normal', 'high'].includes(value)) throw new BadRequestException('Prioridade inválida.');
    return this.db.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([session, chat])]);
      const [current] = await db.query(
        'SELECT data,revision FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',
        [session, chat],
      );
      const data = {
        ...(current?.data || emptyContact()),
        priority: value,
        tags: this.sharedTags(current?.data || emptyContact()),
      };
      const [row] = await db.query(
        'INSERT INTO openwa.contact_profiles (session_id,chat_id,data,revision) VALUES ($1,$2,$3,$4) ON CONFLICT(session_id,chat_id) DO UPDATE SET data=EXCLUDED.data,revision=EXCLUDED.revision,updated_at=NOW() RETURNING data,revision',
        [session, chat, JSON.stringify(data), (current?.revision || 0) + 1],
      );
      return { ...row, data: await this.dataForOperator(db, session, chat, row.data, user.id) };
    });
  }
  async save(token: string, session: string, chat: string, body: unknown) {
    const user = await this.auth.requirePermission(token, 'canAssign');
    this.identifiers(session, chat);
    const input = body as { revision: number; data: ContactData };
    if (
      !input ||
      !Number.isInteger(input.revision) ||
      input.revision < 0 ||
      !input.data ||
      JSON.stringify(input.data).length > 64000
    )
      throw new BadRequestException('Dados inválidos ou muito extensos.');
    const text = (value: unknown, max = 300) => {
      if (typeof value !== 'string' || value.length > max)
        throw new BadRequestException('Revise os campos preenchidos.');
      return value.trim();
    };
    const list = <T>(value: unknown, convert: (item: any) => T): T[] => {
      if (!Array.isArray(value) || value.length > 100)
        throw new BadRequestException('Cada seção aceita até 100 itens.');
      return value.map(convert);
    };
    const d = input.data;
    const requestedOwnCompletionTag = Array.isArray(d.tags) && d.tags.some(tag => this.isCompletedServiceTag(tag));
    const cleaned: ContactData = {
      name: text(d.name),
      phone: text(d.phone, 50),
      email: text(d.email),
      company: text(d.company),
      document: text(d.document, 50),
      address: text(d.address, 1000),
      status: text(d.status, 20),
      serviceType: 'remote',
      priority: text(d.priority ?? 'normal', 20),
      notes: list(d.notes, n => ({ id: text(n?.id, 80), text: text(n?.text, 5000), author: '', createdAt: '' })),
      events: list(d.events, e => ({ id: text(e?.id, 80), title: text(e?.title), date: text(e?.date, 30) })),
      tags: list(d.tags, v => text(v, 80)),
      sequences: list(d.sequences, v => text(v, 160)),
      campaigns: list(d.campaigns, v => text(v, 160)),
      custom: list(d.custom, c => ({ id: text(c?.id, 80), label: text(c?.label, 100), value: text(c?.value, 2000) })),
    };
    cleaned.tags = this.sharedTags(cleaned);
    if (!['remote', 'onsite'].includes(cleaned.serviceType!) || !['low', 'normal', 'high'].includes(cleaned.priority!))
      throw new BadRequestException('Tipo ou prioridade inválida.');
    if (!['open', 'pending', 'closed'].includes(cleaned.status)) throw new BadRequestException('Status inválido.');
    if (
      cleaned.events.some(e => !e.title || !e.date || !Number.isFinite(Date.parse(e.date))) ||
      cleaned.notes.some(n => !n.id || !n.text) ||
      cleaned.custom.some(c => !c.id || !c.label)
    )
      throw new BadRequestException('Preencha os títulos, notas e datas.');
    if (new Set(cleaned.notes.map(n => n.id)).size !== cleaned.notes.length)
      throw new BadRequestException('Notas duplicadas.');
    const result = await this.db.transaction(async db => {
      // Serialize initial creation as well as later edits of this contact.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([session, chat])]);
      const [current] = await db.query(
        'SELECT data,revision FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',
        [session, chat],
      );
      if ((current?.revision || 0) !== input.revision)
        throw new ConflictException(
          'Outra pessoa atualizou este perfil. Recarregue antes de salvar para não sobrescrever as alterações.',
        );
      if (
        requestedOwnCompletionTag &&
        this.isCompletedServiceOwner({ assignee_id: user.id, assignee_name: user.displayName })
      )
        await db.query(
          'INSERT INTO openwa.contact_operator_tags (session_id,chat_id,operator_id,tag) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [session, chat, user.id, completedServiceTag],
        );
      else
        await db.query(
          'DELETE FROM openwa.contact_operator_tags WHERE session_id=$1 AND chat_id=$2 AND operator_id=$3 AND tag=$4',
          [session, chat, user.id, completedServiceTag],
        );
      if (cleaned.status === 'closed' && current?.data?.status !== 'closed') {
        const [owner] = await db.query(
          'SELECT assignee_id,assignee_name,updated_at FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2',
          [session, chat],
        );
        const seconds = owner?.updated_at
          ? Math.max(0, Math.floor((Date.now() - new Date(owner.updated_at).getTime()) / 1000))
          : 0;
        await db.query(
          'INSERT INTO openwa.support_completions (id,session_id,chat_id,assignee_id,assignee_name,duration_seconds) VALUES ($1,$2,$3,$4,$5,$6)',
          [randomUUID(), session, chat, owner?.assignee_id || null, owner?.assignee_name || null, seconds],
        );
        await this.markAssignedCompletion(db, session, chat, owner);
      }
      if (current?.data?.status === 'closed' && cleaned.status !== 'closed')
        await db.query(
          'UPDATE openwa.conversation_assignments SET updated_at=NOW() WHERE session_id=$1 AND chat_id=$2',
          [session, chat],
        );
      cleaned.closedAt =
        cleaned.status === 'closed' && current?.data?.status !== 'closed' ? Date.now() : current?.data?.closedAt;
      cleaned.queueOpenedAt = current?.data?.queueOpenedAt;
      cleaned.directoryHidden = current?.data?.directoryHidden === true;
      cleaned.notes = cleaned.notes.map(n => {
        const old = current?.data?.notes?.find((o: ContactData['notes'][number]) => o.id === n.id);
        if (old && old.text !== n.text)
          throw new BadRequestException('Notas existentes não podem ser editadas. Adicione uma nova nota.');
        return old || { ...n, author: user.displayName, createdAt: new Date().toISOString() };
      });
      const [row] = await db.query(
        'INSERT INTO openwa.contact_profiles (session_id,chat_id,data,revision) VALUES ($1,$2,$3,$4) ON CONFLICT(session_id,chat_id) DO UPDATE SET data=EXCLUDED.data,revision=EXCLUDED.revision,updated_at=NOW() RETURNING data,revision',
        [session, chat, JSON.stringify(cleaned), input.revision + 1],
      );
      return { ...row, data: await this.dataForOperator(db, session, chat, row.data, user.id) };
    });
    this.publish(session, 'contact.updated', { chatId: chat, contactProfile: result.data, revision: result.revision, actorId: user.id });
    return result;
  }
}
@Public()
@Controller('operator-auth/contacts')
export class ContactProfileController {
  constructor(private readonly profiles: ContactProfileService) {}
  @Delete(':session/:chat') removeFromDirectory(
    @Headers('x-atende-token') token = '',
    @Param('session') session: string,
    @Param('chat') chat: string,
  ) {
    return this.profiles.hideFromDirectory(token, session, chat);
  }
  @Post(':session/:chat/start') start(
    @Headers('x-atende-token') token = '',
    @Param('session') session: string,
    @Param('chat') chat: string,
  ) {
    return this.profiles.start(token, session, chat);
  }
  @Post(':session/:chat/evaluation') evaluation(
    @Headers('x-atende-token') token = '',
    @Param('session') session: string,
    @Param('chat') chat: string,
  ) {
    return this.profiles.startEvaluation(token, session, chat);
  }
  @Post(':session/:chat/flow-continuation') flowContinuation(
    @Headers('x-atende-token') token = '',
    @Param('session') session: string,
    @Param('chat') chat: string,
    @Body() body: unknown,
  ) {
    return this.profiles.registerFlowContinuation(token, session, chat, body);
  }
  @Post(':session/:chat/close') close(
    @Headers('x-atende-token') token = '',
    @Param('session') session: string,
    @Param('chat') chat: string,
  ) {
    return this.profiles.close(token, session, chat);
  }
  @Get(':session') overview(@Headers('x-atende-token') token = '', @Param('session') session: string) {
    return this.profiles.overview(token, session);
  }
  @Get(':session/catalog/tags') tags(@Headers('x-atende-token') token = '', @Param('session') session: string) {
    return this.profiles.tags(token, session);
  }
  @Put(':session/:chat/priority') priority(
    @Headers('x-atende-token') token = '',
    @Param('session') session: string,
    @Param('chat') chat: string,
    @Body() body: unknown,
  ) {
    return this.profiles.priority(token, session, chat, body);
  }
  @Get(':session/:chat') get(
    @Headers('x-atende-token') token = '',
    @Param('session') session: string,
    @Param('chat') chat: string,
  ) {
    return this.profiles.get(token, session, chat);
  }
  @Put(':session/:chat') save(
    @Headers('x-atende-token') token = '',
    @Param('session') session: string,
    @Param('chat') chat: string,
    @Body() body: unknown,
  ) {
    return this.profiles.save(token, session, chat, body);
  }
}
