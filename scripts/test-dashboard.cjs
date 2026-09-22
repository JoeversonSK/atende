const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ts=require('typescript');
function load(file,dependencies={}){
 const module={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(path.resolve(file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',js)(id=>dependencies[id]||require(id),module,module.exports);
 return module.exports;
}
const model=load('app/dashboard-model.ts');
assert.equal(model.clockDuration(3661),'01:01:01');
assert.equal(model.clockDuration(900),'00:15:00');
assert.equal(model.clockDuration(null),'—');
assert.equal(model.elapsed(NaN,Date.now()),null);
assert.equal(model.clockDuration(90000),'25:00:00');
const {TicketDashboard}=load('app/ticket-dashboard.tsx',{'./dashboard-model':model});
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const html=renderToStaticMarkup(React.createElement(TicketDashboard,{
 chats:[{id:'a@c.us',name:'Remote customer'},{id:'b@c.us',name:'Onsite customer'},{id:'c@c.us',name:'Waiting customer'},{id:'d@c.us',name:'Closed customer'},{id:'e@g.us',name:'Excluded group'}],
 owners:{'a@c.us':{assigneeId:'agent',assigneeName:'Test analyst',updatedAt:new Date(Date.now()-10000).toISOString()},'b@c.us':{assigneeId:'agent',assigneeName:'Test analyst'},'d@c.us':{assigneeId:'agent',assigneeName:'Test analyst'}},
 overview:{agents:[{id:'agent',displayName:'Test analyst'}],contacts:[{chatId:'b@c.us',data:{serviceType:'onsite',priority:'high'}},{chatId:'d@c.us',data:{status:'closed'}}],activity:[{chatId:'c@c.us',queueSince:String(Date.now()/1000-1000)}],completed:[{assigneeId:'agent',assigneeName:'Test analyst',count:3,totalSeconds:3661}]},onOpen:()=>{},onClose:()=>{}
}));
for(const label of ['Atendimentos realizados','Fila de espera','Em atendimento','Concluídos','Test analyst','01:01:01','Remoto','Presencial','Alta','Em alerta'])assert.ok(html.includes(label),label);
assert.ok(!html.includes('Closed customer'));assert.ok(!html.includes('Excluded group'));
assert.equal((html.match(/Test analyst/g)||[]).length,3);
assert.ok(!html.includes('board-footnote'));
const timestamp=Date.now()/1000;
const queueHtml=renderToStaticMarkup(React.createElement(TicketDashboard,{
 chats:[{id:'waiting@c.us',name:'Incoming awaiting reply'},{id:'empty@c.us',name:'No messages'},{id:'outgoing@c.us',name:'Only outgoing'},{id:'answered@c.us',name:'Already answered'},{id:'read@c.us',name:'Read but unanswered'},{id:'closed@c.us',name:'Closed incoming'},{id:'group@g.us',name:'Group incoming'}],
 owners:{},overview:{agents:[],contacts:[{chatId:'closed@c.us',data:{status:'closed'}}],activity:[
  {chatId:'waiting@c.us',incoming:String(timestamp-1000),outgoing:null,queueSince:String(timestamp-1000)},
  {chatId:'outgoing@c.us',incoming:null,outgoing:String(timestamp-300),queueSince:null},
  {chatId:'answered@c.us',incoming:String(timestamp-500),outgoing:String(timestamp-100),queueSince:null},
  {chatId:'read@c.us',incoming:String(timestamp-100),outgoing:null,queueSince:String(timestamp-100)},
  {chatId:'closed@c.us',incoming:String(timestamp-100),queueSince:String(timestamp-100)},
  {chatId:'group@g.us',incoming:String(timestamp-100),queueSince:String(timestamp-100)}
 ]},onOpen:()=>{},onClose:()=>{}
}));
for(const name of ['Incoming awaiting reply','Read but unanswered'])assert.ok(queueHtml.includes(name),name);
for(const name of ['No messages','Only outgoing','Already answered','Closed incoming','Group incoming'])assert.ok(!queueHtml.includes(name),name);
assert.ok(queueHtml.includes('<b>2</b><span>Na fila</span>'));
assert.ok(queueHtml.includes('<b>1</b><span>Em alerta</span>'));
assert.ok(queueHtml.indexOf('>Incoming awaiting reply</button>')<queueHtml.indexOf('>Read but unanswered</button>'));
console.log('PASS: dashboard rendering, timers, missing timestamps, active/closed/group filtering, types, priority and waiting alerts.');
