import { BadRequestException, ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { IWhatsAppEngine, IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import { ConversationFlowStep, OperatorAuthService } from './operator-auth.service';

type RobotConfig = {
  enabled: boolean;
  message: string;
  flowId: string | null;
  contactName: string;
  contactPhone: string;
  generation: number;
};

const allowedFlowTypes = new Set(['message', 'image', 'video', 'audio', 'document', 'delay']);
const emptyConfig = (): RobotConfig => ({ enabled: false, message: '', flowId: null, contactName: '', contactPhone: '', generation: 0 });
type RobotProfile = { name?: string; phone?: string; email?: string; company?: string; document?: string;
  address?: string; tags?: string[]; status?: string; serviceType?: string; priority?: string;
  cnpjs?: string[]; custom?: { label?: string; value?: string }[] };

export function renderRobotTemplate(value: string, profile: RobotProfile, chatId: string, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const fields: Record<string, string> = {
    atendente: 'Robô', cliente: profile.name || 'cliente', nome: profile.name || 'cliente',
    saudacao: hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite',
    telefone: profile.phone || chatId.replace(/@.*$/, '').replace(/\D/g, ''), email: profile.email || '',
    empresa: profile.company || '', documento: profile.document || '', cpf_cnpj: profile.document || '',
    cnpj: profile.cnpjs?.[0] || profile.document || '', endereco: profile.address || '',
    etiquetas: profile.tags?.join(', ') || '', status: profile.status || '',
    tipo_atendimento: profile.serviceType || '', prioridade: profile.priority || '',
    campos_personalizados: (profile.custom || []).filter(item => item.label?.trim() && item.value?.trim())
      .map(item => `${item.label}: ${item.value}`).join('; '),
    data: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(now),
    hora: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(now),
  };
  return value.replace(/\{\{([a-z_]+)\}\}/g, (match, key: string) => Object.hasOwn(fields, key) ? fields[key] : match);
}

@Injectable()
export class RobotAutomationService implements OnModuleInit {
  constructor(
    @InjectDataSource('data') private readonly db: DataSource,
    private readonly auth: OperatorAuthService,
    private readonly engines: EngineRegistry,
  ) {}

  async onModuleInit() {
    await this.db.query(`CREATE TABLE IF NOT EXISTS openwa.atende_robot_config (
      session_id varchar(255) PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
      message text NOT NULL DEFAULT '', flow_id varchar(36), contact_name varchar(160) NOT NULL DEFAULT '',
      contact_phone varchar(20) NOT NULL DEFAULT '', generation integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )`);
    await this.db.query(`CREATE TABLE IF NOT EXISTS openwa.atende_robot_sends (
      session_id varchar(255) NOT NULL, generation integer NOT NULL, chat_id varchar(255) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'sending', error text,
      created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (session_id, generation, chat_id)
    )`);
  }

  private normalize(input: unknown) {
    const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const enabled = value.enabled === true;
    const message = String(value.message ?? '').trim();
    const flowId = String(value.flowId ?? '').trim() || null;
    const contactName = String(value.contactName ?? '').trim();
    const contactPhone = String(value.contactPhone ?? '').replace(/\D/g, '');
    if (message.length > 4000) throw new BadRequestException('A mensagem deve ter até 4.000 caracteres.');
    if (enabled && !message) throw new BadRequestException('Escreva a mensagem antes de ativar o robô.');
    if (flowId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(flowId))
      throw new BadRequestException('Escolha um fluxo válido.');
    if (contactName.length > 160 || (contactName || contactPhone) && (!contactName || contactPhone.length < 8 || contactPhone.length > 15))
      throw new BadRequestException('Informe o nome e o telefone completo do contato a compartilhar.');
    return { enabled, message, flowId, contactName, contactPhone };
  }

  private validateFlow(flow: { active?: boolean; kind?: string; steps?: ConversationFlowStep[] } | undefined) {
    if (!flow?.active || flow.kind !== 'regular' || !Array.isArray(flow.steps) || !flow.steps.length)
      throw new ConflictException('Escolha um fluxo ativo do tipo comum.');
    const steps = flow.steps;
    if (steps.length > 30 || steps.some(step => !allowedFlowTypes.has(step.type || 'message')))
      throw new ConflictException('O robô aceita apenas fluxos com mensagens, mídia e pausas.');
    if (steps.reduce((sum, step) => sum + Math.max(0, Number(step.delaySeconds) || 0), 0) > 3600)
      throw new ConflictException('O fluxo do robô deve ter no máximo uma hora de pausas no total.');
    return steps;
  }

  private async flow(flowId: string) {
    const [flow] = await this.db.query('SELECT active,kind,steps FROM openwa.conversation_flows WHERE id=$1', [flowId]);
    return this.validateFlow(flow);
  }

  async get(token: string) {
    await this.auth.requireAdmin(token);
    const { sessionId } = await this.auth.connectionContext(token);
    const [row] = await this.db.query(`SELECT enabled,message,flow_id AS "flowId",contact_name AS "contactName",
      contact_phone AS "contactPhone",generation FROM openwa.atende_robot_config WHERE session_id=$1`, [sessionId]);
    return row || emptyConfig();
  }

  async save(token: string, input: unknown) {
    await this.auth.requireAdmin(token);
    const { sessionId } = await this.auth.connectionContext(token);
    const value = this.normalize(input);
    if (value.enabled && value.flowId) await this.flow(value.flowId);
    const [row] = await this.db.query(`INSERT INTO openwa.atende_robot_config
      (session_id,enabled,message,flow_id,contact_name,contact_phone,generation)
      VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $2 THEN 1 ELSE 0 END)
      ON CONFLICT (session_id) DO UPDATE SET enabled=EXCLUDED.enabled,message=EXCLUDED.message,
        flow_id=EXCLUDED.flow_id,contact_name=EXCLUDED.contact_name,contact_phone=EXCLUDED.contact_phone,
        generation=CASE WHEN openwa.atende_robot_config.enabled=false AND EXCLUDED.enabled=true
          THEN openwa.atende_robot_config.generation+1 ELSE openwa.atende_robot_config.generation END,
        updated_at=NOW()
      RETURNING enabled,message,flow_id AS "flowId",contact_name AS "contactName",
        contact_phone AS "contactPhone",generation`,
      [sessionId, value.enabled, value.message, value.flowId, value.contactName, value.contactPhone]);
    return row as RobotConfig;
  }

  async configForIncoming(sessionId: string, incoming: IncomingMessage): Promise<RobotConfig | null> {
    if (incoming.fromMe || incoming.isGroup || incoming.isStatusBroadcast ||
      !/@(?:c\.us|s\.whatsapp\.net|lid)$/.test(incoming.chatId)) return null;
    const receivedAt = Number(incoming.timestamp);
    if (receivedAt > 0 && receivedAt < Date.now() / 1000 - 600) return null;
    const [row] = await this.db.query(`SELECT enabled,message,flow_id AS "flowId",contact_name AS "contactName",
      contact_phone AS "contactPhone",generation FROM openwa.atende_robot_config
      WHERE session_id=$1 AND enabled=true`, [sessionId]);
    return row || null;
  }

  private async stillActive(sessionId: string, generation: number, engine: IWhatsAppEngine) {
    if (!this.engines.isLive(sessionId, engine)) return false;
    const [row] = await this.db.query('SELECT enabled,generation FROM openwa.atende_robot_config WHERE session_id=$1', [sessionId]);
    return row?.enabled === true && Number(row.generation) === generation;
  }

  async reply(sessionId: string, engine: IWhatsAppEngine, incoming: IncomingMessage, config: RobotConfig) {
    if (!await this.stillActive(sessionId, config.generation, engine)) return false;
    let steps: ConversationFlowStep[] = [];
    let flowError: string | null = null;
    if (config.flowId) {
      try { steps = await this.flow(config.flowId); }
      catch (error) { flowError = error instanceof Error ? error.message.slice(0, 500) : 'Fluxo indisponível'; }
    }
    const claimed = await this.db.query(`INSERT INTO openwa.atende_robot_sends (session_id,generation,chat_id)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING chat_id`,
      [sessionId, config.generation, incoming.chatId]);
    if (!claimed.length) return false;
    let sentAny = false;
    try {
      if (!await this.stillActive(sessionId, config.generation, engine)) {
        await this.db.query(`UPDATE openwa.atende_robot_sends SET status='cancelled',updated_at=NOW()
          WHERE session_id=$1 AND generation=$2 AND chat_id=$3`, [sessionId, config.generation, incoming.chatId]);
        return false;
      }
      const [profileRow] = await this.db.query('SELECT data FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',
        [sessionId, incoming.chatId]);
      const profile = (profileRow?.data || {}) as RobotProfile;
      const fill = (text: string) => renderRobotTemplate(text, profile, incoming.chatId);
      await engine.sendTextMessage(incoming.chatId, fill(config.message));
      sentAny = true;
      if (config.contactName && config.contactPhone && await this.stillActive(sessionId, config.generation, engine))
        await engine.sendContactMessage(incoming.chatId, { name: config.contactName, number: `+${config.contactPhone}` });
      for (const step of steps) {
        const delay = Math.max(0, Number(step.delaySeconds) || 0);
        if (delay) await new Promise(resolve => setTimeout(resolve, delay * 1000));
        if (!await this.stillActive(sessionId, config.generation, engine)) break;
        if (step.type === 'delay') continue;
        if (!step.type || step.type === 'message') await engine.sendTextMessage(incoming.chatId, fill(step.text || ''));
        else if (step.data) {
          const media = { data: step.data, mimetype: step.mimetype || 'application/octet-stream',
            filename: step.filename || 'arquivo', caption: step.caption ? fill(step.caption) : undefined };
          if (step.type === 'image') await engine.sendImageMessage(incoming.chatId, media);
          else if (step.type === 'video') await engine.sendVideoMessage(incoming.chatId, media);
          else if (step.type === 'audio') await engine.sendAudioMessage(incoming.chatId, media);
          else if (step.type === 'document') await engine.sendDocumentMessage(incoming.chatId, media);
        }
      }
      await this.db.query(`UPDATE openwa.atende_robot_sends SET status=$4,error=$5,updated_at=NOW()
        WHERE session_id=$1 AND generation=$2 AND chat_id=$3`,
        [sessionId, config.generation, incoming.chatId, flowError ? 'partial' : 'sent', flowError]);
      return true;
    } catch (error) {
      if (sentAny) {
        await this.db.query(`UPDATE openwa.atende_robot_sends SET status='partial',error=$4,updated_at=NOW()
          WHERE session_id=$1 AND generation=$2 AND chat_id=$3`,
          [sessionId, config.generation, incoming.chatId, error instanceof Error ? error.message.slice(0, 500) : 'Falha no envio']);
      } else {
        // Nenhuma mensagem saiu: libere a tentativa para a próxima mensagem do cliente.
        await this.db.query('DELETE FROM openwa.atende_robot_sends WHERE session_id=$1 AND generation=$2 AND chat_id=$3',
          [sessionId, config.generation, incoming.chatId]);
      }
      throw error;
    }
  }
}
