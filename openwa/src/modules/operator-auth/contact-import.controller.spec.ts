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

  it('ignores punctuation-only names and restores a hidden contact on reimport', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM (SELECT chat_id FROM openwa.contact_profiles')) return [{ chatId: '5511888888888@c.us', phone: '5511888888888', hasProfile: true }];
      if (sql.includes('SELECT data FROM openwa.contact_profiles')) return [{ data: { name: 'Nome existente', phone: '5511888888888', tags: [], directoryHidden: true } }];
      return [];
    });
    const db = { query, transaction: async (run: (db: { query: typeof query }) => Promise<unknown>) => run({ query }) };
    const auth = { requirePermission: jest.fn().mockResolvedValue({}), connectionContext: jest.fn().mockResolvedValue({ sessionId: 'session-1', user: { id: 'admin' } }) };
    const importer = new ContactImportService(db as never, auth as never, { get: () => undefined } as never, {} as never);
    await importer.import('token', 'session-1', { contacts: [{ firstName: '.', lastName: '', phone: '5511888888888', tags: [] }] });
    const write = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO openwa.contact_profiles'))!;
    expect(JSON.parse(write[1]?.[2] as string)).toMatchObject({ name: 'Nome existente', directoryHidden: false });
  });

  it('reconciles a phone-keyed import with the existing phone-less LID conversation', async () => {
    const lid = '123456789012345@lid', phoneChat = '558896556723@c.us';
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM (SELECT chat_id FROM openwa.contact_profiles')) return [
        { chatId: lid, phone: '', name: '', hasProfile: false, hidden: false },
        { chatId: phoneChat, phone: '558896556723', name: 'Djalma Max Móveis', hasProfile: true, hidden: false },
      ];
      if (sql.includes('SELECT data FROM openwa.contact_profiles')) return params?.[1] === phoneChat
        ? [{ data: { name: 'Djalma Max Móveis', phone: '558896556723', tags: ['Clipp'] } }] : [];
      return [];
    });
    const db = { query, transaction: async (run: (db: { query: typeof query }) => Promise<unknown>) => run({ query }) };
    const auth = { requirePermission: jest.fn().mockResolvedValue({}), connectionContext: jest.fn().mockResolvedValue({ sessionId: 'session-1', user: { id: 'admin' } }) };
    const engine = { getContacts: jest.fn().mockResolvedValue([]), getChats: jest.fn().mockResolvedValue([
      { id: lid, name: 'Djalma Max Móveis', isGroup: false },
    ]) };
    const importer = new ContactImportService(db as never, auth as never, { get: () => engine } as never, {} as never);
    await expect(importer.import('token', 'session-1', { contacts: [
      { firstName: 'Djalma Max', lastName: 'Móveis', phone: '558896556723', tags: ['IntegraPAG'] },
    ] })).resolves.toEqual({ created: 0, updated: 1, assigned: 0 });
    const write = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO openwa.contact_profiles'))!;
    expect(write[1]?.[1]).toBe(lid);
    expect(JSON.parse(write[1]?.[2] as string)).toMatchObject({ name: 'Djalma Max Móveis', phone: '558896556723', tags: ['Clipp', 'IntegraPAG'] });
    expect(query.mock.calls.some(([sql, params]) => sql.includes('UPDATE openwa.contact_profiles SET data=jsonb_set') && params?.[1] === phoneChat)).toBe(true);
    expect(query.mock.calls.some(([sql, params]) => sql.includes('SELECT 1 FROM openwa.messages') && params?.[1] === phoneChat)).toBe(true);
  });

  it('only offers unique full-name pairs for bulk reconciliation', async () => {
    const db = { query: jest.fn(async (sql: string) => sql.includes('COUNT(*)') ? [{ total: 1 }] : [
      { chatId: '558896556723@c.us', data: { name: 'Djalma Max Móveis', phone: '558896556723', tags: ['Clipp'] } },
      { chatId: '5511999991111@c.us', data: { name: 'Nome Repetido', phone: '5511999991111', tags: [] } },
    ]) };
    const auth = { requirePermission: jest.fn().mockResolvedValue({}), connectionContext: jest.fn().mockResolvedValue({ sessionId: 'session-1' }) };
    const engine = { getChats: jest.fn().mockResolvedValue([
      { id: 'lid-1@lid', name: 'Djalma Max Móveis' },
      { id: 'lid-2@lid', name: 'Nome Repetido' }, { id: 'lid-3@lid', name: 'Nome Repetido' },
    ]) };
    const importer = new ContactImportService(db as never, auth as never, { get: () => engine } as never, {} as never);
    const run = jest.spyOn(importer, 'import').mockResolvedValue({ created: 0, updated: 1, assigned: 0 });
    await expect(importer.reconcile('token', 'session-1')).resolves.toMatchObject({ candidates: 1, reconciled: 1, skipped: 0 });
    expect(run).toHaveBeenCalledWith('token', 'session-1', { contacts: [
      { firstName: 'Djalma Max Móveis', lastName: '', phone: '558896556723', tags: ['Clipp'] },
    ] });
  });

  it('does not create a phone-keyed duplicate when old LID chats cannot be checked', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('FROM (SELECT chat_id FROM openwa.contact_profiles')
      ? [{ chatId: '123456789012345@lid', phone: '', hasProfile: false }] : []);
    const db = { query, transaction: jest.fn() };
    const auth = { requirePermission: jest.fn().mockResolvedValue({}), connectionContext: jest.fn().mockResolvedValue({ sessionId: 'session-1' }) };
    const importer = new ContactImportService(db as never, auth as never, { get: () => undefined } as never, {} as never);
    await expect(importer.import('token', 'session-1', { contacts: [
      { firstName: 'Novo', lastName: 'Contato', phone: '558896556723', tags: [] },
    ] })).rejects.toThrow('Conecte o WhatsApp');
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
