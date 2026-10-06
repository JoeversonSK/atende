import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listFrom, mergeMessages, messageIdentityIds, toChat, toMessage } from '../app/conversation-model.ts';

test('normaliza lista e prévia de conversa sem depender da interface', () => {
  assert.deepEqual(listFrom({ items: [{ id: '1' }] }), [{ id: '1' }]);
  assert.deepEqual(listFrom({ messages: [{ id: '2' }] }, 'messages'), [{ id: '2' }]);
  assert.equal(toChat({ id: '5511000000000@c.us', name: 'Cliente de teste', lastMessageType: 'image', lastMessageHasMedia: true }).last, 'Imagem');
});

test('preserva identidade, citação, encaminhamento e mídia do histórico', () => {
  const message = toMessage({
    id: 'true_5511000000000@c.us_ABC', type: 'image', fromMe: true, timestamp: 1791244800,
    media: { mimetype: 'image/png', filename: 'teste.png', omitted: true },
    quotedMessage: { id: 'false_5511000000000@c.us_ORIGINAL', body: 'Original' }, forwarded: true,
  }, 'history');
  assert.equal(message.mine, true);
  assert.equal(message.forwarded, true);
  assert.equal(message.quotedMessage?.body, 'Original');
  assert.equal(message.media?.filename, 'teste.png');
  assert.equal(message.media?.omitted, true);
  assert.deepEqual(messageIdentityIds(message.id), ['true_5511000000000@c.us_ABC', 'true_ABC']);
  assert.equal(mergeMessages([message, message]).length, 1);
});
