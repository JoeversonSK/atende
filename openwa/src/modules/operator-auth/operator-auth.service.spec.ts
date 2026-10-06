import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OperatorAuthService } from './operator-auth.service';
import { postWebhookPayload } from '../webhook/utils/deliver-once';
import { SsrfBlockedError } from '../../common/security/ssrf-guard';

jest.mock('../webhook/utils/deliver-once', () => ({ postWebhookPayload: jest.fn() }));

describe('OperatorAuthService unassigned notifications', () => {
  const first='11111111-1111-4111-8111-111111111111';
  const second='22222222-2222-4222-8222-222222222222';
  const outsider='33333333-3333-4333-8333-333333333333';

  it('testa o webhook pelo transporte compartilhado e oculta endereços bloqueados', async () => {
    const query = jest.fn().mockResolvedValue([{destination_type:'json',url:'https://exemplo.com/webhook'}]);
    const service = new OperatorAuthService({query} as never);
    jest.spyOn(service,'requireAdmin').mockResolvedValue({id:first,username:'admin',displayName:'Admin'});
    jest.spyOn(service as never,'ensureAccessSchema').mockResolvedValue(undefined);
    const post = postWebhookPayload as jest.MockedFunction<typeof postWebhookPayload>;
    post.mockResolvedValueOnce({status:204,statusText:'No Content'});
    await expect(service.testNotificationWebhook('token','hook-1')).resolves.toEqual({success:true,statusCode:204});
    expect(post).toHaveBeenCalledWith('https://exemplo.com/webhook',expect.stringContaining('"event":"test"'),{'Content-Type':'application/json'},8000);
    post.mockRejectedValueOnce(new SsrfBlockedError('10.0.0.5 bloqueado'));
    const result = await service.testNotificationWebhook('token','hook-1');
    expect(result).toMatchObject({success:false});
    expect(result.error).not.toContain('10.0.0.5');
  });

  it('salva e consulta o áudio somente na conta autenticada', async () => {
    const data = Buffer.from('audio de teste');
    const query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{filename:'aviso.mp3',mimetype:'audio/mpeg',data}]);
    const service = new OperatorAuthService({query} as never);
    jest.spyOn(service,'me').mockResolvedValue({id:first,username:'ana',displayName:'Ana'});
    const input = {filename:'aviso.mp3',mimetype:'audio/mpeg',base64:data.toString('base64')};
    expect(await service.saveNotificationSound('token',input)).toEqual(input);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('operator_notification_sounds'),[first,input.filename,input.mimetype,data]);
    expect(await service.notificationSound('token')).toEqual(input);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id=$1'),[first]);
  });

  it('recusa áudio acima do limite antes de gravar', async () => {
    const query = jest.fn();
    const service = new OperatorAuthService({query} as never);
    jest.spyOn(service,'me').mockResolvedValue({id:first,username:'ana',displayName:'Ana'});
    await expect(service.saveNotificationSound('token',{filename:'grande.mp3',mimetype:'audio/mpeg',base64:Buffer.alloc(2*1024*1024+1).toString('base64')})).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('notifies every selected user until the conversation is assigned', async () => {
    const query=jest.fn().mockImplementation((sql:string) => {
      if(sql.includes('conversation_assignments')) return Promise.resolve([]);
      if(sql.includes('unassigned_user_ids')) return Promise.resolve([{unassigned_user_ids:[first,second]}]);
      return Promise.resolve([]);
    });
    const service=new OperatorAuthService({query} as never);
    jest.spyOn(service,'me').mockImplementation(async token => ({id:token,username:'test',displayName:'Test'}));
    expect(await service.notification(first,'session','chat@c.us')).toEqual({allowed:true});
    expect(await service.notification(second,'session','chat@c.us')).toEqual({allowed:true});
    expect(await service.notification(outsider,'session','chat@c.us')).toEqual({allowed:false});
    query.mockImplementation((sql:string) => sql.includes('conversation_assignments') ? Promise.resolve([{assignee_id:second}]) : Promise.resolve([{unassigned_user_ids:[first,second]}]));
    expect(await service.notification(first,'session','chat@c.us')).toEqual({allowed:false});
    expect(await service.notification(second,'session','chat@c.us')).toEqual({allowed:true});
  });

  it('rejects inactive users when saving notification recipients', async () => {
    const query=jest.fn().mockImplementation((sql:string) => sql.includes('SELECT id FROM openwa.operator_users') ? Promise.resolve([{id:first}]) : Promise.resolve([]));
    const service=new OperatorAuthService({transaction: (work:(db:unknown)=>Promise<unknown>)=>work({query})} as never);
    jest.spyOn(service,'requireAdmin').mockResolvedValue({id:first,username:'admin',displayName:'Admin'});
    await expect(service.setRecipients('token',[first,second])).rejects.toBeInstanceOf(ConflictException);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE openwa.operator_settings'),expect.anything());
  });

  it('toggles one recipient without overwriting the others', async () => {
    let saved=[first];
    const query=jest.fn().mockImplementation((sql:string,params?:unknown[]) => {
      if(sql.includes('SELECT id FROM openwa.operator_users')) return Promise.resolve([{id:second}]);
      if(sql.includes('SELECT unassigned_user_ids')) return Promise.resolve([{unassigned_user_ids:saved}]);
      if(sql.includes('UPDATE openwa.operator_settings')) { saved=params?.[0] as string[]; return Promise.resolve([]); }
      return Promise.resolve([]);
    });
    const service=new OperatorAuthService({transaction: (work:(db:unknown)=>Promise<unknown>)=>work({query})} as never);
    jest.spyOn(service,'requireAdmin').mockResolvedValue({id:first,username:'admin',displayName:'Admin'});
    expect(await service.setRecipientEnabled('token',second,true)).toEqual({unassignedUserIds:[first,second]});
    expect(await service.setRecipientEnabled('token',first,false)).toEqual({unassignedUserIds:[second]});
  });

    it('registra pausa de 15 minutos somente para a própria conta', async () => {
      const query=jest.fn().mockResolvedValue([]);
      const transaction=jest.fn(async (work:(db:{query:typeof query})=>Promise<unknown>)=>work({query}));
      const service=new OperatorAuthService({query,transaction} as never);
      jest.spyOn(service,'me').mockResolvedValueOnce({id:first,username:'ana',displayName:'Ana'})
        .mockResolvedValueOnce({id:first,username:'ana',displayName:'Ana',activityStatus:'break'});
      expect(await service.setActivity('token','break')).toMatchObject({activityStatus:'break'});
      expect(query).toHaveBeenCalledWith(expect.stringContaining("INTERVAL '15 minutes'"),[first,'break','']);
  });

  it('exige uma descrição para outra atividade', async () => {
    const query=jest.fn();
    const service=new OperatorAuthService({query} as never);
    jest.spyOn(service,'me').mockResolvedValue({id:first,username:'ana',displayName:'Ana'});
    await expect(service.setActivity('token','custom','  ')).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('silencia notificações durante a pausa', async () => {
    const query=jest.fn();
    const service=new OperatorAuthService({query} as never);
    jest.spyOn(service,'me').mockResolvedValue({id:first,username:'ana',displayName:'Ana',activityStatus:'break'});
    expect(await service.notification('token','session','chat@c.us')).toEqual({allowed:false});
    expect(query).not.toHaveBeenCalled();
  });

  it('recusa nova atribuição durante uma atividade e permite após o fim da pausa', async () => {
    const query=jest.fn().mockResolvedValueOnce([{id:first,displayName:'Ana',status:'break',until:new Date(Date.now()+60000)}])
      .mockResolvedValueOnce([{id:first,displayName:'Ana',status:'break',until:new Date(Date.now()-60000)}]);
    const service=new OperatorAuthService({query} as never);
    jest.spyOn(service,'requirePermission').mockResolvedValue({id:first,username:'ana',displayName:'Ana'});
    await expect(service.assignmentTarget('token',first)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assignmentTarget('token',first)).resolves.toMatchObject({id:first});
  });

  it('registra início e fim de atendimento externo sem criar conversa', async () => {
    const startedAt=new Date('2026-10-02T12:00:00Z');
    const endedAt=new Date('2026-10-02T12:30:00Z');
    const query=jest.fn().mockImplementation((sql:string) => {
      if(sql.includes('SELECT activity_status')) return Promise.resolve([{status:'available',until:null}]);
      if(sql.includes('INSERT INTO openwa.operator_onsite_visits')) return Promise.resolve([{id:'visit-1',clientName:'Cliente A',startedAt,endedAt:null}]);
      if(sql.includes('UPDATE openwa.operator_onsite_visits')) return Promise.resolve([{id:'visit-1',clientName:'Cliente A',startedAt,endedAt,durationSeconds:1800}]);
      return Promise.resolve([]);
    });
    const transaction=jest.fn(async (work:(db:{query:typeof query})=>Promise<unknown>)=>work({query}));
    const service=new OperatorAuthService({query,transaction} as never);
    jest.spyOn(service,'connectionContext').mockResolvedValue({user:{id:first,username:'ana',displayName:'Ana'},sessionId:'session',expiresAt:new Date()});
    jest.spyOn(service,'me').mockResolvedValue({id:first,username:'ana',displayName:'Ana'});
    expect(await service.startOnsite('token',' Cliente A ')).toMatchObject({clientName:'Cliente A',endedAt:null});
    expect(await service.finishOnsite('token','visit-1')).toMatchObject({durationSeconds:1800});
    expect(query).toHaveBeenCalledWith(expect.stringContaining("activity_status='onsite'"),[first,'Cliente A']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("activity_status='available'"),[first]);
  });

  it('não permite mudar a atividade durante um atendimento externo', async () => {
    const query=jest.fn().mockImplementation((sql:string) => Promise.resolve(sql.includes('SELECT id FROM openwa.operator_onsite_visits')?[{id:'visit-1'}]:[]));
    const service=new OperatorAuthService({transaction:(work:(db:unknown)=>Promise<unknown>)=>work({query})} as never);
    jest.spyOn(service,'me').mockResolvedValue({id:first,username:'ana',displayName:'Ana'});
    await expect(service.setActivity('token','available')).rejects.toBeInstanceOf(ConflictException);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE openwa.operator_users'),expect.anything());
  });
});

describe('OperatorAuthService cadastro da equipe', () => {
  const admin = {id:'11111111-1111-4111-8111-111111111111',username:'admin',displayName:'Admin',role:'admin'};

  it('permite somente o primeiro cadastro público e cria um administrador', async () => {
    let users = 0;
    const query = jest.fn().mockImplementation((sql:string,params?:unknown[]) => {
      if(sql.includes('FROM openwa.operator_users LIMIT 1')) return Promise.resolve(users ? [{id:'existing'}] : []);
      if(sql.includes('INSERT INTO openwa.operator_users')) { users++; return Promise.resolve([]); }
      return Promise.resolve([]);
    });
    const service = new OperatorAuthService({query,transaction:(work:(db:unknown)=>Promise<unknown>)=>work({query})} as never);
    jest.spyOn(service as never,'ensureAccessSchema').mockResolvedValue(undefined);
    jest.spyOn(service as never,'issue').mockResolvedValue({user:admin,token:'token-de-teste'});
    await expect(service.register(' Admin ','Administrador','senha-segura')).resolves.toMatchObject({user:admin});
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO openwa.operator_users'),expect.arrayContaining(['admin','Administrador','admin']));
    await expect(service.register('outra','Outra Pessoa','senha-segura')).rejects.toBeInstanceOf(ForbiddenException);
    expect(users).toBe(1);
  });

  it('mostra o cadastro inicial como fechado quando já existe uma conta', async () => {
    const query = jest.fn().mockResolvedValue([{hasUsers:true}]);
    const service = new OperatorAuthService({query} as never);
    expect(await service.registrationStatus()).toEqual({registrationOpen:false});
  });

  it('exige administrador para criar outra conta e não cria sessão automaticamente', async () => {
    const user = {id:'22222222-2222-4222-8222-222222222222',username:'agente',displayName:'Agente',role:'agent',active:true};
    const query = jest.fn().mockImplementation((sql:string) => {
      if(sql.includes('WHERE username=$1')) return Promise.resolve([]);
      if(sql.includes('WITH created AS')) return Promise.resolve([user]);
      return Promise.resolve([]);
    });
    const transaction = jest.fn((work:(db:unknown)=>Promise<unknown>)=>work({query}));
    const service = new OperatorAuthService({query,transaction} as never);
    const requireAdmin = jest.spyOn(service,'requireAdmin').mockRejectedValueOnce(new ForbiddenException('Apenas administradores podem gerenciar a equipe.')).mockResolvedValue(admin);
    await expect(service.createUser('agente-token','agente','Agente','senha-segura')).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
    expect(await service.createUser('admin-token','agente','Agente','senha-segura')).toEqual(user);
    expect(requireAdmin).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WITH created AS'),expect.arrayContaining(['agente','Agente']));
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('operator_sessions'),expect.anything());
  });
});
