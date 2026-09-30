import { ConflictException } from '@nestjs/common';
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
});
