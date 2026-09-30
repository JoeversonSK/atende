import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TeamChatService } from './team-chat.controller';

describe('internal team chat', () => {
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  const messageId = '33333333-3333-4333-8333-333333333333';

  function setup(active = true, ownsMessage = true) {
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT id FROM openwa.operator_users WHERE id=')) return active ? [{ id: params?.[0] }] : [];
      if (sql.includes('username=ANY')) return [{ id: bob }];
      if (sql.includes('SELECT recipient_id AS "recipientId"')) return ownsMessage ? [{ recipientId: null }] : [];
      if (sql.includes('WITH sent AS')) return [{ id: 'message-id', senderId: alice, recipientId: params?.[2], body: params?.[3] }];
      if (sql.includes('WITH changed AS')) return ownsMessage ? [{ id: messageId, senderId: alice, body: params?.[2] || '' }] : [];
      return [];
    });
    const auth = { me: jest.fn().mockResolvedValue({ id: alice, displayName: 'Alice' }) };
    return { query, auth, chat: new TeamChatService({ query } as never, auth as never) };
  }

  it('sends a private message only to an active colleague', async () => {
    const { chat, query } = setup();
    await expect(chat.send('token', bob, ' Olá, Bob ')).resolves.toMatchObject({ recipientId: bob, body: 'Olá, Bob' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO openwa.team_messages'),
      [expect.any(String), alice, bob, 'Olá, Bob', '[]']);
  });

  it('prevents messages to self or inactive accounts', async () => {
    const { chat } = setup(false);
    await expect(chat.send('token', alice, 'Olá')).rejects.toBeInstanceOf(BadRequestException);
    await expect(chat.send('token', bob, 'Olá')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('restricts individual history to the two participants', async () => {
    const { chat, query } = setup();
    await chat.messages('token', bob);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('(m.sender_id=$1 AND m.recipient_id=$2)'),
      [alice, bob, null]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('(m.sender_id=$2 AND m.recipient_id=$1)'),
      [alice, bob, null]);
  });

  it('resolves group mentions to active user IDs rather than trusting client input', async () => {
    const { chat, query } = setup();
    await chat.send('token', 'group', 'Oi @bob');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('username=ANY'), [['bob']]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO openwa.team_messages'),
      [expect.any(String), alice, null, 'Oi @bob', JSON.stringify([bob])]);
  });

  it('allows only the author to edit or delete a message', async () => {
    const allowed = setup();
    await allowed.chat.edit('token', messageId, 'Texto corrigido');
    await allowed.chat.remove('token', messageId);
    expect(allowed.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id=$1 AND sender_id=$2 AND deleted_at IS NULL'),
      [messageId, alice, 'Texto corrigido', '[]']);
    const denied = setup(true, false);
    await expect(denied.chat.edit('token', messageId, 'Outro texto')).rejects.toBeInstanceOf(NotFoundException);
    await expect(denied.chat.remove('token', messageId)).rejects.toBeInstanceOf(NotFoundException);
  });
});
