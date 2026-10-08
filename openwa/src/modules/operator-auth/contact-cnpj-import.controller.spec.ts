import { ContactCnpjImportService } from './contact-cnpj-import.controller';
import { normalizeCnpjList } from './contact-cnpj';

describe('importação de CNPJs para contatos existentes', () => {
  it('normaliza CNPJs separados e rejeita valores incompletos', () => {
    expect(normalizeCnpjList(['12.345.678/0001-90', '12345678000190', '98.765.432/0001-10']))
      .toEqual(['12345678000190', '98765432000110']);
    expect(() => normalizeCnpjList(['123'])).toThrow('14 dígitos');
  });

  it('mostra CNPJs repetidos entre telefones sem bloquear a importação', async () => {
    const db = { query: jest.fn().mockResolvedValue([
      { chatId: '111@lid', data: { phone: '5511999991111', cnpjs: [] } },
      { chatId: '222@lid', data: { phone: '5511999992222', cnpjs: [] } },
    ]) };
    const auth = { requirePermission: jest.fn().mockResolvedValue({}),
      connectionContext: jest.fn().mockResolvedValue({ sessionId: 'session-1' }) };
    const service = new ContactCnpjImportService(db as never, auth as never);
    const contacts = [
      { row: 1, phone: '5511999991111', cnpjs: ['12345678000190', '98765432000110'] },
      { row: 2, phone: '5511999992222', cnpjs: ['12345678000190'] },
    ];
    await expect(service.preview('token', 'session-1', { contacts })).resolves.toMatchObject({
      total: 2, matched: 2, duplicateCnpjs: 1, issues: [],
    });
    expect(auth.requirePermission).toHaveBeenCalledWith('token', 'canAssign');
  });

  it('atualiza apenas a lista de CNPJs e mantém os demais dados do perfil', async () => {
    const profile = { phone: '5511999991111', name: 'Contato preservado', document: '12345678901',
      tags: ['Cliente'], notes: [{ id: 'n1', text: 'Histórico', author: 'Equipe', createdAt: '2026-01-01' }],
      cnpjs: ['12345678000190'] };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT chat_id AS "chatId"')) return [{ chatId: '111@lid', data: profile }];
      if (sql.includes('SELECT data FROM openwa.contact_profiles')) return [{ data: profile }];
      return [];
    });
    const db = { query, transaction: async (run: (value: { query: typeof query }) => Promise<unknown>) => run({ query }) };
    const auth = { requirePermission: jest.fn().mockResolvedValue({}),
      connectionContext: jest.fn().mockResolvedValue({ sessionId: 'session-1' }) };
    const service = new ContactCnpjImportService(db as never, auth as never);
    await expect(service.apply('token', 'session-1', { contacts: [{ row: 3,
      phone: '5511999991111', cnpjs: ['12345678000190', '98765432000110'] }] }))
      .resolves.toMatchObject({ updated: 1, unchanged: 0, skipped: 0 });
    const update = query.mock.calls.find(([sql]) => sql.includes('SET data=jsonb_set'));
    expect(update?.[1]).toEqual(['session-1', '111@lid', JSON.stringify(['12345678000190', '98765432000110'])]);
    expect(query.mock.calls.some(([sql]) => sql.includes('DELETE FROM openwa.messages'))).toBe(false);
  });

  it('ignora telefone inexistente ou ligado a mais de um perfil', async () => {
    const db = { query: jest.fn().mockResolvedValue([
      { chatId: '111@lid', data: { phone: '5511999991111' } },
      { chatId: '5511999991111@c.us', data: { phone: '5511999991111' } },
    ]) };
    const auth = { requirePermission: jest.fn().mockResolvedValue({}),
      connectionContext: jest.fn().mockResolvedValue({ sessionId: 'session-1' }) };
    const service = new ContactCnpjImportService(db as never, auth as never);
    await expect(service.preview('token', 'session-1', { contacts: [
      { row: 1, phone: '5511999991111', cnpjs: ['12345678000190'] },
      { row: 2, phone: '5511999992222', cnpjs: ['98765432000110'] },
    ] })).resolves.toMatchObject({ matched: 0, ambiguous: 1, missing: 1 });
  });
});
