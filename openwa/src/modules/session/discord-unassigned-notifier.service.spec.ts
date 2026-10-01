import { DiscordUnassignedNotifier } from './discord-unassigned-notifier.service';

const incoming={id:'m1',from:'5511999999999@c.us',to:'session',chatId:'5511999999999@c.us',body:'Preciso de ajuda',type:'chat',timestamp:1_800_000_000,fromMe:false,isGroup:false,kind:'contact'} as never;

describe('DiscordUnassignedNotifier',()=>{
  const hook={id:'h1',destination_type:'discord',url:'https://discord.com/api/webhooks/id/token',only_unassigned:true,include_groups:false,include_text:true,include_media:true,sender_name:'Atende',title:'Nova mensagem',color:'#0b917a',fields:['contactName','phone','message','receivedAt']};
  beforeEach(()=>{global.fetch=jest.fn().mockResolvedValue({ok:true,status:204}) as never;});

  it('does not notify when the conversation has an assignee',async()=>{
    const query=jest.fn().mockResolvedValueOnce([hook]).mockResolvedValueOnce([{assigned:true}]);
    const service=new DiscordUnassignedNotifier({query} as never);
    await expect(service.notify('session',incoming)).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('notifies Discord when the incoming conversation is unassigned',async()=>{
    const query=jest.fn().mockResolvedValueOnce([hook]).mockResolvedValueOnce([]).mockResolvedValueOnce([{name:'Cliente',phone:'5511999999999'}]);
    const service=new DiscordUnassignedNotifier({query} as never);
    await expect(service.notify('session',incoming)).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/discord\.com\/api\/webhooks\//),expect.objectContaining({method:'POST'}));
  });

  it('includes the full contact profile and message details only when selected for JSON',async()=>{
    const jsonHook={...hook,destination_type:'json',only_unassigned:false,fields:['contactProfile','messageDetails','assignment']};
    const query=jest.fn().mockResolvedValueOnce([jsonHook]).mockResolvedValueOnce([{assignee_id:'agent-1',assignee_name:'Wesley'}])
      .mockResolvedValueOnce([{name:'Cliente',phone:'5511999999999',data:{name:'Cliente',custom:[{id:'1',label:'Vencimento',value:'10/10'}]}}]);
    const service=new DiscordUnassignedNotifier({query} as never);
    await expect(service.notify('session',incoming)).resolves.toBe(true);
    const request=(global.fetch as jest.Mock).mock.calls[0][1];
    const body=JSON.parse(request.body);
    expect(body.contactProfile.custom[0].value).toBe('10/10');
    expect(body.assignment).toEqual({id:'agent-1',name:'Wesley'});
    expect(body.messageDetails).toMatchObject({id:'m1',type:'chat',body:'Preciso de ajuda'});
  });
});
