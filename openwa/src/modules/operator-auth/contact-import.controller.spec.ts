import { ContactImportService, normalizeImportPhone } from './contact-import.controller';

describe('contact spreadsheet import', () => {
  it('normalizes Brazilian local numbers without changing full international numbers', () => {
    expect(normalizeImportPhone('(11) 99999-9999')).toBe('5511999999999');
    expect(normalizeImportPhone('+55 11 99999-9999')).toBe('5511999999999');
    expect(normalizeImportPhone('+1 212 555 0100')).toBe('12125550100');
    expect(() => normalizeImportPhone('')).toThrow('Telefone inválido');
  });

  it('updates an existing LID profile, keeps private history, merges tags and assigns Sabrina', async () => {
    const original = { name: 'Antigo', phone: '5511999999999', status: 'closed', closedAt: 100,
      notes: [{ id: 'note-1', text: 'Importante', author: 'Agente', createdAt: '2026-09-01' }], tags: ['Cliente'] };
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM openwa.operator_users')) return [{ id: 'sabrina-id', username: 'sabrina', display_name: 'Sabrina' }];
      if (sql.includes('FROM (SELECT chat_id FROM openwa.contact_profiles')) return [{ chatId: 'some-lid@lid', phone: '5511999999999', hasProfile: true }];
      if (sql.includes('SELECT data FROM openwa.contact_profiles')) return [{ data: original }];
      if (sql.includes('RETURNING updated_at')) return [{ updated_at: new Date() }];
      return [];
    });
    const events = { emitConversationAssigned: jest.fn() };
    const db = { query, transaction: async (run: (db: { query: typeof query }) => Promise<unknown>) => run({ query }) };
    const auth = { requirePermission: jest.fn().mockResolvedValue({}), connectionContext: jest.fn().mockResolvedValue({ sessionId: 'session-1', user: { id: 'admin', displayName: 'Admin' } }) };
    const importer = new ContactImportService(db as never, auth as never, { get: () => undefined } as never, events as never);
    await expect(importer.import('token', 'session-1', { contacts: [{ firstName: 'Maria', lastName: 'Silva', phone: '5511999999999', tags: ['Cliente', 'Sabrina - Atribuido'] }] }))
      .resolves.toEqual({ created: 0, updated: 1, assigned: 1 });
    const write = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO openwa.contact_profiles'))!;
    expect(write[1]?.[0]).toBe('session-1');
    expect(write[1]?.[1]).toBe('some-lid@lid');
    expect(JSON.parse(write[1]?.[2] as string)).toMatchObject({
      name: 'Maria Silva', phone: '5511999999999', status: 'open', notes: original.notes,
      tags: ['Cliente', 'Sabrina - Atribuido'],
    });
    expect(events.emitConversationAssigned).toHaveBeenCalledWith('session-1', expect.objectContaining({ chatId: 'some-lid@lid', assigneeId: 'sabrina-id' }));
  });

  it('creates a new profile without assigning contacts that lack the Sabrina tag', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM (SELECT chat_id FROM openwa.contact_profiles')) return [];
      if (sql.includes('SELECT data FROM openwa.contact_profiles')) return [];
      return [];
    });
    const db = { query, transaction: async (run: (db: { query: typeof query }) => Promise<unknown>) => run({ query }) };
    const auth = { requirePermission: jest.fn().mockResolvedValue({}), connectionContext: jest.fn().mockResolvedValue({ sessionId: 'session-1', user: { id: 'admin', displayName: 'Admin' } }) };
    const importer = new ContactImportService(db as never, auth as never, { get: () => undefined } as never, {} as never);
    await expect(importer.import('token', 'session-1', { contacts: [{ firstName: 'Paulo', lastName: '', phone: '5511888888888', tags: ['Cliente'] }] }))
      .resolves.toEqual({ created: 1, updated: 0, assigned: 0 });
    const write = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO openwa.contact_profiles'))!;
    expect(write[1]?.[1]).toBe('5511888888888@c.us');
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO openwa.conversation_assignments'))).toBe(false);
  });
});
