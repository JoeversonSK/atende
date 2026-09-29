import { ContactProfileService } from './contact-profile.controller';

describe('contact directory', () => {
  it('hides only the directory entry, preserving the profile and conversation data', async () => {
    const original = { name: 'Maria', phone: '5511999999999', tags: ['Cliente'], notes: [{ id: '1', text: 'Anotação' }] };
    const query = jest.fn(async (sql: string, _params?: unknown[]) =>
      sql.includes('SELECT data FROM openwa.contact_profiles') ? [{ data: original }] : []);
    const db = { query, transaction: async (run: (db: { query: typeof query }) => Promise<unknown>) => run({ query }) };
    const auth = { requirePermission: jest.fn().mockResolvedValue({}), connectionContext: jest.fn().mockResolvedValue({ sessionId: 'session-1' }) };
    const profiles = new ContactProfileService(db as never, auth as never, {} as never);

    await expect(profiles.hideFromDirectory('token', 'session-1', '5511999999999@c.us')).resolves.toEqual({ success: true });
    const write = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO openwa.contact_profiles'))!;
    expect(JSON.parse(write[1]?.[2] as string)).toMatchObject({ ...original, directoryHidden: true });
    expect(query.mock.calls.some(([sql]) => /DELETE FROM openwa\.(messages|contact_profiles)/.test(sql))).toBe(false);
  });

  it('rejects an attempt to hide a contact from another session', async () => {
    const query = jest.fn();
    const db = { query, transaction: jest.fn() };
    const auth = { requirePermission: jest.fn().mockResolvedValue({}), connectionContext: jest.fn().mockResolvedValue({ sessionId: 'session-1' }) };
    const profiles = new ContactProfileService(db as never, auth as never, {} as never);
    await expect(profiles.hideFromDirectory('token', 'other-session', 'contact@c.us')).rejects.toThrow('Sessão do WhatsApp inválida.');
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
