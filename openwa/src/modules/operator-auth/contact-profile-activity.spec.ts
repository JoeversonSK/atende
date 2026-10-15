import { ContactProfileService } from './contact-profile.controller';

describe('ContactProfileService dashboard activity', () => {
  it('returns a lightweight team snapshot with the database clock', async () => {
    const now = new Date('2026-10-15T15:00:00.000Z');
    const agents = [{ id: 'agent-1', displayName: 'Ana', activityStatus: 'break', activityUntil: new Date(now.getTime() + 900_000) }];
    const onsiteActive = [{ id: 'visit-1', assigneeId: 'agent-2', assigneeName: 'Bia', clientName: 'Teste' }];
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM openwa.operator_users')) return agents;
      if (sql.includes('FROM openwa.operator_onsite_visits')) return onsiteActive;
      if (sql.includes('SELECT NOW()')) return [{ serverNow: now }];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const auth = { me: jest.fn().mockResolvedValue({ id: 'agent-1' }) };
    const service = new ContactProfileService({ query } as never, auth as never, {} as never);

    await expect(service.dashboardActivity('token', 'session-1'))
      .resolves.toEqual({ agents, onsiteActive, serverNow: now });
    expect(auth.me).toHaveBeenCalledWith('token');
    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('v.session_id=$1'), ['session-1']);
  });

  it('does not read team status without an authenticated operator', async () => {
    const query = jest.fn();
    const auth = { me: jest.fn().mockRejectedValue(new Error('Unauthorized')) };
    const service = new ContactProfileService({ query } as never, auth as never, {} as never);

    await expect(service.dashboardActivity('invalid', 'session-1')).rejects.toThrow('Unauthorized');
    expect(query).not.toHaveBeenCalled();
  });
});
