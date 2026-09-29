const {createRequire}=require('node:module');
const {Client}=createRequire('/app/package.json')('pg');
const {randomUUID,randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
async function main(){
  const db=new Client({host:process.env.DATABASE_HOST,port:Number(process.env.DATABASE_PORT),database:process.env.DATABASE_NAME,user:process.env.DATABASE_USERNAME,password:process.env.DATABASE_PASSWORD});
  await db.connect();const users=[],replies=[];
  const base='http://127.0.0.1:2785/api/operator-auth',shortcut='qa_'+randomUUID().slice(0,8);
  try {
    for(let i=0;i<2;i++){
      const response=await fetch(base+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'qa_reply_'+randomUUID().slice(0,8),password:randomBytes(24).toString('hex'),displayName:'Quick Reply QA'})});
      assert.equal(response.status,201);users.push(await response.json());
    }
    await db.query("UPDATE openwa.operator_users SET role='admin' WHERE id=$1",[users[0].user.id]);
    const admin={'Content-Type':'application/json','X-Atende-Token':users[0].token},agent={'Content-Type':'application/json','X-Atende-Token':users[1].token};
    assert.equal((await fetch(base+'/quick-replies')).status,401);
    const body=JSON.stringify({shortcut,text:'Olá!\nComo posso ajudar?'});
    assert.equal((await fetch(base+'/admin/quick-replies',{method:'POST',headers:agent,body})).status,403);
    const created=await fetch(base+'/admin/quick-replies',{method:'POST',headers:admin,body});assert.equal(created.status,201);
    const reply=await created.json();replies.push(reply.id);
    const listed=await (await fetch(base+'/quick-replies',{headers:agent})).json();assert.equal(listed.find(item=>item.id===reply.id).text,'Olá!\nComo posso ajudar?');
    assert.equal((await fetch(base+'/admin/quick-replies',{method:'POST',headers:admin,body})).status,409);
    const updated=await fetch(base+'/admin/quick-replies/'+reply.id,{method:'PUT',headers:admin,body:JSON.stringify({shortcut:shortcut+'_edit',text:'Mensagem atualizada'})});assert.equal(updated.status,200);
    assert.equal((await updated.json()).text,'Mensagem atualizada');
    assert.equal((await fetch(base+'/admin/quick-replies/'+reply.id,{method:'DELETE',headers:admin})).status,200);
    console.log('PASS: cadastro, edição, leitura pela equipe, atalhos duplicados e permissões de mensagens rápidas.');
  } finally {
    for(const id of replies)await db.query('DELETE FROM openwa.quick_replies WHERE id=$1',[id]);
    for(const account of users){await db.query('DELETE FROM openwa.operator_sessions WHERE user_id=$1',[account.user.id]);await db.query('DELETE FROM openwa.operator_users WHERE id=$1',[account.user.id]);}
    await db.end();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
