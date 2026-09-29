import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileMessages, messageTimestamp } from '../app/message-reconciliation.ts';

const row = (id, extra = {}) => ({ id, identityIds: [id], timestamp: 1000, time: '00:00', source: 'database', body: 'Pode mandar', ...extra });

test('confirmation collapses both local and already fetched WhatsApp copies', () => {
  const messages = [row('local', { source: 'optimistic' }), row('wa'), row('wa', { identityIds: ['local', 'wa'], source: 'history' })];
  const result = reconcileMessages(messages);
  assert.equal(result.length, 1);
  assert.deepEqual(new Set(result[0].identityIds), new Set(['local', 'wa']));
  assert.equal(reconcileMessages([...result, row('local'), row('wa')]).length, 1);
});

test('distinct real messages with identical body and second are retained', () => {
  assert.equal(reconcileMessages([row('wa-1'), row('wa-2')]).length, 2);
});

test('WhatsApp history time survives later database refreshes', () => {
  const history = row('wa', { source: 'history', timestamp: 2000, historyTimestamp: 2000, time: 'history', historyOrder: 1 });
  for (const messages of [[history, row('wa', { timestamp: 4000 })], [row('wa', { timestamp: 4000 }), history]]) {
    const result = reconcileMessages([...messages, row('other', { timestamp: 3000 })]);
    assert.deepEqual(result.map(m => m.id), ['wa', 'other']);
    assert.equal(result[0].time, 'history');
  }
});

test('same-second history order survives reverse database refresh and media refresh', () => {
  const result = reconcileMessages([
    row('z', { source: 'history', historyTimestamp: 1000, historyOrder: 0 }),
    row('a', { source: 'history', historyTimestamp: 1000, historyOrder: 1 }),
    row('a'), row('z'),
    row('z', { source: 'history', historyTimestamp: 1000, media: { data: 'image' } }),
  ]);
  assert.deepEqual(result.map(m => m.id), ['z', 'a']);
});

test('numeric seconds, milliseconds, numeric strings and ISO dates normalize equally', () => {
  const ms = 1790687342000;
  for (const value of [ms, ms / 1000, String(ms), String(ms / 1000), new Date(ms).toISOString()]) assert.equal(messageTimestamp(value), ms);
  assert.equal(messageTimestamp('invalid'), 0);
});
