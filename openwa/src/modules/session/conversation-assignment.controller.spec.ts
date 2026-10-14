import { ConversationAssignmentController } from './conversation-assignment.controller';

describe('ConversationAssignmentController', () => {
  function setup(initialStatus = 'open') {
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT data FROM openwa.contact_profiles')) return [{ data: { status: initialStatus } }];
      if (sql.includes('INSERT INTO openwa.conversation_assignments')) return [{
        assigneeName: 'Bia', assigneeId: 'agent-2', state: params?.[4], updatedAt: new Date(),
      }];
      return [];
    });
    const transaction = jest.fn(async callback => callback({ query }));
    const events = { emitConversationAssigned: jest.fn() };
    const controller = new ConversationAssignmentController({ manager: { transaction } } as never, events as never);
    return { controller, query, events };
  }

  it('keeps a forwarded conversation waiting without starting the service', async () => {
    const { controller, query, events } = setup();
    const result = await controller.assign('session-1', 'client@c.us',
      { assigneeName: 'Bia', assigneeId: 'agent-2', state: 'forwarded' },
      { atendeOperator: { id: 'agent-1', displayName: 'Ana' } });
    expect(result.state).toBe('forwarded');
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE openwa.contact_profiles'), expect.anything());
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO openwa.conversation_assignments'),
      ['session-1', 'client@c.us', 'Bia', 'agent-2', 'forwarded']);
    expect(events.emitConversationAssigned).toHaveBeenCalledWith('session-1',
      expect.objectContaining({ chatId: 'client@c.us', state: 'forwarded' }));
  });

  it('reopens a closed conversation into the waiting queue when forwarded', async () => {
    const { controller, query } = setup('closed');
    const result = await controller.assign('session-1', 'client@c.us',
      { assigneeName: 'Bia', assigneeId: 'agent-2', state: 'forwarded' }, {});
    expect(result.reopened).toBe(true);
    const update = query.mock.calls.find(([sql]) => sql.includes('UPDATE openwa.contact_profiles'));
    expect(JSON.parse(String(update?.[1]?.[2]))).toEqual(expect.objectContaining({
      status: 'open', queueOpenedAt: expect.any(Number),
    }));
  });

  it('starts an assigned conversation only on an explicit active assignment', async () => {
    const { controller, query } = setup();
    const result = await controller.assign('session-1', 'client@c.us',
      { assigneeName: 'Bia', assigneeId: 'agent-2', state: 'active' }, {});
    expect(result.state).toBe('active');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('state IS DISTINCT FROM EXCLUDED.state'),
      ['session-1', 'client@c.us', 'Bia', 'agent-2', 'active']);
  });
});
