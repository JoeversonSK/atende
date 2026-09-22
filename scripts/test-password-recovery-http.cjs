const {createRequire}=require('node:module');
const req=createRequire('/app/package.json');
const {Client}=req('pg');
const {randomUUID,randomBytes}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
async function main(){
  const username='qa_recovery_'+randomUUID().slice(0,8),password=randomBytes(24).toString('hex'),newPassword=randomBytes(24).toString('hex');
  const db=new Client({host:process.env.DATABASE_HOST,port:Number(process.env.DATABASE_PORT),database:process.env.DATABASE_NAME,user:process.env.DATABASE_USERNAME,password:process.env.DATABASE_PASSWORD});
  await db.connect();
  const post=async(path,body)=>{const r=await fetch('http://127.0.0.1:2785/api/operator-auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  let id;
  try{
    const created=await post('register',{username,password,displayName:'Temporary recovery test'});
    assert.equal(created.status,201);id=created.data.user.id;
    const output=execFileSync(process.execPath,['/app/scripts/recover-operator.cjs',username],{encoding:'utf8'});
    const code=output.split('\n').find(line=>/^[A-Za-z0-9_-]{43}$/.test(line));
    assert.ok(code);
    assert.equal((await post('reset-password',{username,code:'invalid'.repeat(7),password:newPassword})).status,401);
    assert.equal((await post('reset-password',{username,code,password:newPassword})).status,201);
    assert.equal((await post('reset-password',{username,code,password})).status,401);
    assert.equal((await post('login',{username,password:newPassword})).status,201);
    console.log('PASS HTTP: CLI code generation, invalid code rejection, reset, single use, new login.');
  } finally {
    if(id) await db.query('DELETE FROM openwa.operator_users WHERE id=$1 AND username=$2',[id,username]);
    await db.end();console.log('Temporary test account removed; real accounts unchanged.');
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
