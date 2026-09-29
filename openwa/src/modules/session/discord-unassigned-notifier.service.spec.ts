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
});
