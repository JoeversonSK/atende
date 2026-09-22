const {createRequire}=require('node:module');
const req=createRequire('/app/package.json');
const {Client}=req('pg');
const {randomUUID,randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
async function main(){
 const db=new Client({host:process.env.DATABASE_HOST,port:Number(process.env.DATABASE_PORT),database:process.env.DATABASE_NAME,user:process.env.DATABASE_USERNAME,password:process.env.DATABASE_PASSWORD});
 await db.connect();let id;
 const username='qa_contact_'+randomUUID().slice(0,8),session=randomUUID(),chat=randomUUID();
 const base='http://127.0.0.1:2785/api/operator-auth';
 try{
  const r=await fetch(base+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:randomBytes(24).toString('hex'),displayName:'Profile QA'})});
  const account=await r.json();assert.equal(r.status,201);id=account.user.id;
  const path=base+'/contacts/'+session+'/'+chat,headers={'Content-Type':'application/json','X-Atende-Token':account.token};
  assert.equal((await fetch(path)).status,401);
  const initial=await (await fetch(path,{headers})).json();
  initial.data.name='Test profile';initial.data.tags=['Test'];
  let saved=await fetch(path,{method:'PUT',headers,body:JSON.stringify(initial)});assert.equal(saved.status,200);const result=await saved.json();assert.equal(result.revision,1);
  assert.equal((await (await fetch(path,{headers})).json()).data.name,'Test profile');
  const overviewPath=base+'/contacts/'+session;
  assert.equal((await fetch(overviewPath)).status,401);
  const overviewResponse=await fetch(overviewPath,{headers});assert.equal(overviewResponse.status,200);
  const overview=await overviewResponse.json();assert.equal(overview.contacts.find(c=>c.chatId===chat).data.name,'Test profile');
  assert.ok(overview.agents.some(a=>a.id===id));
  assert.equal((await fetch(path,{method:'PUT',headers,body:JSON.stringify(initial)})).status,409);
  assert.equal((await fetch(path+'/close',{method:'POST'})).status,401);
  const finish=await fetch(path+'/close',{method:'POST',headers});assert.equal(finish.status,201);
  const closed=await finish.json();assert.equal(closed.data.status,'closed');assert.equal(closed.data.name,'Test profile');
  const repeated=await (await fetch(path+'/close',{method:'POST',headers})).json();assert.equal(repeated.revision,closed.revision);
  assert.equal((await (await fetch(overviewPath,{headers})).json()).contacts.find(c=>c.chatId===chat).data.status,'closed');
  console.log('PASS HTTP: close endpoint, authentication, persisted closed status and duplicate protection.');
  console.log('PASS HTTP: authentication, save, reload, dashboard/contact names, active agents and simultaneous-edit conflict.');
 }finally{
  await db.query('DELETE FROM openwa.support_completions WHERE session_id=$1 AND chat_id=$2',[session,chat]);
  await db.query('DELETE FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',[session,chat]);
  if(id)await db.query('DELETE FROM openwa.operator_users WHERE id=$1 AND username=$2',[id,username]);
  await db.end();console.log('Only temporary test records removed.');
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
