import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Headers, Injectable, OnModuleDestroy, OnModuleInit, Param, Post, Put } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { GoogleAuth } from 'google-auth-library';
import { DataSource } from 'typeorm';
import { Public } from '../auth/decorators/auth.decorators';
import { MessageService } from '../message/message.service';
import { OperatorAuthService } from './operator-auth.service';
import { ContactImportService, normalizeImportPhone } from './contact-import.controller';
import { ContactData, emptyContact } from './contact-profile.controller';

type Mapping = { column: string; target: string };
type SheetRule = {
  id: string; name: string; spreadsheetId: string; range: string; phoneColumn: string;
  mappings: Mapping[]; messageTemplate: string; sendMessage: boolean; active: boolean;
  intervalMinutes: number; lastRunAt?: string | null; lastError?: string | null;
};
type SheetRows = { headers: string[]; rows: Record<string, string>[] };
const editableFields = new Set(['name', 'firstName', 'lastName', 'email', 'company', 'document', 'address', 'tags']);

@Injectable()
export class SheetAutomationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly running = new Set<string>();
  constructor(
    @InjectDataSource('data') private readonly db: DataSource,
    private readonly auth: OperatorAuthService,
    private readonly importer: ContactImportService,
    private readonly modules: ModuleRef,
  ) {}

  async onModuleInit() {
    await this.db.query(`CREATE TABLE IF NOT EXISTS openwa.sheet_automations (
      id varchar(36) PRIMARY KEY, session_id varchar(255) NOT NULL, name varchar(100) NOT NULL,
      spreadsheet_id varchar(160) NOT NULL, sheet_range varchar(160) NOT NULL,
      phone_column varchar(120) NOT NULL, mappings jsonb NOT NULL DEFAULT '[]'::jsonb,
      message_template text NOT NULL DEFAULT '', send_message boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT false, interval_minutes integer NOT NULL DEFAULT 60,
      last_run_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW())`);
    await this.db.query(`CREATE TABLE IF NOT EXISTS openwa.sheet_automation_rows (
      automation_id varchar(36) NOT NULL REFERENCES openwa.sheet_automations(id) ON DELETE CASCADE,
      phone varchar(20) NOT NULL, fingerprint varchar(64) NOT NULL, status varchar(20) NOT NULL,
      error text, processed_at timestamptz NOT NULL DEFAULT NOW(), PRIMARY KEY(automation_id,phone))`);
    this.timer = setInterval(() => void this.runDue().catch(() => undefined), 60_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private credentials(): { client_email: string; private_key: string } | null {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
    if (!raw) return null;
    try {
      const value = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Record<string, unknown>;
      if (typeof value.client_email !== 'string' || typeof value.private_key !== 'string') return null;
      return { client_email: value.client_email, private_key: value.private_key };
    } catch { return null; }
  }
  async list(token: string) {
    await this.auth.requireAdmin(token);
    const { sessionId } = await this.auth.connectionContext(token);
    const rows = await this.db.query(`SELECT id,name,spreadsheet_id AS "spreadsheetId",sheet_range AS range,
      phone_column AS "phoneColumn",mappings,message_template AS "messageTemplate",
      send_message AS "sendMessage",active,interval_minutes AS "intervalMinutes",
      last_run_at AS "lastRunAt",last_error AS "lastError" FROM openwa.sheet_automations
      WHERE session_id=$1 ORDER BY created_at DESC`, [sessionId]);
    const failures = rows.length ? await this.db.query(`SELECT r.automation_id AS "automationId",r.phone,
      COALESCE(r.error,CASE WHEN r.status='sending' THEN 'Execução interrompida; confira o WhatsApp antes de alterar a linha para tentar novamente.' END) AS error
      FROM openwa.sheet_automation_rows r JOIN openwa.sheet_automations a ON a.id=r.automation_id
      WHERE a.session_id=$1 AND r.status IN ('send_failed','sending') ORDER BY r.processed_at DESC LIMIT 100`, [sessionId]) : [];
    return { serviceAccountEmail: this.credentials()?.client_email || null,
      rules: rows.map((rule: SheetRule) => ({ ...rule, failures: failures.filter((item: { automationId: string }) => item.automationId === rule.id) })) };
  }
  private normalize(input: unknown): Omit<SheetRule, 'id'> {
    const row = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const name = String(row.name || '').trim().slice(0, 100);
    const link = String(row.spreadsheetId || '').trim();
    const match = link.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
    const spreadsheetId = match ? match[1] : link;
    const range = String(row.range || 'A1:Z201').trim();
    const phoneColumn = String(row.phoneColumn || '').trim();
    const mappings = (Array.isArray(row.mappings) ? row.mappings : []).map((item: unknown) => {
      const value = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return { column: String(value.column || '').trim(), target: String(value.target || '').trim() };
    }).filter(item => item.column && item.target);
    const messageTemplate = String(row.messageTemplate || '').trim();
    const intervalMinutes = Number(row.intervalMinutes || 60);
    if (!name || !/^[A-Za-z0-9_-]{20,160}$/.test(spreadsheetId)) throw new BadRequestException('Informe o nome e um link ou ID válido do Google Sheets.');
    if (range.length > 160 || !/^(?:[^\r\n!]{1,80}!)?[A-Z]{1,2}1:[A-Z]{1,2}\d{1,4}$/.test(range) || Number(range.match(/\d+$/)?.[0]) > 1001)
      throw new BadRequestException('Use um intervalo com cabeçalho na linha 1 e até 1.000 contatos (ex.: A1:Z201).');
    if (!phoneColumn || phoneColumn.length > 120 || mappings.length > 40 || mappings.some(item => item.column.length > 120 || !(editableFields.has(item.target) || /^custom:.{1,80}$/.test(item.target))))
      throw new BadRequestException('Revise o mapeamento das colunas e informe a coluna do telefone.');
    if (messageTemplate.length > 4000 || (row.sendMessage === true && !messageTemplate)) throw new BadRequestException('Escreva uma mensagem de até 4.000 caracteres.');
    if (![15, 30, 60, 180, 360, 1440].includes(intervalMinutes)) throw new BadRequestException('Intervalo de atualização inválido.');
    return { name, spreadsheetId, range, phoneColumn, mappings, messageTemplate, sendMessage: row.sendMessage === true, active: row.active === true, intervalMinutes };
  }
  async save(token: string, input: unknown, id?: string) {
    await this.auth.requireAdmin(token);
    const { sessionId } = await this.auth.connectionContext(token);
    const value = this.normalize(input);
    if (value.active && !this.credentials()) throw new ConflictException('Configure a conta de serviço do Google antes de ativar a automação.');
    const ruleId = id || randomUUID();
    if (id) {
      const result = await this.db.query(`UPDATE openwa.sheet_automations SET name=$3,spreadsheet_id=$4,sheet_range=$5,
        phone_column=$6,mappings=$7::jsonb,message_template=$8,send_message=$9,active=$10,
        interval_minutes=$11,updated_at=NOW() WHERE id=$1 AND session_id=$2 RETURNING id`,
        [ruleId, sessionId, value.name, value.spreadsheetId, value.range, value.phoneColumn,
          JSON.stringify(value.mappings), value.messageTemplate, value.sendMessage, value.active, value.intervalMinutes]);
      if (!result.length) throw new ConflictException('Automação não encontrada.');
    } else {
      await this.db.query(`INSERT INTO openwa.sheet_automations
        (id,session_id,name,spreadsheet_id,sheet_range,phone_column,mappings,message_template,send_message,active,interval_minutes)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
        [ruleId, sessionId, value.name, value.spreadsheetId, value.range, value.phoneColumn,
          JSON.stringify(value.mappings), value.messageTemplate, value.sendMessage, value.active, value.intervalMinutes]);
    }
    return { id: ruleId };
  }
  async remove(token: string, id: string) {
    await this.auth.requireAdmin(token);
    const { sessionId } = await this.auth.connectionContext(token);
    const rows = await this.db.query('DELETE FROM openwa.sheet_automations WHERE id=$1 AND session_id=$2 RETURNING id', [id, sessionId]);
    if (!rows.length) throw new ConflictException('Automação não encontrada.');
    return { success: true };
  }
  private async fetchSheet(rule: Pick<SheetRule, 'spreadsheetId' | 'range'>): Promise<SheetRows> {
    const credentials = this.credentials();
    if (!credentials) throw new ConflictException('Configure a conta de serviço do Google para ler planilhas privadas.');
    const google = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    const accessToken = await google.getAccessToken();
    if (!accessToken) throw new ConflictException('Não foi possível autenticar a conta de serviço do Google.');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(rule.spreadsheetId)}/values/${encodeURIComponent(rule.range)}?valueRenderOption=FORMATTED_VALUE`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new ConflictException(response.status === 403 || response.status === 404
      ? 'Planilha inacessível. Compartilhe-a com a conta de serviço exibida na tela e confira o ID.'
      : `O Google Sheets retornou HTTP ${response.status}.`);
    const payload = await response.json() as { values?: unknown };
    if (!Array.isArray(payload.values) || !payload.values.length) throw new BadRequestException('A planilha está vazia ou o intervalo não contém o cabeçalho.');
    const values = payload.values as unknown[][];
    if (values.length > 1001 || values[0].length > 52) throw new BadRequestException('Limite de 1.000 linhas e 52 colunas por automação.');
    const headers = values[0].map(value => String(value ?? '').trim());
    if (headers.some(value => !value || value.length > 120) || new Set(headers).size !== headers.length) throw new BadRequestException('O cabeçalho deve ter nomes únicos e não vazios.');
    const rows = values.slice(1).filter(row => row.some(value => String(value ?? '').trim())).map(row => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '').trim().slice(0, 4000)])));
    return { headers, rows };
  }
  async preview(token: string, input: unknown) {
    await this.auth.requireAdmin(token);
    const rule = this.normalize(input);
    const sheet = await this.fetchSheet(rule);
    if (!sheet.headers.includes(rule.phoneColumn) || rule.mappings.some(mapping => !sheet.headers.includes(mapping.column)))
      throw new BadRequestException('Uma coluna mapeada não existe no cabeçalho da planilha.');
    if (rule.sendMessage && [...rule.messageTemplate.matchAll(/{{\s*([^{}]{1,120})\s*}}/g)].some(match => !sheet.headers.includes(match[1].trim())))
      throw new BadRequestException('A mensagem usa uma coluna que não existe no cabeçalho da planilha.');
    return { headers: sheet.headers, samples: sheet.rows.slice(0, 5), total: sheet.rows.length };
  }
  async run(token: string, id: string) {
    await this.auth.requireAdmin(token);
    const { sessionId } = await this.auth.connectionContext(token);
    return this.execute(sessionId, id);
  }
  private async runDue() {
    if (!this.credentials()) return;
    const due = await this.db.query(`SELECT id,session_id AS "sessionId" FROM openwa.sheet_automations
      WHERE active=true AND (last_run_at IS NULL OR last_run_at <= NOW()-(interval_minutes * INTERVAL '1 minute'))`);
    for (const row of due) void this.execute(row.sessionId, row.id).catch(() => undefined);
  }
  private async execute(sessionId: string, id: string) {
    if (this.running.has(id)) throw new ConflictException('Esta automação já está em execução.');
    this.running.add(id);
    try {
      const [raw] = await this.db.query('SELECT * FROM openwa.sheet_automations WHERE id=$1 AND session_id=$2', [id, sessionId]);
      if (!raw) throw new ConflictException('Automação não encontrada.');
      const rule: SheetRule = { id, name: raw.name, spreadsheetId: raw.spreadsheet_id, range: raw.sheet_range,
        phoneColumn: raw.phone_column, mappings: raw.mappings, messageTemplate: raw.message_template,
        sendMessage: raw.send_message, active: raw.active, intervalMinutes: raw.interval_minutes };
      const sheet = await this.fetchSheet(rule);
      if (!sheet.headers.includes(rule.phoneColumn) || rule.mappings.some(mapping => !sheet.headers.includes(mapping.column)))
        throw new BadRequestException('Uma coluna mapeada não existe no cabeçalho da planilha.');
      if (rule.sendMessage && [...rule.messageTemplate.matchAll(/{{\s*([^{}]{1,120})\s*}}/g)].some(match => !sheet.headers.includes(match[1].trim())))
        throw new BadRequestException('A mensagem usa uma coluna que não existe no cabeçalho da planilha.');
      const seen = new Set<string>();
      const changed: { phone: string; row: Record<string, string>; hash: string }[] = [];
      for (const row of sheet.rows) {
        const phone = normalizeImportPhone(row[rule.phoneColumn]);
        if (seen.has(phone)) throw new BadRequestException(`Telefone duplicado na planilha: ${phone}.`);
        seen.add(phone);
        const hash = createHash('sha256').update(JSON.stringify(row)).digest('hex');
        const [previous] = await this.db.query('SELECT fingerprint FROM openwa.sheet_automation_rows WHERE automation_id=$1 AND phone=$2', [id, phone]);
        if (previous?.fingerprint !== hash) changed.push({ phone, row, hash });
      }
      // A large first import must not turn into an unbounded WhatsApp send burst.
      // Rows left untouched here are picked up by the next scheduled/manual run.
      const work = rule.sendMessage ? changed.slice(0, 50) : changed;
      let updated = 0, sent = 0, failed = 0;
      for (let offset = 0; offset < work.length; offset += 100) {
        const batch = work.slice(offset, offset + 100);
        const prepared = batch.map(item => this.prepare(item.row, rule));
        const imported = await this.importer.importFromAutomation(sessionId, { contacts: prepared.map(item => item.importRow) });
        const chatByPhone = new Map(imported.contacts.map(item => [item.phone, item.chatId]));
        for (const [index, item] of batch.entries()) {
          const chatId = chatByPhone.get(item.phone);
          if (!chatId) continue;
          await this.patchProfile(sessionId, chatId, prepared[index].profile);
          const claimed = await this.db.query(`INSERT INTO openwa.sheet_automation_rows
            (automation_id,phone,fingerprint,status) VALUES ($1,$2,$3,$4)
            ON CONFLICT(automation_id,phone) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,status=EXCLUDED.status,error=NULL,processed_at=NOW()
            WHERE openwa.sheet_automation_rows.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint RETURNING phone`,
            [id, item.phone, item.hash, rule.sendMessage ? 'sending' : 'processed']);
          if (!claimed.length) continue;
          updated++;
          if (!rule.sendMessage) continue;
          const text = this.render(rule.messageTemplate, item.row);
          if (!text) {
            failed++;
            await this.db.query('UPDATE openwa.sheet_automation_rows SET status=$3,error=$4 WHERE automation_id=$1 AND phone=$2',
              [id, item.phone, 'send_failed', 'Mensagem gerada vazia; revise os campos desta linha.']);
            continue;
          }
          try {
            const messages = this.modules.get(MessageService, { strict: false });
            await messages.sendText(sessionId, { chatId, text });
            sent++;
            await this.db.query('UPDATE openwa.sheet_automation_rows SET status=$3,error=NULL WHERE automation_id=$1 AND phone=$2',
              [id, item.phone, 'sent']).catch(() => undefined);
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            failed++;
            await this.db.query('UPDATE openwa.sheet_automation_rows SET status=$3,error=$4 WHERE automation_id=$1 AND phone=$2',
              [id, item.phone, 'send_failed', error instanceof Error ? error.message.slice(0, 500) : 'Falha ao enviar']);
          }
        }
      }
      await this.db.query('UPDATE openwa.sheet_automations SET last_run_at=NOW(),last_error=$2 WHERE id=$1',
        [id, failed ? `${failed} mensagem(ns) falharam. Essas linhas não serão reenviadas automaticamente; revise o contato e altere a linha para tentar de novo.` : null]);
      return { total: sheet.rows.length, updated, unchanged: sheet.rows.length - changed.length, pending: changed.length - work.length, sent, failed };
    } catch (error) {
      await this.db.query('UPDATE openwa.sheet_automations SET last_run_at=NOW(),last_error=$2 WHERE id=$1',
        [id, error instanceof Error ? error.message.slice(0, 500) : 'Falha na sincronização']).catch(() => undefined);
      throw error;
    } finally { this.running.delete(id); }
  }
  private prepare(row: Record<string, string>, rule: SheetRule) {
    const field = (target: string) => row[rule.mappings.find(item => item.target === target)?.column || ''] || '';
    const full = field('name');
    const names = full.split(/\s+/).filter(Boolean);
    const firstName = field('firstName') || names.shift() || '';
    const lastName = field('lastName') || names.join(' ');
    const tags = field('tags').split(',').map(value => value.trim()).filter(Boolean);
    const profile: Record<string, string> = {};
    for (const mapping of rule.mappings) if (row[mapping.column] && !['name', 'firstName', 'lastName', 'tags'].includes(mapping.target))
      profile[mapping.target] = row[mapping.column];
    return { importRow: { firstName, lastName, phone: row[rule.phoneColumn], tags }, profile };
  }
  private async patchProfile(sessionId: string, chatId: string, fields: Record<string, string>) {
    if (!Object.keys(fields).length) return;
    await this.db.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([sessionId, chatId])]);
      const [row] = await db.query('SELECT data FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2', [sessionId, chatId]);
      const data: ContactData = { ...emptyContact(), ...(row?.data || {}) };
      for (const [target, value] of Object.entries(fields)) {
        if (target.startsWith('custom:')) {
          const label = target.slice(7);
          const custom = Array.isArray(data.custom) ? data.custom : [];
          const old = custom.find(item => item.label === label);
          data.custom = old ? custom.map(item => item.label === label ? { ...item, value } : item)
            : [...custom, { id: randomUUID(), label, value }];
        } else if (['email', 'company', 'document', 'address'].includes(target)) (data as unknown as Record<string, unknown>)[target] = value;
      }
      await db.query(`UPDATE openwa.contact_profiles SET data=$3::jsonb,revision=revision+1,updated_at=NOW()
        WHERE session_id=$1 AND chat_id=$2`, [sessionId, chatId, JSON.stringify(data)]);
    });
  }
  private render(template: string, row: Record<string, string>) {
    return template.replace(/{{\s*([^{}]{1,120})\s*}}/g, (_, key: string) => row[key.trim()] || '').trim().slice(0, 4000);
  }
}

@Public()
@Controller('operator-auth/automations/sheets')
export class SheetAutomationController {
  constructor(private readonly sheets: SheetAutomationService) {}
  @Get() list(@Headers('x-atende-token') token = '') { return this.sheets.list(token); }
  @Post() create(@Headers('x-atende-token') token = '', @Body() body: unknown) { return this.sheets.save(token, body); }
  @Put(':id') update(@Headers('x-atende-token') token = '', @Param('id') id: string, @Body() body: unknown) { return this.sheets.save(token, body, id); }
  @Delete(':id') remove(@Headers('x-atende-token') token = '', @Param('id') id: string) { return this.sheets.remove(token, id); }
  @Post('preview') preview(@Headers('x-atende-token') token = '', @Body() body: unknown) { return this.sheets.preview(token, body); }
  @Post(':id/run') run(@Headers('x-atende-token') token = '', @Param('id') id: string) { return this.sheets.run(token, id); }
}
