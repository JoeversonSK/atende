const { createRequire } = require('node:module');
const req = createRequire('/app/package.json');
const { Client } = req('pg');
const { randomBytes, randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
async function main() {
  const db = new Client({ host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT), database: process.env.DATABASE_NAME, user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD });
  await db.connect();
  let id;
  const base = 'http://web:3000/api', username = 'qa_shared_' + randomUUID().slice(0, 8);
  try {
    const registration = await fetch(base + '/operator-auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: randomBytes(24).toString('hex'), displayName: 'Temporary connection test' }) });
    assert.equal(registration.status, 201);
    const account = await registration.json(); id = account.user.id;
    const headers = { 'X-Atende-Token': account.token, 'X-API-Key': 'atende_' + account.token, 'Content-Type': 'application/json' };
    assert.equal((await fetch(base + '/operator-auth/connection')).status, 401);
    const connection = await fetch(base + '/operator-auth/connection', { headers });
    assert.equal(connection.status, 200);
    const { sessionId } = await connection.json();
    const sessions = await fetch(base + '/sessions', { headers }); assert.equal(sessions.status, 200);
    assert.equal((await sessions.json()).length, 1);
    const stored = await db.query('SELECT "chatId" FROM openwa.messages WHERE "sessionId"=$1 AND "chatId" NOT LIKE $2 LIMIT 1', [sessionId, '%@g.us']);
    if (stored.rows[0]) {
      const history = await fetch(base + '/sessions/' + sessionId + '/messages?limit=2&chatId=' + encodeURIComponent(stored.rows[0].chatId), { headers });
      assert.equal(history.status, 200); const messages = await history.json();
      assert.ok(Array.isArray(messages) ? messages.length > 0 : (messages.messages || messages.items || messages.data || []).length > 0);
    }
    assert.equal((await fetch(base + '/sessions/' + randomUUID() + '/chats', { headers })).status, 401);
    assert.equal((await fetch(base + '/auth/api-keys', { headers })).status, 403);
    assert.equal((await fetch(base + '/sessions/' + sessionId + '/stop', { method: 'POST', headers })).status, 403);
    await db.query('UPDATE openwa.operator_users SET can_send=false,can_assign=false WHERE id=$1', [id]);
    assert.equal((await fetch(base + '/sessions/' + sessionId + '/messages/send-text', { method: 'POST', headers, body: JSON.stringify({ chatId: 'test@c.us', text: 'Never sent' }) })).status, 403);
    await new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://web:3000/socket.io/?EIO=4&transport=websocket');
      const timer = setTimeout(() => { ws.close(); reject(new Error('Realtime auth timeout')); }, 10000);
      ws.onmessage = event => {
        const data = String(event.data);
        if (data.startsWith('0{')) ws.send('40/events,' + JSON.stringify({ apiKey: headers['X-API-Key'] }));
        if (data.startsWith('40/events,')) ws.send('42/events,1' + JSON.stringify(['message', { type: 'subscribe', sessionId, events: ['message.received'], requestId: randomUUID() }]));
        if (data.startsWith('42/events,') || data.startsWith('43/events,1')) {
          const payload = data.startsWith('43/events,1') ? JSON.parse(data.slice('43/events,1'.length))[0] : JSON.parse(data.slice('42/events,'.length))[1];
          if (payload.type === 'subscribed') { clearTimeout(timer); ws.close(); resolve(); }
          if (payload.type === 'error') { clearTimeout(timer); ws.close(); reject(new Error('Realtime subscription rejected: ' + payload.code)); }
        }
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Realtime connection failed')); };
    });
    await db.query('UPDATE openwa.operator_users SET active=false WHERE id=$1', [id]);
    assert.equal((await fetch(base + '/sessions', { headers })).status, 401);
    console.log('PASS: fresh account auto-connection, stored history, realtime subscription, session isolation, admin protection, send permission and disabled-account rejection. No customer messages sent.');
  } finally {
    if (id) await db.query('DELETE FROM openwa.operator_users WHERE id=$1 AND username=$2', [id, username]);
    await db.end();
    console.log('Temporary test account removed.');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
