import { BadRequestException, Body, ConflictException, Controller, Headers, Injectable, Param, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../auth/decorators/auth.decorators';
import { OperatorAuthService, ConversationFlowStep } from './operator-auth.service';
import { SheetAutomationService } from './sheet-automation.controller';
import { extractCnpjs } from './sheet-automation.controller';
import { linkedPhoneCnpjProfile } from './contact-profile.controller';

@Injectable()
export class FlowSheetService {
  constructor(
    @InjectDataSource('data') private readonly db: DataSource,
    private readonly auth: OperatorAuthService,
    private readonly sheets: SheetAutomationService,
  ) {}

  async executeWithToken(token: string, session: string, chat: string, flowId: string, stepId: string, selectedCnpjs?: string[]) {
    const user=await this.auth.requirePermission(token,'canSend');
    const context=await this.auth.connectionContext(token);
    if(context.sessionId!==session) throw new BadRequestException('Sessão inválida.');
    return this.execute(session,chat,flowId,stepId,user.id,selectedCnpjs);
  }

  async execute(session: string, chat: string, flowId: string, stepId: string, actorId: string, selectedCnpjs?: string[]) {
    if(!session||!chat||session.length>255||chat.length>255||!flowId||!stepId)
      throw new BadRequestException('Fluxo ou contato inválido.');
    const [flow]=await this.db.query('SELECT steps FROM openwa.conversation_flows WHERE id=$1 AND active=true',[flowId]);
    const step:ConversationFlowStep|undefined=(Array.isArray(flow?.steps)?flow.steps:[]).find((item:ConversationFlowStep)=>item.id===stepId);
    if(!step||!['sheet','monthly-complete'].includes(step.type||''))
      throw new ConflictException('Este bloco de planilha não está mais ativo no fluxo.');
    const [actor]=await this.db.query('SELECT id,display_name FROM openwa.operator_users WHERE id=$1 AND active=true',[actorId]);
    if(!actor) throw new ConflictException('O atendente que iniciou o fluxo não está mais ativo.');
    const [profile]=await this.db.query('SELECT data FROM openwa.contact_profiles WHERE session_id=$1 AND chat_id=$2',[session,chat]);
    const ownData=profile?.data||{};
    const phoneProfile=await linkedPhoneCnpjProfile(this.db,session,chat,ownData);
    const data=phoneProfile?{...ownData,cnpjs:phoneProfile.data.cnpjs||[]}:ownData;
    if(step.type==='monthly-complete'){
      const linked=[...(Array.isArray(data.cnpjs)?data.cnpjs:[]),data.document,
        ...(Array.isArray(data.custom)?data.custom:[]).filter((field:{label?:string})=>
          String(field.label||'').trim().toLocaleLowerCase('pt-BR')==='cnpj').map((field:{value?:string})=>field.value)];
      const available=[...new Set(linked.flatMap(extractCnpjs))];
      if(!available.length) throw new ConflictException('Este contato não possui CNPJ vinculado.');
      if(available.length>20) throw new BadRequestException('O contato possui mais de 20 CNPJs. Revise o cadastro.');
      const chosen=selectedCnpjs===undefined?available:
        Array.isArray(selectedCnpjs)?[...new Set(selectedCnpjs.flatMap(extractCnpjs))]:[];
      if(!chosen.length||chosen.some(cnpj=>!available.includes(cnpj))||
        (selectedCnpjs!==undefined&&chosen.length!==selectedCnpjs.length))
        throw new BadRequestException('Selecione apenas CNPJs vinculados a este contato.');
      const generatedBy=String(actor.display_name||'').trim().split(/\s+/)[0]||String(actor.display_name||'').trim();
      return this.sheets.completeMonthlyFiles(session,chosen,generatedBy);
    }
    if(!step.spreadsheetId||!step.sheetRange||!step.lookupColumn||!step.lookupValue||!step.sheetMappings?.length)
      throw new ConflictException('A configuração da planilha está incompleta.');
    const [assignment]=await this.db.query('SELECT assignee_name FROM openwa.conversation_assignments WHERE session_id=$1 AND chat_id=$2',[session,chat]);
    const now=new Date();
    const date=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'}).format(now);
    const time=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(now);
    const hour=Number(new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(now));
    const custom=Array.isArray(data.custom)?data.custom:[];
    const values:Record<string,string>={
      atendente:String(actor.display_name||''),id_atendente:String(actor.id||''),responsavel:String(assignment?.assignee_name||''),
      cliente:String(data.name||''),nome:String(data.name||''),telefone:String(data.phone||chat.split('@')[0]||''),
      email:String(data.email||''),empresa:String(data.company||''),documento:String(data.document||''),
      cpf_cnpj:String(data.document||''),cnpj:String((Array.isArray(data.cnpjs)?data.cnpjs:[])[0]||data.document||''),
      endereco:String(data.address||''),etiquetas:Array.isArray(data.tags)?data.tags.join(', '):'',
      status:String(data.status||''),tipo_atendimento:String(data.serviceType||''),prioridade:String(data.priority||''),
      campos_personalizados:custom.filter((field:{label?:string;value?:string})=>field.label&&field.value).map((field:{label:string;value:string})=>`${field.label}: ${field.value}`).join('; '),
      id_contato:chat,data:date,hora:time,saudacao:hour<12?'Bom dia':hour<18?'Boa tarde':'Boa noite',
    };
    const fill=(template:string)=>String(template).replace(/\{\{([^{}]+)\}\}/g,(_match,name:string)=>{
      if(name.startsWith('custom:')) return String(custom.find((field:{label?:string})=>field.label===name.slice(7))?.value||'');
      if(!Object.hasOwn(values,name)) throw new BadRequestException(`Campo automático desconhecido: {{${name}}}.`);
      return values[name];
    });
    const lookupValue=fill(step.lookupValue).trim();
    if(!lookupValue) throw new ConflictException('O campo de busca está vazio neste contato.');
    const sheetMappings=step.sheetMappings.map(mapping=>({column:mapping.column,value:fill(mapping.value)}));
    return this.sheets.updateFlowRow({spreadsheetId:step.spreadsheetId,sheetRange:step.sheetRange,lookupColumn:step.lookupColumn,sheetMappings},lookupValue);
  }
}

@Public()
@Controller('operator-auth/contacts')
export class FlowSheetController {
  constructor(private readonly sheets: FlowSheetService) {}
  @Post(':session/:chat/flow-sheet/:flowId/:stepId')
  execute(@Headers('x-atende-token') token='',@Param('session') session:string,@Param('chat') chat:string,
    @Param('flowId') flowId:string,@Param('stepId') stepId:string,@Body() body?:{selectedCnpjs?:string[]}) {
    return this.sheets.executeWithToken(token,session,chat,flowId,stepId,body?.selectedCnpjs);
  }
}
