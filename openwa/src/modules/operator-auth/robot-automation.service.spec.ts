import { RobotAutomationService, renderRobotTemplate } from './robot-automation.service';

const flowId = '12345678-1234-1234-1234-123456789abc';
const incoming = { chatId: '558888530990@c.us', fromMe: false, isGroup: false, isStatusBroadcast: false, timestamp: Math.floor(Date.now() / 1000) };
const config = { enabled: true, message: 'Boa tarde!\nAtendimento reduzido.', flowId, contactName: 'Félix', contactPhone: '558888530990', generation: 3 };
const auth = { requireAdmin: jest.fn().mockResolvedValue(undefined), connectionContext: jest.fn().mockResolvedValue({ sessionId: 'sessao' }) };

describe('robô de atendimento', () => {
  it('preenche campos automáticos do contato sem nome de atendente humano', () => {
    const text = renderRobotTemplate('{{saudacao}}, {{cliente}}! Fale com {{atendente}} às {{hora}}.',
      { name: 'Cliente Teste' }, incoming.chatId, new Date('2026-10-09T17:00:00Z'));
    expect(text).toBe('Boa tarde, Cliente Teste! Fale com Robô às 14:00.');
  });
  it('não considera grupos, mensagens próprias ou histórico antigo', async () => {
    const query = jest.fn();
    const service = new RobotAutomationService({ query } as never, auth as never, {} as never);
    expect(await service.configForIncoming('sessao', { ...incoming, isGroup: true } as never)).toBeNull();
    expect(await service.configForIncoming('sessao', { ...incoming, fromMe: true } as never)).toBeNull();
    expect(await service.configForIncoming('sessao', { ...incoming, timestamp: 1 } as never)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('envia mensagem, cartão e fluxo uma vez por cliente na ativação', async () => {
    let claimed = false;
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT enabled,generation')) return [{ enabled: true, generation: 3 }];
      if (sql.includes('SELECT active,kind,steps')) return [{ active: true, kind: 'regular', steps: [{ type: 'message', text: 'Até mais!' }] }];
      if (sql.includes('INSERT INTO openwa.atende_robot_sends')) {
        if (claimed) return [];
        claimed = true;
        return [{ chat_id: incoming.chatId }];
      }
      return [];
    });
    const engine = { sendTextMessage: jest.fn().mockResolvedValue({}), sendContactMessage: jest.fn().mockResolvedValue({}) };
    const service = new RobotAutomationService({ query } as never, auth as never, { isLive: () => true } as never);
    expect(await service.reply('sessao', engine as never, incoming as never, config)).toBe(true);
    expect(await service.reply('sessao', engine as never, incoming as never, config)).toBe(false);
    expect(engine.sendTextMessage.mock.calls.map(call => call[1])).toEqual([config.message, 'Até mais!']);
    expect(engine.sendContactMessage).toHaveBeenCalledWith(incoming.chatId, { name: 'Félix', number: '+558888530990' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('status=$4,error=$5'),
      ['sessao', 3, incoming.chatId, 'sent', null]);
  });

  it('libera nova tentativa quando o primeiro envio falha sem entregar mensagem', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT enabled,generation')) return [{ enabled: true, generation: 3 }];
      if (sql.includes('INSERT INTO openwa.atende_robot_sends')) return [{ chat_id: incoming.chatId }];
      return [];
    });
    const engine = { sendTextMessage: jest.fn().mockRejectedValue(new Error('conexão indisponível')) };
    const service = new RobotAutomationService({ query } as never, auth as never, { isLive: () => true } as never);
    await expect(service.reply('sessao', engine as never, incoming as never, { ...config, flowId: null }))
      .rejects.toThrow('conexão indisponível');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM openwa.atende_robot_sends'),
      ['sessao', 3, incoming.chatId]);
  });

  it('reativar gera uma nova rodada sem apagar a anterior', async () => {
    const query = jest.fn().mockResolvedValue([{ ...config, generation: 4 }]);
    const service = new RobotAutomationService({ query } as never, auth as never, {} as never);
    await service.save('admin', { enabled: true, message: 'Nova mensagem', contactName: '', contactPhone: '' });
    const sql = query.mock.calls.find(([statement]) => statement.includes('ON CONFLICT (session_id)'))?.[0] as string;
    expect(sql).toContain('enabled=false AND EXCLUDED.enabled=true');
    expect(sql).toContain('generation+1');
    expect(sql).not.toContain('DELETE FROM openwa.atende_robot_sends');
  });

  it('impede fluxo com ações e aceita desligar mesmo que o fluxo salvo fique indisponível', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT active,kind,steps')
      ? [{ active: true, kind: 'regular', steps: [{ type: 'action', action: 'close-ticket' }] }]
      : [{ enabled: false }]);
    const service = new RobotAutomationService({ query } as never, auth as never, {} as never);
    const value = { enabled: true, message: 'Olá!', flowId, contactName: '', contactPhone: '' };
    await expect(service.save('admin', value)).rejects.toThrow('apenas fluxos com mensagens, mídia e pausas');
    await expect(service.save('admin', { ...value, enabled: false })).resolves.toEqual({ enabled: false });
  });
});
