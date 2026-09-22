// This command requires local Docker access. Never expose it through a public API.
const {Client}=require('pg');
const {randomBytes,createHash}=require('node:crypto');
async function main(){
  const username=(process.argv[2]||'').trim().toLowerCase();
  if(!/^[a-z0-9._-]{3,80}$/.test(username)) throw new Error('Uso: node scripts/recover-operator.cjs nome-do-usuario');
  const db=new Client({host:process.env.DATABASE_HOST,port:Number(process.env.DATABASE_PORT||5432),database:process.env.DATABASE_NAME,user:process.env.DATABASE_USERNAME,password:process.env.DATABASE_PASSWORD});
  await db.connect();
  try {
    await db.query('BEGIN');
    const {rows}=await db.query('SELECT id FROM openwa.operator_users WHERE username=$1 AND active=true FOR UPDATE',[username]);
    if(!rows.length) throw new Error('Conta ativa não encontrada. Confira o usuário.');
    const code=randomBytes(32).toString('base64url');
    await db.query("INSERT INTO openwa.operator_recovery (user_id,token_hash,expires_at) VALUES ($1,$2,NOW()+INTERVAL '15 minutes') ON CONFLICT(user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at",[rows[0].id,createHash('sha256').update(code).digest('hex')]);
    await db.query('COMMIT');
    console.log('Código de recuperação para '+username+' (uso único, válido por 15 minutos):\n'+code+'\nUse em Esqueci minha senha. Não compartilhe este código.');
  } catch(e){await db.query('ROLLBACK');throw e;}
  finally{await db.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
