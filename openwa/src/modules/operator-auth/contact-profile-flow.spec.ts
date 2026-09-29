import { ContactProfileService } from './contact-profile.controller';

describe('ContactProfileService flow poll continuation', () => {
  it('records the selected option as an incoming message before finishing the flow', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          chat_id: '5511999999999@c.us',
          steps: [],
          expected_options: ['Sim', 'Não'],
          actor_id: 'agent-1',
          actor_name: 'Agente',
        },
      ])
      .mockResolvedValueOnce([{ session_id: 'session-1' }])
      .mockResolvedValueOnce([]);
    const service = new ContactProfileService({ query } as never, {} as never, {} as never);

    await expect(
      service.handleFlowPollVote('session-1', {} as never, {
        pollMessageId: 'poll-1',
        voterId: '5511999999999@c.us',
        selectedOptions: ['Sim'],
        timestamp: 1_800_000_000,
      }),
    ).resolves.toBe(true);

    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('DELETE FROM openwa.support_flow_runs'), [
      'session-1',
      '5511999999999@c.us',
      'poll-1',
    ]);
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO openwa.messages'),
      expect.arrayContaining(['session-1', '5511999999999@c.us', 'Sim']),
    );
  });

  it.each(['Wesley - Coordenador de Suporte', 'Joeverson', 'Thiago', 'Crislainy', 'Gabryel - Analista de Suporte'])(
    'adds a private completion tag for the assigned target agent: %s',
    async assigneeName => {
      const query = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ data: { status: 'open', tags: ['Cliente'] }, revision: 2 }])
        .mockResolvedValueOnce([{ assignee_id: 'agent-1', assignee_name: assigneeName, updated_at: new Date() }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ data: { status: 'closed', tags: ['Cliente'] }, revision: 3 }])
        .mockResolvedValueOnce([{ tag: 'Lançar atendimento' }]);
      const transaction = jest.fn(async callback => callback({ query }));
      const auth = { requirePermission: jest.fn().mockResolvedValue({ id: 'agent-1' }) };
      const service = new ContactProfileService({ transaction } as never, auth as never, {} as never);

      const result = await service.close('token', 'session-1', '5511999999999@c.us');

      expect(query).toHaveBeenCalledWith(expect.stringContaining('contact_operator_tags'), [
        'session-1',
        '5511999999999@c.us',
        'agent-1',
        'Lançar atendimento',
      ]);
      const savedData = JSON.parse(query.mock.calls[6][1][2]);
      expect(savedData.tags).toEqual(['Cliente']);
      expect(result.data.tags).toEqual(['Cliente', 'Lançar atendimento']);
    },
  );

  it('does not show one agent completion tag to another agent', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ data: { status: 'open', tags: ['Cliente'] }, revision: 2 }])
      .mockResolvedValueOnce([
        { assignee_id: 'agent-1', assignee_name: 'Wesley - Coordenador de Suporte', updated_at: new Date() },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ data: { status: 'closed', tags: ['Cliente'] }, revision: 3 }])
      .mockResolvedValueOnce([]);
    const transaction = jest.fn(async callback => callback({ query }));
    const auth = { requirePermission: jest.fn().mockResolvedValue({ id: 'agent-2' }) };
    const service = new ContactProfileService({ transaction } as never, auth as never, {} as never);

    const result = await service.close('token', 'session-1', '5511999999999@c.us');

    expect(result.data.tags).toEqual(['Cliente']);
  });

  it.each([
    ['agent-1', [{ tag: 'Lançar atendimento' }], ['Cliente', 'Lançar atendimento']],
    ['agent-2', [], ['Cliente']],
  ])('shows the launch filter only in its owner catalog: %s', async (operatorId, privateTags, expected) => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ tag: 'Cliente' }])
      .mockResolvedValueOnce(privateTags);
    const auth = { me: jest.fn().mockResolvedValue({ id: operatorId }) };
    const service = new ContactProfileService({ query } as never, auth as never, {} as never);

    await expect(service.tags('token', 'session-1')).resolves.toEqual(expected);
  });

  it('does not add the completion tag for another assigned agent', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ data: { status: 'open', tags: ['Cliente'] }, revision: 2 }])
      .mockResolvedValueOnce([{ assignee_id: 'agent-2', assignee_name: 'Outro atendente', updated_at: new Date() }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ data: { status: 'closed', tags: ['Cliente'] }, revision: 3 }])
      .mockResolvedValueOnce([]);
    const transaction = jest.fn(async callback => callback({ query }));
    const auth = { requirePermission: jest.fn().mockResolvedValue({ id: 'admin' }) };
    const service = new ContactProfileService({ transaction } as never, auth as never, {} as never);

    await service.close('token', 'session-1', '5511999999999@c.us');

    const savedData = JSON.parse(query.mock.calls[5][1][2]);
    expect(savedData.tags).toEqual(['Cliente']);
  });
});
