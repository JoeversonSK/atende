import { BadRequestException, Body, Controller, Headers, Injectable, Param, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../auth/decorators/auth.decorators';
import { OperatorAuthService } from './operator-auth.service';
import { ContactData } from './contact-profile.controller';
import { normalizeImportPhone } from './contact-import.controller';
import { normalizeCnpjList } from './contact-cnpj';

type SourceRow = { row: number; phone: string; cnpjs: string[] };
type ProfileRow = { chatId: string; data: ContactData };
type Issue = { row: number; phone: string; reason: string };

@Injectable()
export class ContactCnpjImportService {
  constructor(
    @InjectDataSource('data') private readonly db: DataSource,
    private readonly auth: OperatorAuthService,
  ) {}

  private parse(input: unknown): SourceRow[] {
    const source = input && typeof input === 'object' && 'contacts' in input
      ? (input as { contacts: unknown }).contacts : null;
    if (!Array.isArray(source) || !source.length || source.length > 500)
      throw new BadRequestException('Envie de 1 a 500 contatos por vez.');
    const byPhone = new Map<string, SourceRow>();
    for (const raw of source) {
      if (!raw || typeof raw !== 'object') throw new BadRequestException('Linha inválida na planilha.');
      const item = raw as Record<string, unknown>;
      const phone = normalizeImportPhone(item.phone);
      const cnpjs = normalizeCnpjList(item.cnpjs);
      if (!cnpjs.length) throw new BadRequestException(`Informe ao menos um CNPJ para ${phone}.`);
      const row = Number.isInteger(item.row) && Number(item.row) > 0 ? Number(item.row) : 0;
      const previous = byPhone.get(phone);
      byPhone.set(phone, previous
        ? { ...previous, cnpjs: [...new Set([...previous.cnpjs, ...cnpjs])] }
        : { row, phone, cnpjs });
    }
    return [...byPhone.values()];
  }

  private async plan(token: string, session: string, input: unknown) {
    await this.auth.requirePermission(token, 'canAssign');
    const context = await this.auth.connectionContext(token);
    if (context.sessionId !== session) throw new BadRequestException('Sessão do WhatsApp inválida.');
    const rows = this.parse(input);
    const profiles = await this.db.query(
      `SELECT chat_id AS "chatId", data FROM openwa.contact_profiles
       WHERE session_id=$1 AND COALESCE((data->>'directoryHidden')::boolean,false)=false`, [session],
    ) as ProfileRow[];
    const byPhone = new Map<string, ProfileRow[]>();
    for (const profile of profiles) {
      const fallback = /^[0-9]+@(c\.us|s\.whatsapp\.net)$/.test(profile.chatId)
        ? profile.chatId.split('@')[0] : '';
      const phone = String(profile.data.phone || fallback).replace(/\D/g, '');
      if (!phone) continue;
      byPhone.set(phone, [...(byPhone.get(phone) || []), profile]);
    }
    const issues: Issue[] = [];
    const matched: { source: SourceRow; profile: ProfileRow }[] = [];
    for (const source of rows) {
      const candidates = byPhone.get(source.phone) || [];
      if (candidates.length === 1) matched.push({ source, profile: candidates[0] });
      else issues.push({ row: source.row, phone: source.phone,
        reason: candidates.length ? 'Mais de um cadastro usa este telefone.' : 'Contato existente não encontrado pelo telefone.' });
    }
    const owners = new Map<string, Set<string>>();
    for (const row of rows) for (const cnpj of row.cnpjs)
      owners.set(cnpj, new Set([...(owners.get(cnpj) || []), row.phone]));
    const duplicateCnpjs = [...owners.values()].filter(phones => phones.size > 1).length;
    return { rows, matched, issues, duplicateCnpjs };
  }

  async preview(token: string, session: string, input: unknown) {
    const plan = await this.plan(token, session, input);
    return { total: plan.rows.length, matched: plan.matched.length,
      missing: plan.issues.filter(issue => issue.reason.startsWith('Contato')).length,
      ambiguous: plan.issues.filter(issue => issue.reason.startsWith('Mais')).length,
      duplicateCnpjs: plan.duplicateCnpjs, issues: plan.issues };
  }

  async apply(token: string, session: string, input: unknown) {
    const plan = await this.plan(token, session, input);
    let updated = 0, unchanged = 0;
    const issues = [...plan.issues];
    await this.db.transaction(async db => {
      for (const { source, profile } of [...plan.matched].sort((a, b) => a.profile.chatId.localeCompare(b.profile.chatId))) {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          [JSON.stringify([session, profile.chatId])]);
        const [current] = await db.query(
          'SELECT data FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2 FOR UPDATE',
          [session, profile.chatId],
        ) as { data: ContactData }[];
        const currentPhone = String(current?.data?.phone || (/^[0-9]+@(c\.us|s\.whatsapp\.net)$/.test(profile.chatId)
          ? profile.chatId.split('@')[0] : '')).replace(/\D/g, '');
        if (!current || current.data.directoryHidden || currentPhone !== source.phone) {
          issues.push({ row: source.row, phone: source.phone, reason: 'O cadastro mudou após a prévia; revise este contato.' });
          continue;
        }
        const existing = normalizeCnpjList(current.data.cnpjs || []);
        const merged = [...new Set([...existing, ...source.cnpjs])];
        if (merged.length > 20) {
          issues.push({ row: source.row, phone: source.phone, reason: 'O contato ultrapassaria o limite de 20 CNPJs.' });
          continue;
        }
        if (merged.length === existing.length) { unchanged++; continue; }
        await db.query(
          `UPDATE openwa.contact_profiles SET data=jsonb_set(data,'{cnpjs}',$3::jsonb,true),
           revision=revision+1,updated_at=NOW() WHERE session_id=$1 AND chat_id=$2`,
          [session, profile.chatId, JSON.stringify(merged)],
        );
        updated++;
      }
    });
    return { total: plan.rows.length, updated, unchanged, skipped: issues.length,
      duplicateCnpjs: plan.duplicateCnpjs, issues };
  }
}

@Public()
@Controller('operator-auth/contacts')
export class ContactCnpjImportController {
  constructor(private readonly importer: ContactCnpjImportService) {}

  @Post(':session/cnpj-import/preview')
  preview(@Headers('x-atende-token') token = '', @Param('session') session: string, @Body() body: unknown) {
    return this.importer.preview(token, session, body);
  }

  @Post(':session/cnpj-import/apply')
  apply(@Headers('x-atende-token') token = '', @Param('session') session: string, @Body() body: unknown) {
    return this.importer.apply(token, session, body);
  }
}
