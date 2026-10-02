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
  mode: 'contacts' | 'cnpjCall'; detailsRange: string; controlCnpjColumn: string;
  detailsCnpjColumn: string; calledColumn: string; calledValue: string;
};
type SheetRows = { headers: string[]; rows: Record<string, string>[]; rowNumbers: number[] };
const editableFields = new Set(['name', 'firstName', 'lastName', 'email', 'company', 'document', 'address', 'tags']);
export const normalizeCnpj = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const columnLetter = (index: number) => {
  let result = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
};

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
      mode varchar(20) NOT NULL DEFAULT 'contacts', details_range varchar(160) NOT NULL DEFAULT '',
      control_cnpj_column varchar(120) NOT NULL DEFAULT '', details_cnpj_column varchar(120) NOT NULL DEFAULT '',
      called_column varchar(120) NOT NULL DEFAULT '', called_value varchar(120) NOT NULL DEFAULT '',
      last_run_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW())`);
    for (const [name, definition] of Object.entries({ mode: "varchar(20) NOT NULL DEFAULT 'contacts'", details_range: "varchar(160) NOT NULL DEFAULT ''",
      control_cnpj_column: "varchar(120) NOT NULL DEFAULT ''", details_cnpj_column: "varchar(120) NOT NULL DEFAULT ''",
      called_column: "varchar(120) NOT NULL DEFAULT ''", called_value: "varchar(120) NOT NULL DEFAULT ''" })) {
      await this.db.query(`ALTER TABLE openwa.sheet_automations ADD COLUMN IF NOT EXISTS ${name} ${definition}`);
    }
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
      mode,details_range AS "detailsRange",control_cnpj_column AS "controlCnpjColumn",
      details_cnpj_column AS "detailsCnpjColumn",called_column AS "calledColumn",called_value AS "calledValue",
      last_run_at AS "lastRunAt",last_error AS "lastError" FROM openwa.sheet_automations
      WHERE session_id=$1 ORDER BY created_at DESC`, [sessionId]);
    const failures = rows.length ? await this.db.query(`SELECT r.automation_id AS "automationId",r.phone,
      COALESCE(r.error,CASE WHEN r.status='sending' THEN 'Execução interrompida; confira o WhatsApp antes de tentar novamente.'
        WHEN r.status='sent_pending_sheet' THEN 'Mensagem enviada; aguardando a marcação da planilha. Não reenvie manualmente.' END) AS error
      FROM openwa.sheet_automation_rows r JOIN openwa.sheet_automations a ON a.id=r.automation_id
      WHERE a.session_id=$1 AND r.status IN ('send_failed','sending','sent_pending_sheet') ORDER BY r.processed_at DESC LIMIT 100`, [sessionId]) : [];
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
    const mode = row.mode === 'cnpjCall' ? 'cnpjCall' : 'contacts';
    const detailsRange = String(row.detailsRange || '').trim();
    const controlCnpjColumn = String(row.controlCnpjColumn || 'CNPJ').trim();
    const detailsCnpjColumn = String(row.detailsCnpjColumn || 'CNPJ').trim();
    const calledColumn = String(row.calledColumn || 'Chamado').trim();
    const calledValue = String(row.calledValue || 'Nós chamamos').trim();
    const phoneColumn = String(row.phoneColumn || '').trim();
    const mappings = (Array.isArray(row.mappings) ? row.mappings : []).map((item: unknown) => {
      const value = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return { column: String(value.column || '').trim(), target: String(value.target || '').trim() };
    }).filter(item => item.column && item.target);
    const messageTemplate = String(row.messageTemplate || '').trim();
    const intervalMinutes = Number(row.intervalMinutes || 60);
    if (!name || !/^[A-Za-z0-9_-]{20,160}$/.test(spreadsheetId)) throw new BadRequestException('Informe o nome e um link ou ID válido do Google Sheets.');
    const validRange = (value: string) => value.length <= 160 && /^(?:[^\r\n!]{1,80}!)?[A-Z]{1,2}1:[A-Z]{1,2}\d{1,4}$/.test(value) && Number(value.match(/\d+$/)?.[0]) <= 1001;
    if (!validRange(range))
      throw new BadRequestException('Use um intervalo com cabeçalho na linha 1 e até 1.000 contatos (ex.: A1:Z201).');
    if (mode === 'cnpjCall' && (!validRange(detailsRange) || !range.includes('!') || !detailsRange.includes('!') ||
      !controlCnpjColumn || !detailsCnpjColumn || !calledColumn || !calledValue ||
      [controlCnpjColumn, detailsCnpjColumn, calledColumn, calledValue].some(value => value.length > 120)))
      throw new BadRequestException('Informe as duas abas, as colunas de CNPJ e Chamado e o valor a registrar.');
    if (mode === 'contacts' && (!phoneColumn || phoneColumn.length > 120 || mappings.length > 40 || mappings.some(item => item.column.length > 120 || !(editableFields.has(item.target) || /^custom:.{1,80}$/.test(item.target)))))
      throw new BadRequestException('Revise o mapeamento das colunas e informe a coluna do telefone.');
    if (messageTemplate.length > 4000 || ((row.sendMessage === true || mode === 'cnpjCall') && !messageTemplate)) throw new BadRequestException('Escreva uma mensagem de até 4.000 caracteres.');
    if (![15, 30, 60, 180, 360, 1440].includes(intervalMinutes)) throw new BadRequestException('Intervalo de atualização inválido.');
    return { name, spreadsheetId, range, phoneColumn, mappings, messageTemplate, sendMessage: mode === 'cnpjCall' || row.sendMessage === true,
      active: row.active === true, intervalMinutes, mode, detailsRange, controlCnpjColumn, detailsCnpjColumn, calledColumn, calledValue };
  }
  async save(token: string, input: unknown, id?: string) {
    await this.auth.requireAdmin(token);
    const { sessionId } = await this.auth.connectionContext(token);
    const value = this.normalize(input);
    if (value.active && !this.credentials()) throw new ConflictException('Configure a conta de serviço do Google antes de ativar a automação.');
    const ruleId = id || randomUUID();
    if (id) {
      const [existing] = await this.db.query('SELECT mode FROM openwa.sheet_automations WHERE id=$1 AND session_id=$2', [id, sessionId]);
      if (existing && existing.mode !== value.mode) throw new ConflictException('Crie outra automação para usar um tipo diferente.');
      const result = await this.db.query(`UPDATE openwa.sheet_automations SET name=$3,spreadsheet_id=$4,sheet_range=$5,
        phone_column=$6,mappings=$7::jsonb,message_template=$8,send_message=$9,active=$10,
        interval_minutes=$11,mode=$12,details_range=$13,control_cnpj_column=$14,details_cnpj_column=$15,
        called_column=$16,called_value=$17,updated_at=NOW() WHERE id=$1 AND session_id=$2 RETURNING id`,
        [ruleId, sessionId, value.name, value.spreadsheetId, value.range, value.phoneColumn,
          JSON.stringify(value.mappings), value.messageTemplate, value.sendMessage, value.active, value.intervalMinutes,
          value.mode, value.detailsRange, value.controlCnpjColumn, value.detailsCnpjColumn, value.calledColumn, value.calledValue]);
      if (!result.length) throw new ConflictException('Automação não encontrada.');
    } else {
      await this.db.query(`INSERT INTO openwa.sheet_automations
        (id,session_id,name,spreadsheet_id,sheet_range,phone_column,mappings,message_template,send_message,active,interval_minutes,
        mode,details_range,control_cnpj_column,details_cnpj_column,called_column,called_value)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [ruleId, sessionId, value.name, value.spreadsheetId, value.range, value.phoneColumn,
          JSON.stringify(value.mappings), value.messageTemplate, value.sendMessage, value.active, value.intervalMinutes,
          value.mode, value.detailsRange, value.controlCnpjColumn, value.detailsCnpjColumn, value.calledColumn, value.calledValue]);
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
  private async googleToken(write = false) {
    const credentials = this.credentials();
    if (!credentials) throw new ConflictException('Configure a conta de serviço do Google para ler planilhas privadas.');
    const google = new GoogleAuth({ credentials, scopes: [write ? 'https://www.googleapis.com/auth/spreadsheets' : 'https://www.googleapis.com/auth/spreadsheets.readonly'] });
    const accessToken = await google.getAccessToken();
    if (!accessToken) throw new ConflictException('Não foi possível autenticar a conta de serviço do Google.');
    return accessToken;
  }
  private async fetchSheet(rule: Pick<SheetRule, 'spreadsheetId' | 'range'>): Promise<SheetRows> {
    const accessToken = await this.googleToken();
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
    const rows: Record<string, string>[] = [], rowNumbers: number[] = [];
    values.slice(1).forEach((row, index) => {
      if (!row.some(value => String(value ?? '').trim())) return;
      rows.push(Object.fromEntries(headers.map((header, column) => [header, String(row[column] ?? '').trim().slice(0, 4000)])));
      rowNumbers.push(index + 2);
    });
    return { headers, rows, rowNumbers };
  }
  private async writeCalled(rule: SheetRule, sheet: SheetRows, rowNumber: number, expectedCnpj: string) {
    const index = sheet.headers.indexOf(rule.calledColumn);
    const cnpjIndex = sheet.headers.indexOf(rule.controlCnpjColumn);
    if (index < 0 || cnpjIndex < 0) throw new BadRequestException('Coluna CNPJ ou Chamado não encontrada.');
    const firstColumn = rule.range.split('!')[1].match(/^[A-Z]+/)![0];
    const offset = [...firstColumn].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
    const cnpjCell = `${rule.range.split('!')[0]}!${columnLetter(offset + cnpjIndex)}${rowNumber}`;
    const cell = `${rule.range.split('!')[0]}!${columnLetter(offset + index)}${rowNumber}`;
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(rule.spreadsheetId)}/values/`;
    const accessToken = await this.googleToken(true);
    const currentCnpj = await fetch(`${base}${encodeURIComponent(cnpjCell)}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (!currentCnpj.ok) throw new ConflictException(`Não foi possível confirmar o CNPJ na linha ${rowNumber} (HTTP ${currentCnpj.status}).`);
    const currentCnpjValue = await currentCnpj.json() as { values?: string[][] };
    if (normalizeCnpj(currentCnpjValue.values?.[0]?.[0]) !== expectedCnpj)
      throw new ConflictException(`A linha ${rowNumber} mudou na planilha; Chamado não foi alterado para evitar marcar outro cliente.`);
    const current = await fetch(`${base}${encodeURIComponent(cell)}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (!current.ok) throw new ConflictException(`Não foi possível conferir ${cell} antes da atualização (HTTP ${current.status}).`);
    const currentValue = await current.json() as { values?: string[][] };
    const value = String(currentValue.values?.[0]?.[0] || '').trim();
    if (value === rule.calledValue) return;
    if (value) throw new ConflictException(`${cell} já contém “${value}”; não foi sobrescrito.`);
    const response = await fetch(`${base}${encodeURIComponent(cell)}?valueInputOption=RAW`, { method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range: cell, majorDimension: 'ROWS', values: [[rule.calledValue]] }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new ConflictException(`Mensagem enviada, mas não foi possível atualizar ${cell} (HTTP ${response.status}). Confira a permissão de edição da conta de serviço.`);
  }
  private async prepareCnpjCalls(rule: Omit<SheetRule, 'id'>, control: SheetRows, details: SheetRows, sessionId: string) {
    if (!control.headers.includes(rule.controlCnpjColumn) || !control.headers.includes(rule.calledColumn) ||
      !details.headers.includes(rule.detailsCnpjColumn))
      throw new BadRequestException('Confira as colunas CNPJ e Chamado nas duas abas.');
    const placeholders = [...rule.messageTemplate.matchAll(/{{\s*([^{}]{1,120})\s*}}/g)].map(match => match[1].trim());
    if (placeholders.some(key => !control.headers.includes(key) && !details.headers.includes(key)))
      throw new BadRequestException('A mensagem usa uma coluna inexistente nas abas da planilha.');
    const detailByCnpj = new Map<string, Record<string, string>[]>();
    for (const row of details.rows) {
      const cnpj = normalizeCnpj(row[rule.detailsCnpjColumn]);
      if (cnpj.length !== 14) continue;
      detailByCnpj.set(cnpj, [...(detailByCnpj.get(cnpj) || []), row]);
    }
    const profiles = await this.db.query(`SELECT chat_id AS "chatId",data FROM openwa.contact_profiles
      WHERE session_id=$1 AND COALESCE((data->>'directoryHidden')::boolean,false)=false`, [sessionId]) as { chatId: string; data: ContactData }[];
    const contactByCnpj = new Map<string, string[]>();
    for (const profile of profiles) {
      if (!/@(?:c\.us|s\.whatsapp\.net|lid)$/.test(profile.chatId)) continue;
      const values = [profile.data?.document, ...(Array.isArray(profile.data?.custom) ? profile.data.custom
        .filter(item => item.label?.trim().toLowerCase() === 'cnpj').map(item => item.value) : [])];
      for (const cnpj of new Set(values.map(normalizeCnpj).filter(value => value.length === 14)))
        contactByCnpj.set(cnpj, [...(contactByCnpj.get(cnpj) || []), profile.chatId]);
    }
    const occurrences = new Map<string, number>();
    for (const row of control.rows) {
      const cnpj = normalizeCnpj(row[rule.controlCnpjColumn]);
      if (cnpj.length === 14) occurrences.set(cnpj, (occurrences.get(cnpj) || 0) + 1);
    }
    const calls: { cnpj: string; chatId: string; values: Record<string, string>; rowNumber: number }[] = [];
    const issues: { row: number; cnpj: string; reason: string }[] = [];
    let missing = 0, ambiguous = 0, alreadyCalled = 0;
    control.rows.forEach((row, index) => {
      if (row[rule.calledColumn]) { alreadyCalled++; return; }
      const cnpj = normalizeCnpj(row[rule.controlCnpjColumn]);
      const issue = (reason: string) => { if (issues.length < 50) issues.push({ row: control.rowNumbers[index], cnpj: row[rule.controlCnpjColumn], reason }); };
      if (cnpj.length !== 14) { missing++; issue('CNPJ ausente ou inválido'); return; }
      const matches = contactByCnpj.get(cnpj) || [];
      const data = detailByCnpj.get(cnpj) || [];
      if (occurrences.get(cnpj) !== 1 || matches.length > 1 || data.length > 1) { ambiguous++; issue('CNPJ duplicado na planilha ou em contatos'); return; }
      if (!matches.length || !data.length) { missing++; issue(!matches.length ? 'Contato não encontrado pelo CNPJ' : 'CNPJ não encontrado na aba de dados'); return; }
      const values = { ...row, ...data[0] };
      if (placeholders.some(key => !values[key]?.trim())) { missing++; issue('Campo usado na mensagem está vazio'); return; }
      calls.push({ cnpj, chatId: matches[0], values, rowNumber: control.rowNumbers[index] });
    });
    return { calls, issues, missing, ambiguous, alreadyCalled };
  }
  private async executeCnpjCalls(sessionId: string, id: string, rule: SheetRule, control: SheetRows) {
    for (const row of control.rows) {
      if (row[rule.calledColumn] !== rule.calledValue) continue;
      const cnpj = normalizeCnpj(row[rule.controlCnpjColumn]);
      if (cnpj.length === 14) await this.db.query(`UPDATE openwa.sheet_automation_rows SET status='sent',error=NULL
        WHERE automation_id=$1 AND phone=$2 AND status='sent_pending_sheet'`, [id, cnpj]);
    }
    const details = await this.fetchSheet({ spreadsheetId: rule.spreadsheetId, range: rule.detailsRange });
    const prepared = await this.prepareCnpjCalls(rule, control, details, sessionId);
    let sent = 0, marked = 0, failed = 0, skipped = 0, pending = 0;
    for (const call of prepared.calls) {
      const [previous] = await this.db.query('SELECT status FROM openwa.sheet_automation_rows WHERE automation_id=$1 AND phone=$2', [id, call.cnpj]);
      if (previous?.status === 'sent_pending_sheet') {
        try {
          await this.writeCalled(rule, control, call.rowNumber, call.cnpj);
          await this.db.query('UPDATE openwa.sheet_automation_rows SET status=$3,error=NULL WHERE automation_id=$1 AND phone=$2', [id, call.cnpj, 'sent']);
          marked++;
        } catch (error) {
          failed++;
          await this.db.query('UPDATE openwa.sheet_automation_rows SET error=$3 WHERE automation_id=$1 AND phone=$2',
            [id, call.cnpj, error instanceof Error ? error.message.slice(0, 500) : 'Falha ao atualizar a planilha']);
        }
        continue;
      }
      if (previous) { skipped++; continue; }
      if (sent >= 50) { pending++; continue; }
      const text = this.render(rule.messageTemplate, call.values);
      if (!text) { failed++; continue; }
      const claimed = await this.db.query(`INSERT INTO openwa.sheet_automation_rows
        (automation_id,phone,fingerprint,status) VALUES ($1,$2,$3,'sending') ON CONFLICT DO NOTHING RETURNING phone`,
        [id, call.cnpj, createHash('sha256').update(JSON.stringify(call.values)).digest('hex')]);
      if (!claimed.length) { skipped++; continue; }
      try {
        await this.modules.get(MessageService, { strict: false }).sendText(sessionId, { chatId: call.chatId, text });
      } catch (error) {
        failed++;
        await this.db.query('UPDATE openwa.sheet_automation_rows SET status=$3,error=$4 WHERE automation_id=$1 AND phone=$2',
          [id, call.cnpj, 'send_failed', error instanceof Error ? error.message.slice(0, 500) : 'Falha ao enviar']);
        continue;
      }
      sent++;
      await this.db.query('UPDATE openwa.sheet_automation_rows SET status=$3,error=NULL WHERE automation_id=$1 AND phone=$2',
        [id, call.cnpj, 'sent_pending_sheet']);
      try {
        await this.writeCalled(rule, control, call.rowNumber, call.cnpj);
        await this.db.query('UPDATE openwa.sheet_automation_rows SET status=$3 WHERE automation_id=$1 AND phone=$2', [id, call.cnpj, 'sent']);
        marked++;
      } catch (error) {
        failed++;
        await this.db.query('UPDATE openwa.sheet_automation_rows SET error=$3 WHERE automation_id=$1 AND phone=$2',
          [id, call.cnpj, error instanceof Error ? error.message.slice(0, 500) : 'Mensagem enviada; falha ao atualizar Chamado']);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await this.db.query('UPDATE openwa.sheet_automations SET last_run_at=NOW(),last_error=$2 WHERE id=$1',
      [id, failed ? `${failed} caso(s) exigem revisão. Mensagens já enviadas não serão repetidas.` : null]);
    return { total: control.rows.length, eligible: prepared.calls.length, missing: prepared.missing,
      ambiguous: prepared.ambiguous, alreadyCalled: prepared.alreadyCalled, pending, sent, marked, failed, skipped };
  }
  async preview(token: string, input: unknown) {
    await this.auth.requireAdmin(token);
    const rule = this.normalize(input);
    const sheet = await this.fetchSheet(rule);
    if (rule.mode === 'cnpjCall') {
      const details = await this.fetchSheet({ spreadsheetId: rule.spreadsheetId, range: rule.detailsRange });
      const prepared = await this.prepareCnpjCalls(rule, sheet, details, (await this.auth.connectionContext(token)).sessionId);
      return { headers: sheet.headers, samples: prepared.calls.slice(0, 5).map(item => ({ ...item.values, 'Contato': item.chatId, 'Linha': String(item.rowNumber) })),
        total: sheet.rows.length, eligible: prepared.calls.length, missing: prepared.missing, ambiguous: prepared.ambiguous,
        alreadyCalled: prepared.alreadyCalled, issues: prepared.issues };
    }
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
        sendMessage: raw.send_message, active: raw.active, intervalMinutes: raw.interval_minutes,
        mode: raw.mode, detailsRange: raw.details_range, controlCnpjColumn: raw.control_cnpj_column,
        detailsCnpjColumn: raw.details_cnpj_column, calledColumn: raw.called_column, calledValue: raw.called_value };
      const sheet = await this.fetchSheet(rule);
      if (rule.mode === 'cnpjCall') return await this.executeCnpjCalls(sessionId, id, rule, sheet);
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
