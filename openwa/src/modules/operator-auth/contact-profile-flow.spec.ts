import { ContactProfileService, emptyContact } from './contact-profile.controller';

describe('ContactProfileService flow poll continuation', () => {
  it('mostra no chat @lid os CNPJs do cadastro telefônico sem duplicar o perfil', async () => {
    const phone = { chatId: '5511999999999@c.us', data: { ...emptyContact(), phone: '5511999999999', cnpjs: ['12345678000190'] }, revision: 3 };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT data,revision FROM openwa.contact_profiles')) return [];
      if (sql.includes('FROM openwa.lid_mappings')) return [phone];
      return [];
    });
    const auth = { me: jest.fn().mockResolvedValue({ id: 'agent-1' }) };
    const service = new ContactProfileService({ query } as never, auth as never, {} as never);

    const result = await service.get('token', 'session-1', '275316094312504@lid');

    expect(result.data.cnpjs).toEqual(['12345678000190']);
    expect(result.cnpjSourceRevision).toBe(3);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO openwa.contact_profiles'), expect.anything());
  });

  it('edita os CNPJs na origem telefônica e mantém o perfil @lid sem cópia', async () => {
    const phone = { chatId: '5511999999999@c.us', data: { ...emptyContact(), phone: '5511999999999', cnpjs: ['12345678000190'] }, revision: 3 };
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM openwa.lid_mappings')) return [phone];
      if (sql.includes('SELECT data FROM openwa.contact_profiles')) return [];
      if (sql.includes('SELECT data,revision FROM openwa.contact_profiles')) return [];
      if (sql.includes('UPDATE openwa.contact_profiles SET data=jsonb_set')) return [{ revision: 4 }];
      if (sql.includes('RETURNING data,revision')) return [{ data: JSON.parse(String(params?.[2])), revision: 1 }];
      return [];
    });
    const db = { query, transaction: jest.fn(async callback => callback({ query })) };
    const auth = { requirePermission: jest.fn().mockResolvedValue({ id: 'agent-1', displayName: 'Agente' }) };
    const service = new ContactProfileService(db as never, auth as never, {} as never);

    const result = await service.save('token', 'session-1', '275316094312504@lid', {
      revision: 0, cnpjSourceRevision: 3,
      data: { ...emptyContact(), phone: '5511999999999', cnpjs: ['98765432000110'] },
    });

    const sourceUpdate = query.mock.calls.find(([sql]) => sql.includes('UPDATE openwa.contact_profiles SET data=jsonb_set'));
    expect(sourceUpdate?.[1]).toEqual(['session-1', '5511999999999@c.us', JSON.stringify(['98765432000110']), 3]);
    const ownSave = query.mock.calls.find(([sql]) => sql.includes('RETURNING data,revision'));
    expect(JSON.parse(String(ownSave?.[1]?.[2])).cnpjs).toEqual([]);
    expect(result.data.cnpjs).toEqual(['98765432000110']);
    expect(result.cnpjSourceRevision).toBe(4);
  });

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

  it('encerra sem responsável e remove da fila sem contar para quem clicou', async () => {
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT data,revision')) return [{ data: { status: 'open', tags: [] }, revision: 1 }];
      if (sql.includes('RETURNING data,revision')) return [{ data: JSON.parse(String(params?.[2])), revision: 2 }];
      return [];
    });
    const transaction = jest.fn(async callback => callback({ query }));
    const auth = { requirePermission: jest.fn().mockResolvedValue({ id: 'agent-1', displayName: 'Gabryel - Analista de Suporte' }) };
    const service = new ContactProfileService({ transaction } as never, auth as never, {} as never);

    const result = await service.close('token', 'session-1', '5511999999999@c.us');

    expect(result.data.status).toBe('closed');
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO openwa.support_completions'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes('DELETE FROM openwa.conversation_assignments'))).toBe(true);
  });

  it('encerra um fluxo sem atribuição sem creditar ao operador que o disparou', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT data,revision')
      ? [{ data: { status: 'open', tags: [] }, revision: 1 }] : []);
    const transaction = jest.fn(async callback => callback({ query }));
    const service = new ContactProfileService({ transaction } as never, {} as never, {} as never) as any;

    await service.closeForFlow('session-1', '5511999999999@c.us');

    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO openwa.support_completions'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes('DELETE FROM openwa.conversation_assignments'))).toBe(true);
    const saved = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO openwa.contact_profiles'));
    expect(JSON.parse(saved?.[1][2]).status).toBe('closed');
  });

  it('salvar Fechado sem atribuição não cria conclusão de atendente', async () => {
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT data,revision')) return [{ data: { ...emptyContact(), status: 'open' }, revision: 1 }];
      if (sql.includes('RETURNING data,revision')) return [{ data: JSON.parse(String(params?.[2])), revision: 2 }];
      return [];
    });
    const transaction = jest.fn(async callback => callback({ query }));
    const auth = { requirePermission: jest.fn().mockResolvedValue({ id: 'agent-1', displayName: 'Gabryel - Analista de Suporte' }) };
    const service = new ContactProfileService({ transaction } as never, auth as never, {} as never);

    const result = await service.save('token', 'session-1', '5511999999999@c.us',
      { revision: 1, data: { ...emptyContact(), status: 'closed' } });

    expect(result.data.status).toBe('closed');
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO openwa.support_completions'))).toBe(false);
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
