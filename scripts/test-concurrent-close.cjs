const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');

const req = createRequire('/app/package.json');
const { DataSource } = req('typeorm');
const { ContactProfileService } = req('/app/dist/modules/operator-auth/contact-profile.controller.js');

async function main() {
  const db = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });
  const session = `concurrent-close-${randomUUID()}`;
  const chats = Array.from({ length: 12 }, () => `${randomUUID()}@c.us`);
  const auth = {
    me: async () => ({ displayName: 'Concurrent test' }),
    requirePermission: async () => ({ displayName: 'Concurrent test' }),
  };

  await db.initialize();
  try {
    const profiles = new ContactProfileService(db, auth);
    await profiles.onModuleInit();
    for (const chat of chats) {
      await db.query(
        'INSERT INTO openwa.conversation_assignments (session_id,chat_id,assignee_name,updated_at) VALUES ($1,$2,$3,NOW())',
        [session, chat, 'Concurrent test'],
      );
    }

    const results = await Promise.all(chats.map((chat) => profiles.close('test', session, chat)));
    assert.equal(results.filter((result) => result.data.status === 'closed').length, chats.length);
    const [{ count: assigned }] = await db.query(
      'SELECT COUNT(*)::int AS count FROM openwa.conversation_assignments WHERE session_id=$1',
      [session],
    );
    const [{ count: completed }] = await db.query(
      'SELECT COUNT(*)::int AS count FROM openwa.support_completions WHERE session_id=$1',
      [session],
    );
    assert.equal(assigned, 0);
    assert.equal(completed, chats.length);
    console.log(`PASS: ${chats.length} different conversations closed concurrently.`);
  } finally {
    await db.query('DELETE FROM openwa.support_completions WHERE session_id=$1', [session]).catch(() => undefined);
    await db.query('DELETE FROM openwa.conversation_assignments WHERE session_id=$1', [session]).catch(() => undefined);
    await db.query('DELETE FROM openwa.contact_profiles WHERE session_id=$1', [session]).catch(() => undefined);
    await db.destroy();
    console.log('Temporary concurrency test data removed.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
