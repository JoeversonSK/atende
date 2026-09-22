// Temporary API key is scoped to a nonexistent session and removed in finally.
const {createRequire}=require('node:module');
const req=createRequire('/app/package.json');
const {randomBytes,randomUUID}=require('node:crypto');
const {hashApiKey}=req('/app/dist/modules/auth/api-key-hash.js');
const assert=require('node:assert/strict');
const db=new (req('better-sqlite3'))('/app/data/main.sqlite');
const id=randomUUID(), key=randomBytes(32).toString('hex'), session='permission-test-'+id;
async function main(){
  db.prepare('INSERT INTO api_keys (id,name,keyHash,keyPrefix,role,allowedSessions,isActive,usageCount,createdAt,updatedAt) VALUES (?,?,?,?,?,?,1,0,datetime(\'now\'),datetime(\'now\'))').run(id,'Disposable permission test',hashApiKey(key,process.env.API_KEY_PEPPER),key.slice(0,12),'operator',session);
  try{
    for(const [method,path] of [['POST','messages/send-text'],['PUT','conversations/permission-test/assignment']]){
      const r=await fetch('http://127.0.0.1:2785/api/sessions/'+session+'/'+path,{method,headers:{'X-API-Key':key,'Content-Type':'application/json'},body:'{}'});
      const data=await r.json();
      assert.equal(r.status,401);assert.equal(data.message,'Faça login para continuar.');
      console.log('PASS HTTP '+method+' '+path+': valid API key still requires employee login');
    }
  } finally {db.prepare('DELETE FROM api_keys WHERE id=?').run(id);db.close();console.log('Temporary test key removed.');}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
