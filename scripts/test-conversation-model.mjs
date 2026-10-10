import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listFrom, mergeMessages, messageDisplayText, messageIdentityIds, parseVCard, toChat, toMessage } from '../app/conversation-model.ts';

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

test('identifica grupos e mostra quem escreveu uma mensagem recebida', () => {
  assert.equal(toChat({ id: 'equipe@g.us', name: 'Equipe' }).isGroup, true);
  const message = toMessage({
    id: 'grupo-1', chatId: 'equipe@g.us', isGroup: true, fromMe: false,
    author: '5511999999999@c.us', contact: { pushName: 'Ana' }, body: 'Bom dia',
  }, 'history');
  assert.equal(message.senderName, 'Ana');
  assert.equal(toMessage({ ...message, fromMe: true }).senderName, undefined);
});

test('mensagens distintas do mesmo participante em grupo não são fundidas na atualização', () => {
  const firstId = 'true_120363000000000000@g.us_MSG1_5511999999999@c.us';
  const secondId = 'true_120363000000000000@g.us_MSG2_5511999999999@c.us';
  const first = toMessage({ id: firstId, chatId: '120363000000000000@g.us', fromMe: true, body: 'Primeira' }, 'history');
  const second = toMessage({ id: secondId, chatId: '120363000000000000@g.us', fromMe: true, body: 'Segunda' }, 'history');
  assert.deepEqual(messageIdentityIds(firstId), [firstId, 'true_120363000000000000@g.us_MSG1']);
  assert.equal(mergeMessages([first, second]).length, 2);

  const sameMessageFromDatabase = toMessage({
    id: 'registro-local', waMessageId: 'true_120363000000000000@g.us_MSG1_123456@lid',
    chatId: '120363000000000000@g.us', direction: 'outgoing', body: 'Primeira',
  });
  const merged = mergeMessages([first, second, sameMessageFromDatabase]);
  assert.equal(merged.length, 2);
  assert.ok(merged.some(message => message.body === 'Primeira'));
  assert.ok(merged.some(message => message.body === 'Segunda'));
});

test('interpreta contato encaminhado como cartão e não como vCard bruto', () => {
  const vcard = [
    'BEGIN:VCARD', 'VERSION:3.0', 'N;Leticia;;;', 'FN:Leticia',
    'TEL;type=CELL;type=VOICE;waid=558898389380:+55 88 98838-9380', 'END:VCARD',
  ].join('\n');
  assert.deepEqual(parseVCard(vcard), [{ name: 'Leticia', phone: '+55 88 98838-9380', waid: '558898389380' }]);
  const message = toMessage({ id: 'contact-1', type: 'contact', body: vcard, timestamp: 1791244800 });
  assert.deepEqual(message.contactCards, [{ name: 'Leticia', phone: '+55 88 98838-9380', waid: '558898389380' }]);
  assert.equal(messageDisplayText(message), 'Leticia');
  assert.equal(toChat({ id: '5511000000000@c.us', lastMessage: { type: 'contact', body: vcard } }).last, 'Leticia');
});
