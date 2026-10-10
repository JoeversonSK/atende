import { ConflictException } from '@nestjs/common';
import { FlowSheetService } from './flow-sheet.service';

describe('planilha acionada pelo fluxo', () => {
  const step = {id:'bloco',type:'sheet',spreadsheetId:'planilha123456789012345',sheetRange:'Clientes!A1:C100',
    lookupColumn:'CNPJ',lookupValue:'{{cnpj}}',sheetMappings:[{column:'Quem gerou',value:'{{atendente}}'}]};
  it('busca o bloco salvo e escreve o atendente, nunca valores enviados pelo cliente', async () => {
    const db={query:jest.fn().mockResolvedValueOnce([{steps:[step]}]).mockResolvedValueOnce([{id:'operador',display_name:'Ana'}])
      .mockResolvedValueOnce([{data:{name:'Cliente',cnpjs:['12345678000190']}}]).mockResolvedValueOnce([{assignee_name:'Bruno'}])};
    const sheets={updateFlowRow:jest.fn().mockResolvedValue({success:true})};
    const service=new FlowSheetService(db as never,{} as never,sheets as never);
    await service.execute('sessao','cliente@c.us','fluxo','bloco','operador');
    expect(sheets.updateFlowRow).toHaveBeenCalledWith(expect.objectContaining({sheetMappings:[{column:'Quem gerou',value:'Ana'}]}),'12345678000190');
  });
  it('recusa executar etapa removida ou desativada', async () => {
    const db={query:jest.fn().mockResolvedValueOnce([])};
    const sheets={updateFlowRow:jest.fn()};
    const service=new FlowSheetService(db as never,{} as never,sheets as never);
    await expect(service.execute('sessao','cliente@c.us','fluxo','bloco','operador')).rejects.toBeInstanceOf(ConflictException);
    expect(sheets.updateFlowRow).not.toHaveBeenCalled();
  });
  it('finaliza somente CNPJs escolhidos e valida que pertencem ao contato', async () => {
    const db={query:jest.fn().mockResolvedValueOnce([{steps:[{id:'finalizar',type:'monthly-complete'}]}])
      .mockResolvedValueOnce([{id:'operador',display_name:'Ana'}])
      .mockResolvedValueOnce([{data:{cnpjs:['12.345.678/0001-90','98.765.432/0001-10']}}])};
    const sheets={completeMonthlyFiles:jest.fn().mockResolvedValue({success:true})};
    const service=new FlowSheetService(db as never,{} as never,sheets as never);
    await service.execute('sessao','cliente@c.us','fluxo','finalizar','operador',['98765432000110']);
    expect(sheets.completeMonthlyFiles).toHaveBeenCalledWith('sessao',['98765432000110'],'Ana');
  });
  it('usa os CNPJs do cadastro telefônico ao finalizar pelo chat @lid', async () => {
    const db={query:jest.fn().mockResolvedValueOnce([{steps:[{id:'finalizar',type:'monthly-complete'}]}])
      .mockResolvedValueOnce([{id:'operador',display_name:'Ana'}])
      .mockResolvedValueOnce([{data:{phone:'5511999999999',cnpjs:[]}}])
      .mockResolvedValueOnce([{chatId:'5511999999999@c.us',data:{cnpjs:['12345678000190']},revision:2}])};
    const sheets={completeMonthlyFiles:jest.fn().mockResolvedValue({success:true})};
    const service=new FlowSheetService(db as never,{} as never,sheets as never);
    await service.execute('sessao','275316094312504@lid','fluxo','finalizar','operador');
    expect(sheets.completeMonthlyFiles).toHaveBeenCalledWith('sessao',['12345678000190'],'Ana');
  });
  it('impede selecionar CNPJ que não está vinculado ao contato', async () => {
    const db={query:jest.fn().mockResolvedValueOnce([{steps:[{id:'finalizar',type:'monthly-complete'}]}])
      .mockResolvedValueOnce([{id:'operador',display_name:'Ana'}])
      .mockResolvedValueOnce([{data:{cnpjs:['12345678000190']}}])};
    const sheets={completeMonthlyFiles:jest.fn()};
    const service=new FlowSheetService(db as never,{} as never,sheets as never);
    await expect(service.execute('sessao','cliente@c.us','fluxo','finalizar','operador',['98765432000110']))
      .rejects.toThrow('vinculados');
    expect(sheets.completeMonthlyFiles).not.toHaveBeenCalled();
  });
});
