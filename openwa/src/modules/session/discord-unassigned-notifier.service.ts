import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createLogger } from '../../common/services/logger.service';
import { IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import { redactSsrfError } from '../../common/security/ssrf-guard';
import { postWebhookPayload } from '../webhook/utils/deliver-once';

type HookRow={id:string;destination_type:'discord'|'json';url:string;only_unassigned:boolean;include_groups:boolean;include_text:boolean;include_media:boolean;sender_name:string;title:string;color:string;fields:string[]};

@Injectable()
export class DiscordUnassignedNotifier {
  private readonly logger=createLogger('NotificationWebhookNotifier');
  constructor(@InjectDataSource('data') private readonly db:DataSource) {}

  async notify(sessionId:string,message:IncomingMessage):Promise<boolean>{
    if(message.fromMe||/@(broadcast|newsletter)$/.test(message.chatId))return false;
    const isGroup=message.isGroup||/@g\.us$/.test(message.chatId);
    const hooks:HookRow[]=await this.db.query('SELECT id,destination_type,url,only_unassigned,include_groups,include_text,include_media,sender_name,title,color,fields FROM openwa.notification_webhooks WHERE active=true ORDER BY created_at,id');
    if(!hooks.length)return false;
    const [assignment]=await this.db.query('SELECT assignee_id,assignee_name FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2 LIMIT 1',[sessionId,message.chatId]);
    const hasMedia=this.isMedia(message.type);
    const selected=hooks.filter(hook=>(!hook.only_unassigned||!assignment)&&(!isGroup||hook.include_groups)&&(hasMedia?hook.include_media:hook.include_text));
    if(!selected.length)return false;
    const [profile]=await this.db.query("SELECT data,data->>'name' AS name,data->>'phone' AS phone FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2",[sessionId,message.chatId]);
    const contactName=String(profile?.name||message.contact?.name||message.contact?.pushName||message.contact?.verifiedName||profile?.phone||message.senderPhone||message.chatId.replace(/@.*/,''));
    const phone=String(profile?.phone||message.senderPhone||message.chatId.replace(/@.*/,''));
    const content=String(message.body||this.fallbackFor(message.type)).trim().slice(0,1500)||'Nova mensagem recebida.';
    const receivedAt=new Date((Number(message.timestamp)||Math.floor(Date.now()/1000))*1000).toISOString();
    const results=await Promise.all(selected.map(hook=>this.deliver(hook,{sessionId,chatId:message.chatId,contactName,phone,message:content,messageType:String(message.type||'text'),receivedAt,
      contactProfile:profile?.data||null,
      assignment:assignment?{id:assignment.assignee_id||null,name:assignment.assignee_name||null}:null,
      messageDetails:{id:message.id,type:String(message.type||'text'),body:content,timestamp:message.timestamp,from:message.from,to:message.to,isGroup:Boolean(isGroup),hasMedia}})));
    return results.some(Boolean);
  }

  private async deliver(hook:HookRow,data:Record<string,any>){
    const selected=new Set(Array.isArray(hook.fields)?hook.fields:[]);
    const payload=hook.destination_type==='discord'?this.discordPayload(hook,data,selected):this.jsonPayload(data,selected);
    try{
      await postWebhookPayload(hook.url,JSON.stringify(payload),{'Content-Type':'application/json'},8000);
      return true;
    }catch(error){this.logger.warn('Não foi possível enviar uma notificação configurada',{webhookId:hook.id,error:redactSsrfError(error)});return false;}
  }

  private discordPayload(hook:HookRow,data:Record<string,any>,selected:Set<string>){
    const fields=[] as {name:string;value:string;inline:boolean}[];
    if(selected.has('contactName'))fields.push({name:'Contato',value:data.contactName.slice(0,100),inline:true});
    if(selected.has('phone'))fields.push({name:'WhatsApp',value:data.phone.slice(0,100),inline:true});
    if(selected.has('messageType'))fields.push({name:'Tipo',value:data.messageType.slice(0,100),inline:true});
    if(selected.has('receivedAt'))fields.push({name:'Recebida em',value:new Date(data.receivedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),inline:true});
    if(selected.has('assignment')&&data.assignment?.name)fields.push({name:'Responsável',value:String(data.assignment.name).slice(0,100),inline:true});
    if(selected.has('contactProfile')&&data.contactProfile?.tags?.length)fields.push({name:'Etiquetas',value:String(data.contactProfile.tags.join(', ')).slice(0,1000),inline:false});
    return {username:hook.sender_name||'Atende',allowed_mentions:{parse:[]},embeds:[{title:hook.title||'Nova mensagem',description:selected.has('message')?data.message:undefined,color:parseInt(String(hook.color||'#0b917a').slice(1),16),fields,timestamp:data.receivedAt}]};
  }

  private jsonPayload(data:Record<string,any>,selected:Set<string>){
    const output:Record<string,any>={event:'message.received',sessionId:data.sessionId,chatId:data.chatId};
    for(const field of ['contactName','phone','message','messageType','receivedAt','contactProfile','messageDetails','assignment'])if(selected.has(field))output[field]=data[field];
    return output;
  }
  private isMedia(type:string){return ['image','video','audio','ptt','voice','document','sticker'].includes(String(type).toLowerCase());}
  private fallbackFor(type:string){return ({image:'Imagem recebida',video:'Vídeo recebido',audio:'Áudio recebido',ptt:'Mensagem de voz recebida',voice:'Mensagem de voz recebida',document:'Documento recebido',sticker:'Figurinha recebida'} as Record<string,string>)[String(type).toLowerCase()]||'Nova mensagem recebida.';}
}
