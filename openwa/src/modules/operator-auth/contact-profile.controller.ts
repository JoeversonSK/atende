import { BadRequestException, Body, ConflictException, Controller, Get, Headers, Injectable, OnModuleInit, Param, Post, Put } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { Public } from '../auth/decorators/auth.decorators';
import { OperatorAuthService } from './operator-auth.service';

export type ContactData = { name:string; phone:string; email:string; company:string; document:string; address:string; status:string; closedAt?:number; queueOpenedAt?:number; serviceType?:string; priority?:string; notes:{id:string;text:string;author:string;createdAt:string}[]; events:{id:string;title:string;date:string}[]; tags:string[]; sequences:string[]; campaigns:string[]; custom:{id:string;label:string;value:string}[] };
export const emptyContact = ():ContactData => ({name:'',phone:'',email:'',company:'',document:'',address:'',status:'open',serviceType:'remote',priority:'normal',notes:[],events:[],tags:[],sequences:[],campaigns:[],custom:[]});
@Injectable()
export class ContactProfileService implements OnModuleInit {
  async close(token:string, session:string, chat:string) {
    await this.auth.requirePermission(token,'canAssign');
    this.identifiers(session,chat);
    return this.db.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([session,chat])]);
      const [current]=await db.query('SELECT data,revision FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',[session,chat]);
      const [owner]=await db.query('SELECT assignee_id,assignee_name,updated_at FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2 FOR UPDATE',[session,chat]);
      await db.query('DELETE FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2',[session,chat]);
      if (current?.data?.status==='closed') return current;
      if (owner) {
        const seconds=owner.updated_at?Math.max(0,Math.floor((Date.now()-new Date(owner.updated_at).getTime())/1000)):0;
        await db.query('INSERT INTO openwa.support_completions (id,session_id,chat_id,assignee_id,assignee_name,duration_seconds) VALUES ($1,$2,$3,$4,$5,$6)',[randomUUID(),session,chat,owner.assignee_id,owner.assignee_name,seconds]);
      }
      const data={...(current?.data||emptyContact()),status:'closed',closedAt:Date.now()};
      const [saved]=await db.query('INSERT INTO openwa.contact_profiles (session_id,chat_id,data,revision) VALUES ($1,$2,$3,$4) ON CONFLICT(session_id,chat_id) DO UPDATE SET data=EXCLUDED.data,revision=EXCLUDED.revision,updated_at=NOW() RETURNING data,revision',[session,chat,JSON.stringify(data),(current?.revision||0)+1]);
      return saved;
    });
  }
  // Called only by the live, deduplicated inbound pipeline, never by history imports.
  async reopenOnIncoming(session:string, chat:string, timestamp:number, fromMe=false, isGroup=false) {
    if(fromMe||isGroup||/@(g\\.us|broadcast|newsletter)$/.test(chat)||!Number.isFinite(timestamp)||timestamp<=0)return false;
    return this.db.transaction(async db=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([session,chat])]);
      const [current]=await db.query('SELECT data,revision,updated_at FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',[session,chat]);
      if(current?.data?.status!=='closed')return false;
      const closedAt=current.data.closedAt||new Date(current.updated_at).getTime();
      // WhatsApp timestamps have second precision; exclude earlier seconds and offline history.
      if(timestamp<Math.floor(closedAt/1000))return false;
      const data={...current.data,status:'open',serviceType:'remote',queueOpenedAt:timestamp};
      await db.query('DELETE FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2',[session,chat]);
      await db.query('UPDATE openwa.contact_profiles SET data=$3,revision=revision+1,updated_at=NOW() WHERE session_id=$1 AND chat_id=$2',[session,chat,JSON.stringify(data)]);
      return true;
    });
  }
  async overview(token:string, session:string) {
    await this.auth.me(token);this.identifiers(session,'overview');
    const contacts=await this.db.query('SELECT chat_id AS "chatId",data FROM openwa.contact_profiles WHERE session_id=$1',[session]);
    const agents=await this.db.query('SELECT id,display_name AS "displayName" FROM openwa.operator_users WHERE active=true ORDER BY display_name');
    const activity=await this.db.query(`WITH activity AS (
      SELECT "chatId",MAX(timestamp) FILTER (WHERE direction='incoming') AS incoming,
      MAX(timestamp) FILTER (WHERE direction='outgoing' AND status NOT IN ('failed','pending')) AS outgoing
      FROM openwa.messages WHERE "sessionId"=$1 GROUP BY "chatId"
    ) SELECT a."chatId",a.incoming,a.outgoing,
      (SELECT MIN(m.timestamp) FROM openwa.messages m WHERE m."sessionId"=$1 AND m."chatId"=a."chatId" AND m.direction='incoming' AND m.timestamp>COALESCE(a.outgoing,0) AND m.timestamp>=COALESCE((SELECT (p.data->>'queueOpenedAt')::bigint FROM openwa.contact_profiles p WHERE p.session_id=$1 AND p.chat_id=a."chatId"),0)) AS "queueSince",
      (SELECT MIN(m.timestamp) FROM openwa.messages m WHERE m."sessionId"=$1 AND m."chatId"=a."chatId" AND m.direction='outgoing' AND m.status NOT IN ('failed','pending') AND m.timestamp>COALESCE(a.incoming,0)) AS "waitingSince"
      ,(SELECT m."chatName" FROM openwa.messages m WHERE m."sessionId"=$1 AND m."chatId"=a."chatId" AND m."chatName" IS NOT NULL ORDER BY m.timestamp DESC NULLS LAST LIMIT 1) AS name
      FROM activity a WHERE a."chatId" NOT LIKE '%@g.us' AND a."chatId" NOT LIKE '%@broadcast' AND a."chatId" NOT LIKE '%@newsletter'`,[session]);
    const completed=await this.db.query(`SELECT c.assignee_id AS "assigneeId",COALESCE(u.display_name,c.assignee_name,'Sem responsável') AS "assigneeName",COUNT(*)::int AS count,SUM(c.duration_seconds)::bigint AS "totalSeconds" FROM openwa.support_completions c LEFT JOIN openwa.operator_users u ON u.id=c.assignee_id WHERE c.session_id=$1 AND (c.closed_at AT TIME ZONE 'America/Sao_Paulo')::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date GROUP BY c.assignee_id,COALESCE(u.display_name,c.assignee_name,'Sem responsável')`,[session]);
    return {contacts,agents,activity,completed};
  }
  constructor(@InjectDataSource('data') private readonly db:DataSource, private readonly auth:OperatorAuthService) {}
  async onModuleInit(){await this.db.query('CREATE TABLE IF NOT EXISTS openwa.contact_profiles (session_id varchar(255) NOT NULL,chat_id varchar(255) NOT NULL,data jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(session_id,chat_id))');await this.ensureCompletions();}
  private async ensureCompletions(){await this.db.query('CREATE TABLE IF NOT EXISTS openwa.support_completions (id varchar(36) PRIMARY KEY,session_id varchar(255) NOT NULL,chat_id varchar(255) NOT NULL,assignee_id varchar(36),assignee_name varchar(160),closed_at timestamptz NOT NULL DEFAULT NOW(),duration_seconds integer NOT NULL DEFAULT 0)');await this.db.query('CREATE INDEX IF NOT EXISTS support_completions_session_closed_idx ON openwa.support_completions(session_id,closed_at)');}
  private identifiers(session:string,chat:string){if(!session||!chat||session.length>255||chat.length>255)throw new BadRequestException('Contato inválido.');}
  async get(token:string,session:string,chat:string){
    await this.auth.me(token);this.identifiers(session,chat);
    const [row]=await this.db.query('SELECT data,revision FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',[session,chat]);
    return row||{data:emptyContact(),revision:0};
  }
  async save(token:string,session:string,chat:string,body:unknown){
    const user=await this.auth.requirePermission(token,'canAssign');this.identifiers(session,chat);
    const input=body as {revision:number;data:ContactData};
    if(!input || !Number.isInteger(input.revision)||input.revision<0||!input.data||JSON.stringify(input.data).length>64000)throw new BadRequestException('Dados inválidos ou muito extensos.');
    const text=(value:unknown,max=300)=>{if(typeof value!=='string'||value.length>max)throw new BadRequestException('Revise os campos preenchidos.');return value.trim();};
    const list=<T>(value:unknown,convert:(item:any)=>T):T[]=>{if(!Array.isArray(value)||value.length>100)throw new BadRequestException('Cada seção aceita até 100 itens.');return value.map(convert);};
    const d=input.data;
    const cleaned:ContactData={name:text(d.name),phone:text(d.phone,50),email:text(d.email),company:text(d.company),document:text(d.document,50),address:text(d.address,1000),status:text(d.status,20),serviceType:'remote',priority:text(d.priority??"normal",20),
      notes:list(d.notes,n=>({id:text(n?.id,80),text:text(n?.text,5000),author:'',createdAt:''})),
      events:list(d.events,e=>({id:text(e?.id,80),title:text(e?.title),date:text(e?.date,30)})),
      tags:list(d.tags,v=>text(v,80)),sequences:list(d.sequences,v=>text(v,160)),campaigns:list(d.campaigns,v=>text(v,160)),
      custom:list(d.custom,c=>({id:text(c?.id,80),label:text(c?.label,100),value:text(c?.value,2000)}))};
    if(!['remote','onsite'].includes(cleaned.serviceType!)||!['low','normal','high'].includes(cleaned.priority!))throw new BadRequestException('Tipo ou prioridade inválida.');
    if(!['open','pending','closed'].includes(cleaned.status))throw new BadRequestException('Status inválido.');
    if(cleaned.events.some(e=>!e.title||!e.date||!Number.isFinite(Date.parse(e.date)))||cleaned.notes.some(n=>!n.id||!n.text)||cleaned.custom.some(c=>!c.id||!c.label))throw new BadRequestException('Preencha os títulos, notas e datas.');
    if(new Set(cleaned.notes.map(n=>n.id)).size!==cleaned.notes.length)throw new BadRequestException('Notas duplicadas.');
    return this.db.transaction(async db=>{
      // Serialize initial creation as well as later edits of this contact.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([session,chat])]);
      const [current]=await db.query('SELECT data,revision FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',[session,chat]);
      if((current?.revision||0)!==input.revision)throw new ConflictException('Outra pessoa atualizou este perfil. Recarregue antes de salvar para não sobrescrever as alterações.');
      if(cleaned.status==='closed'&&current?.data?.status!=='closed'){
        const [owner]=await db.query('SELECT assignee_id,assignee_name,updated_at FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2',[session,chat]);
        const seconds=owner?.updated_at?Math.max(0,Math.floor((Date.now()-new Date(owner.updated_at).getTime())/1000)):0;
        await db.query('INSERT INTO openwa.support_completions (id,session_id,chat_id,assignee_id,assignee_name,duration_seconds) VALUES ($1,$2,$3,$4,$5,$6)',[randomUUID(),session,chat,owner?.assignee_id||null,owner?.assignee_name||null,seconds]);
      }
      if(current?.data?.status==='closed'&&cleaned.status!=='closed')await db.query('UPDATE openwa.conversation_assignments SET updated_at=NOW() WHERE session_id=$1 AND chat_id=$2',[session,chat]);
      cleaned.closedAt=cleaned.status==='closed'&&current?.data?.status!=='closed'?Date.now():current?.data?.closedAt;
      cleaned.queueOpenedAt=current?.data?.queueOpenedAt;
      cleaned.notes=cleaned.notes.map(n=>{
        const old=current?.data?.notes?.find((o:ContactData['notes'][number])=>o.id===n.id);
        if(old && old.text!==n.text)throw new BadRequestException('Notas existentes não podem ser editadas. Adicione uma nova nota.');
        return old||{...n,author:user.displayName,createdAt:new Date().toISOString()};
      });
      const [row]=await db.query('INSERT INTO openwa.contact_profiles (session_id,chat_id,data,revision) VALUES ($1,$2,$3,$4) ON CONFLICT(session_id,chat_id) DO UPDATE SET data=EXCLUDED.data,revision=EXCLUDED.revision,updated_at=NOW() RETURNING data,revision',[session,chat,JSON.stringify(cleaned),input.revision+1]);
      return row;
    });
  }
}
@Public()
@Controller('operator-auth/contacts')
export class ContactProfileController {
  constructor(private readonly profiles:ContactProfileService){}
  @Post(':session/:chat/close') close(@Headers('x-atende-token') token='',@Param('session') session:string,@Param('chat') chat:string){return this.profiles.close(token,session,chat);}
  @Get(':session') overview(@Headers('x-atende-token') token='',@Param('session') session:string){return this.profiles.overview(token,session);}
  @Get(':session/:chat') get(@Headers('x-atende-token') token='',@Param('session') session:string,@Param('chat') chat:string){return this.profiles.get(token,session,chat);}
  @Put(':session/:chat') save(@Headers('x-atende-token') token='',@Param('session') session:string,@Param('chat') chat:string,@Body() body:unknown){return this.profiles.save(token,session,chat,body);}
}
