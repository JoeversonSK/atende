import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OperatorAuthService } from './operator-auth.service';

describe('OperatorAuthService unassigned notifications', () => {
  const first='11111111-1111-4111-8111-111111111111';
  const second='22222222-2222-4222-8222-222222222222';
  const outsider='33333333-3333-4333-8333-333333333333';

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
    const service=new OperatorAuthService({query} as never);
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
});
