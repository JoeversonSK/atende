import { OutOfHoursReplyService, outsideBusinessHours } from './out-of-hours-reply.service';

const hours = {
  enabled: true,
  autoReplyEnabled: true,
  autoReplyMessage: 'Voltaremos no próximo horário de atendimento.',
  days: [{ weekday: 0, enabled: true, intervals: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }] }],
};
const incoming = { chatId: '5511999999999@c.us', fromMe: false, timestamp: 0 };

describe('out-of-hours reply', () => {
  it('uses São Paulo time and treats lunch and closing time as outside hours', () => {
    expect(outsideBusinessHours(hours, new Date('2026-09-28T14:00:00Z')).outside).toBe(false);
    expect(outsideBusinessHours(hours, new Date('2026-09-28T15:00:00Z')).outside).toBe(true);
    expect(outsideBusinessHours(hours, new Date('2026-09-28T16:00:00Z')).outside).toBe(false);
    expect(outsideBusinessHours(hours, new Date('2026-09-28T21:00:00Z'))).toEqual({ outside: true, localDate: '2026-09-28' });
  });

  it('sends at most once per contact and local day', async () => {
    let claimed = false;
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT operation_hours')) return Promise.resolve([{ operation_hours: { ...hours, days: [] } }]);
      if (sql.includes('INSERT INTO openwa.out_of_hours_replies')) {
        if (claimed) return Promise.resolve([]);
        claimed = true;
        return Promise.resolve([{ session_id: 'session' }]);
      }
      return Promise.resolve([]);
    });
    const engine = { sendTextMessage: jest.fn().mockResolvedValue({ id: 'reply', timestamp: 0 }) };
    const service = new OutOfHoursReplyService({ query } as never, { isLive: () => true } as never);
    expect(await service.reply('session', engine as never, incoming as never)).toBe(true);
    expect(await service.reply('session', engine as never, incoming as never)).toBe(false);
    expect(engine.sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('never replies to groups, own messages, or a disabled auto-reply', async () => {
    const query = jest.fn().mockResolvedValue([{ operation_hours: { ...hours, autoReplyEnabled: false } }]);
    const engine = { sendTextMessage: jest.fn() };
    const service = new OutOfHoursReplyService({ query } as never, { isLive: () => true } as never);
    expect(await service.reply('session', engine as never, { ...incoming, chatId: 'group@g.us' } as never)).toBe(false);
    expect(await service.reply('session', engine as never, { ...incoming, fromMe: true } as never)).toBe(false);
    expect(await service.reply('session', engine as never, incoming as never)).toBe(false);
    expect(engine.sendTextMessage).not.toHaveBeenCalled();
  });

  it('releases the daily claim if WhatsApp sending fails', async () => {
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT operation_hours')) return Promise.resolve([{ operation_hours: { ...hours, days: [] } }]);
      if (sql.includes('INSERT INTO openwa.out_of_hours_replies')) return Promise.resolve([{ session_id: 'session' }]);
      return Promise.resolve([]);
    });
    const engine = { sendTextMessage: jest.fn().mockRejectedValue(new Error('offline')) };
    const service = new OutOfHoursReplyService({ query } as never, { isLive: () => true } as never);
    await expect(service.reply('session', engine as never, incoming as never)).rejects.toThrow('offline');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM openwa.out_of_hours_replies'), expect.any(Array));
  });
});
