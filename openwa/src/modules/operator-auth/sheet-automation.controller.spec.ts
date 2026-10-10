import { ConflictException } from '@nestjs/common';
import { SheetAutomationService, extractCnpjs, monthlyCallStage, normalizeCnpj, normalizeCompanyName, previousMonthSheet } from './sheet-automation.controller';

describe('SheetAutomationService mapping and safety', () => {
  const service = new SheetAutomationService({} as never, {} as never, {} as never, {} as never);
  const methods = service as unknown as {
    normalize(input: unknown): any;
    prepare(row: Record<string, string>, rule: any): any;
    render(template: string, row: Record<string, string>): string;
  };
  const draft = {
    name: 'Vencimentos', spreadsheetId: '1A234567890abcdefghijklmnop', range: 'A1:Z201',
    phoneColumn: 'Telefone', mappings: [
      { column: 'Primeiro nome', target: 'firstName' },
      { column: 'Etiquetas', target: 'tags' },
      { column: 'Vencimento', target: 'custom:Vencimento' },
    ], messageTemplate: 'Olá, {{Primeiro nome}}! Vence em {{Vencimento}}.',
    sendMessage: true, active: false, intervalMinutes: 60,
  };

  it('accepts a private Sheets link and maps tags plus custom fields', () => {
    const rule = methods.normalize({ ...draft, spreadsheetId: `https://docs.google.com/spreadsheets/d/${draft.spreadsheetId}/edit` });
    expect(rule.spreadsheetId).toBe(draft.spreadsheetId);
    const row = { Telefone: '11999999999', 'Primeiro nome': 'Maria', Etiquetas: 'Cliente, Vence hoje', Vencimento: '10/10/2026' };
    expect(methods.prepare(row, rule)).toEqual({
      importRow: { firstName: 'Maria', lastName: '', phone: '11999999999', tags: ['Cliente', 'Vence hoje'] },
      profile: { 'custom:Vencimento': '10/10/2026' },
    });
    expect(methods.render(rule.messageTemplate, row)).toBe('Olá, Maria! Vence em 10/10/2026.');
  });

  it('aceita campos adicionais no mapeamento manual e valida os valores controlados', () => {
    const rule = methods.normalize({ ...draft, mappings: [
      { column: 'Prioridade', target: 'priority' },
      { column: 'Campanhas', target: 'campaigns' },
      { column: 'CNPJ', target: 'document' },
    ] });
    expect(methods.prepare({ Telefone: '11999999999', Prioridade: 'high', Campanhas: 'Mensal, Retorno', CNPJ: '48.102.421/0001-50' }, rule).profile)
      .toEqual({ priority: 'high', campaigns: 'Mensal, Retorno', document: '48.102.421/0001-50' });
    expect(() => methods.prepare({ Telefone: '11999999999', Prioridade: 'urgente' }, rule)).toThrow('Prioridade inválida');
  });

  it('rejects unbounded ranges and unknown profile destinations', () => {
    expect(() => methods.normalize({ ...draft, range: 'A1:Z9999' })).toThrow('até 1.000 contatos');
    expect(() => methods.normalize({ ...draft, mappings: [{ column: 'Segredo', target: 'password' }] })).toThrow('mapeamento');
  });

  it('salva a faixa de espera escolhida e usa 5–10 segundos como padrão', () => {
    expect(methods.normalize({ ...draft, sendPace: '1-5' }).sendPace).toBe('1-5');
    expect(methods.normalize(draft).sendPace).toBe('5-10');
  });

  it('rejects a message variable that has no matching sheet column', async () => {
    const auth = { requireAdmin: jest.fn().mockResolvedValue({}) };
    const checked = new SheetAutomationService({} as never, auth as never, {} as never, {} as never);
    jest.spyOn(checked as any, 'fetchSheet').mockResolvedValue({ headers: ['Telefone', 'Primeiro nome', 'Etiquetas', 'Vencimento'], rows: [] });
    await expect(checked.preview('admin-token', { ...draft, messageTemplate: 'Olá, {{Coluna ausente}}' }))
      .rejects.toThrow('não existe no cabeçalho');
  });
});

describe('atualização de linha por bloco de fluxo', () => {
  const step={spreadsheetId:'planilha123456789012345',sheetRange:'Clientes!A1:C100',lookupColumn:'CNPJ',
    sheetMappings:[{column:'Quem gerou',value:'Ana'}]};
  it('confere a linha e o valor anterior antes de escrever', async () => {
    const service=new SheetAutomationService({} as never,{} as never,{} as never,{} as never) as any;
    service.bridgeConfig=()=>({url:'https://script.google.com/macros/s/teste/exec',secret:'x'.repeat(32)});
    service.fetchSheet=jest.fn().mockResolvedValue({headers:['Empresa','CNPJ','Quem gerou'],rows:[{Empresa:'Cliente',CNPJ:'12.345.678/0001-90','Quem gerou':''}],rowNumbers:[2]});
    service.bridge=jest.fn().mockResolvedValue({ok:true});
    await service.updateFlowRow(step,'12345678000190');
    expect(service.bridge).toHaveBeenCalledWith({action:'update',spreadsheetId:step.spreadsheetId,
      keyCell:'Clientes!B2',expectedKey:'12.345.678/0001-90',
      changes:[{cell:'Clientes!C2',expectedValue:'',nextValue:'Ana'}]});
  });
  it('não escreve quando o mesmo CNPJ está em mais de uma linha', async () => {
    const service=new SheetAutomationService({} as never,{} as never,{} as never,{} as never) as any;
    service.bridgeConfig=()=>({url:'https://script.google.com/macros/s/teste/exec',secret:'x'.repeat(32)});
    service.fetchSheet=jest.fn().mockResolvedValue({headers:['CNPJ','Quem gerou'],rows:[
      {CNPJ:'12345678000190','Quem gerou':''},{CNPJ:'12.345.678/0001-90','Quem gerou':''}],rowNumbers:[2,3]});
    service.bridge=jest.fn();
    await expect(service.updateFlowRow(step,'12345678000190')).rejects.toBeInstanceOf(ConflictException);
    expect(service.bridge).not.toHaveBeenCalled();
  });
});

describe('finalização dos arquivos mensais por fluxo', () => {
  it('marca SPED e Vendas em todas as linhas escolhidas sem rebaixar valores existentes', async () => {
    const db={query:jest.fn().mockResolvedValue([{spreadsheet_id:'planilha123456789012345',sheet_range:'MES_ANTERIOR!A1:M1001'}])};
    const service=new SheetAutomationService(db as never,{} as never,{} as never,{} as never) as any;
    service.bridgeConfig=()=>({url:'https://script.google.com/macros/s/teste/exec',secret:'x'.repeat(32)});
    service.fetchSheet=jest.fn().mockResolvedValue({headers:['EMPRESA','CNPJ','SPED','Vendas','Quem gerou'],rows:[
      {EMPRESA:'A',CNPJ:'12.345.678/0001-90',SPED:'',Vendas:'','Quem gerou':''},
      {EMPRESA:'B',CNPJ:'98.765.432/0001-10',SPED:'Gerado e enviado',Vendas:'','Quem gerou':''},
    ],rowNumbers:[2,3]});
    service.bridge=jest.fn().mockResolvedValue({ok:true});
    const result=await service.completeMonthlyFiles('sessao',['12345678000190','98765432000110'],'Gabryel - Analista de Suporte');
    expect(result).toEqual({success:true,matched:2,updated:5});
    expect(service.bridge).toHaveBeenCalledWith(expect.objectContaining({action:'updateMany',keys:expect.arrayContaining([
      expect.objectContaining({expected:'12.345.678/0001-90'}),expect.objectContaining({expected:'98.765.432/0001-10'})]),
      changes:expect.arrayContaining([
        expect.objectContaining({nextValue:'Gerado'}),expect.objectContaining({nextValue:'Geradas'})])}));
    expect(service.bridge.mock.calls[0][0].changes).toHaveLength(5);
    expect(service.bridge.mock.calls[0][0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({nextValue:'Gabryel'}),
    ]));
  });
  it('não escreve se algum CNPJ escolhido não estiver na aba mensal', async () => {
    const db={query:jest.fn().mockResolvedValue([{spreadsheet_id:'planilha123456789012345',sheet_range:'MES_ANTERIOR!A1:M1001'}])};
    const service=new SheetAutomationService(db as never,{} as never,{} as never,{} as never) as any;
    service.bridgeConfig=()=>({url:'https://script.google.com/macros/s/teste/exec',secret:'x'.repeat(32)});
    service.fetchSheet=jest.fn().mockResolvedValue({headers:['CNPJ','SPED','Vendas','Quem gerou'],rows:[{CNPJ:'12345678000190',SPED:'',Vendas:'','Quem gerou':''}],rowNumbers:[2]});
    service.bridge=jest.fn();
    await expect(service.completeMonthlyFiles('sessao',['12345678000190','98765432000110'],'Ana')).rejects.toThrow('não consta');
    expect(service.bridge).not.toHaveBeenCalled();
  });
});

describe('Ponte privada do Apps Script', () => {
  const url = 'https://script.google.com/macros/s/abcDEF123456/exec';
  const secret = 'segredo-com-mais-de-trinta-e-dois-caracteres';
  it('lê a planilha pela ponte sem usar a conta de serviço', async () => {
    const oldUrl = process.env.GOOGLE_APPS_SCRIPT_URL, oldSecret = process.env.GOOGLE_APPS_SCRIPT_SECRET;
    const originalFetch = global.fetch;
    process.env.GOOGLE_APPS_SCRIPT_URL = url;
    process.env.GOOGLE_APPS_SCRIPT_SECRET = secret;
    const request = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, values: [['CNPJ', 'Chamado'], ['48.102.421/0001-50', '']] }) });
    global.fetch = request;
    try {
      const service = new SheetAutomationService({} as never, {} as never, {} as never, {} as never) as any;
      const result = await service.fetchSheet({ spreadsheetId: 'abcDEF12345678901234567890', range: 'Controle!A1:B2' });
      expect(result).toMatchObject({ headers: ['CNPJ', 'Chamado'], rowNumbers: [2] });
      expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ action: 'read', secret, range: 'Controle!A1:B2' });
    } finally {
      global.fetch = originalFetch;
      if (oldUrl === undefined) delete process.env.GOOGLE_APPS_SCRIPT_URL; else process.env.GOOGLE_APPS_SCRIPT_URL = oldUrl;
      if (oldSecret === undefined) delete process.env.GOOGLE_APPS_SCRIPT_SECRET; else process.env.GOOGLE_APPS_SCRIPT_SECRET = oldSecret;
    }
  });
});

describe('Arquivos mensais', () => {
  const draft = {
    name: 'Arquivos mensais', spreadsheetId: '1A234567890abcdefghijklmnop', mode: 'monthlyCall',
    range: 'MES_ANTERIOR!A1:M1001', detailsRange: 'Clientes!A1:F1001', phoneColumn: '', mappings: [],
    controlNameColumn: 'EMPRESA', controlCnpjColumn: 'CNPJ', detailsNameColumn: 'Cliente',
    legalNameColumn: 'Razão Social planilha Clientes Compufour', detailsCnpjColumn: 'CNPJ',
    calledColumn: 'Chamado', calledValue: 'Nós chamamos',
    messageTemplate: 'Olá, acesso remoto de {{Razões sociais}}?', sendMessage: true, active: false, intervalMinutes: 60, callRound: 1,
  };
  const control = { headers: ['EMPRESA', 'CNPJ', 'Chamado', 'SPED', 'Vendas'], rows: [
    { EMPRESA: 'TUTTI FRUTTI', CNPJ: '48.102.421/0001-50', Chamado: '', SPED: '', Vendas: '' },
    { EMPRESA: 'OXENTE TERERÊ', CNPJ: '45.499.311/0001-85', Chamado: '', SPED: '', Vendas: '' },
    { EMPRESA: 'ANNA X', CNPJ: '33.317.715/0001-21', Chamado: '', SPED: '', Vendas: '' },
  ], rowNumbers: [2, 3, 4] };
  const details = { headers: ['Cliente', 'Razão Social planilha Clientes Compufour'], rows: [
    { Cliente: 'Tutti Frutti', 'Razão Social planilha Clientes Compufour': 'CLAUDIO PIRES DE OLIVEIRA' },
    { Cliente: 'Oxente Terere', 'Razão Social planilha Clientes Compufour': 'RAYELE PEREIRA SILVA' },
    { Cliente: 'ANNA', 'Razão Social planilha Clientes Compufour': 'ANNA LTDA' },
  ], rowNumbers: [2, 3, 4] };
  it('salva um rascunho pausado sem credencial Google ou prévia', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const auth = { requireAdmin: jest.fn().mockResolvedValue(undefined), connectionContext: jest.fn().mockResolvedValue({ sessionId: 'sessao' }) };
    const service = new SheetAutomationService({ query } as never, auth as never, {} as never, {} as never);
    await expect(service.save('admin-token', { ...draft, active: true })).resolves.toHaveProperty('id');
    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO openwa.sheet_automations'));
    expect(insert?.[1][9]).toBe(false);
    expect(query.mock.calls.some(([sql, params]) => sql.includes('call_round=1,call_month=$1') && params[0] === previousMonthSheet())).toBe(true);
  });
  it('reinicia o histórico ao trocar a planilha de uma regra pausada', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT mode,active,spreadsheet_id')
      ? [{ mode: 'monthlyCall', active: false, spreadsheet_id: '1A234567890abcdefghijklmnop' }]
      : sql.includes('UPDATE openwa.sheet_automations SET name=') ? [{ id: 'regra' }] : []);
    const auth = { requireAdmin: jest.fn().mockResolvedValue(undefined), connectionContext: jest.fn().mockResolvedValue({ sessionId: 'sessao' }) };
    const service = new SheetAutomationService({ query } as never, auth as never, {} as never, {} as never);
    await service.save('admin-token', { ...draft, spreadsheetId: '1B234567890abcdefghijklmnop' }, 'regra');
    expect(query).toHaveBeenCalledWith('DELETE FROM openwa.sheet_automation_rows WHERE automation_id=$1', ['regra']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SET call_round=1,last_run_at=NULL'), ['regra', 'sessao']);
  });
  it('só avança a etapa quando está pausada e não há contatos aptos', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT mode,active,call_round')
      ? [{ mode: 'monthlyCall', active: false, call_round: 1 }]
      : sql.includes('COUNT(*)') ? [{ total: 0 }]
      : sql.includes('call_round=call_round+1') ? [{ callRound: 2 }] : []);
    const auth = { requireAdmin: jest.fn().mockResolvedValue(undefined), connectionContext: jest.fn().mockResolvedValue({ sessionId: 'sessao' }) };
    const service = new SheetAutomationService({ query } as never, auth as never, {} as never, {} as never);
    jest.spyOn(service, 'list').mockResolvedValue({ serviceAccountEmail: null, rules: [{ ...draft, id: 'regra' }] } as never);
    const preview = jest.spyOn(service, 'preview').mockResolvedValue({ eligible: 1, pendingMarkings: 0 } as never);
    await expect(service.advanceRound('token', 'regra')).rejects.toThrow('Ainda há contatos aptos');
    preview.mockResolvedValue({ eligible: 0, pendingMarkings: 0 } as never);
    await expect(service.advanceRound('token', 'regra')).resolves.toEqual({ callRound: 2 });
  });
  it('usa o mês anterior no fuso de São Paulo, inclusive na virada do ano', () => {
    expect(previousMonthSheet(new Date('2026-10-02T12:00:00Z'))).toBe('Setembro2026');
    expect(previousMonthSheet(new Date('2027-01-15T12:00:00Z'))).toBe('Dezembro2026');
  });
  it('extrai vários CNPJs do mesmo contato e normaliza nomes sem acentos', () => {
    expect(extractCnpjs('48.102.421/0001-50, 45499311000185')).toEqual(['48102421000150', '45499311000185']);
    expect(normalizeCompanyName('OXENTE TERERÊ ↻')).toBe('OXENTE TERERE');
  });
  it('mantém as três etapas separadas e para após a terceira chamada', () => {
    expect(['', 'Nós chamamos', 'Nós chamamos 2x', 'Nós chamamos 3x'].map(value => monthlyCallStage(value)))
      .toEqual([1, 2, 3, 0]);
  });
  it('encerra a regra quando não restam contatos aptos, sem enviar novamente', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never, {} as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue(details);
    jest.spyOn(service, 'prepareMonthlyCalls').mockResolvedValue({ calls: [], missing: 0, ambiguous: 0,
      alreadyCalled: 2, alreadyCalledContacts: new Set(), eligibleContactIds: new Set(), blockedContacts: new Set() });
    const result = await service.executeMonthlyCalls('sessao', 'regra', draft, control);
    expect(result).toMatchObject({ finished: true, needsReview: false, pending: 0, sent: 0 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('active=CASE WHEN $3 THEN false ELSE active END'),
      ['regra', null, true, 'completed']);
  });
  it('para com aviso de revisão se há linhas sem correspondência', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never, {} as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue(details);
    jest.spyOn(service, 'prepareMonthlyCalls').mockResolvedValue({ calls: [], missing: 1, ambiguous: 0,
      alreadyCalled: 0, alreadyCalledContacts: new Set(), eligibleContactIds: new Set(), blockedContacts: new Set() });
    const result = await service.executeMonthlyCalls('sessao', 'regra', draft, control);
    expect(result).toMatchObject({ finished: true, needsReview: true, pending: 0 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('active=CASE WHEN $3 THEN false ELSE active END'),
      ['regra', expect.stringContaining('itens para revisão'), true, 'review']);
  });
  it('na segunda chamada ignora quem já tem SPED ou Vendas e quem tem X no detalhe', async () => {
    const db = { query: jest.fn().mockResolvedValue([
      { chatId: '558899999999@c.us', data: { cnpjs: ['48102421000150', '45499311000185'], tags: ['Arquivos Mensais'] } },
      { chatId: '558888888888@c.us', data: { cnpjs: ['33317715000121'], tags: ['Arquivos Mensais'] } },
    ]) };
    const service = new SheetAutomationService(db as never, {} as never, {} as never, {} as never) as any;
    const rows = control.rows.map((row, index) => ({ ...row, EMPRESA: index === 2 ? 'ANNA' : row.EMPRESA,
      Chamado: 'Nós chamamos', SPED: index === 1 ? 'Gerado' : '', 'Detalhe do chamado': index === 2 ? 'Restrição Financeira X' : '' }));
    const prepared = await service.prepareMonthlyCalls({ ...draft, callRound: 2 }, { ...control, rows }, details, 'sessao');
    expect(prepared.calls).toHaveLength(1);
    expect(prepared.calls[0].cnpjs).toEqual(['48102421000150']);
    expect(prepared.blockedContacts.has('558888888888@c.us')).toBe(true);
  });
  it('na terceira chamada exige Nós chamamos 2x e continua sem gerar mais de uma mensagem por contato', async () => {
    const db = { query: jest.fn().mockResolvedValue([
      { chatId: '558899999999@c.us', data: { cnpjs: ['48102421000150', '45499311000185'], tags: ['arquivosmensais'] } },
    ]) };
    const service = new SheetAutomationService(db as never, {} as never, {} as never, {} as never) as any;
    const rows = control.rows.slice(0, 2).map(row => ({ ...row, Chamado: 'Nós chamamos 2x' }));
    const prepared = await service.prepareMonthlyCalls({ ...draft, callRound: 3 }, { ...control, rows }, details, 'sessao');
    expect(prepared.calls).toHaveLength(1);
    expect(prepared.calls[0].names).toHaveLength(2);
  });
  it('agrupa duas razões sociais do mesmo contato em uma mensagem e bloqueia X', async () => {
    const db = { query: jest.fn().mockResolvedValue([
      { chatId: '558899999999@c.us', data: { cnpjs: ['48102421000150', '45499311000185'], tags: ['Arquivos Mensais'] } },
      { chatId: '558888888888@c.us', data: { cnpjs: ['33317715000121'], tags: ['Arquivos Mensais'] } },
    ]) };
    const service = new SheetAutomationService(db as never, {} as never, {} as never, {} as never) as any;
    const prepared = await service.prepareMonthlyCalls(draft, control, details, 'sessao');
    expect(prepared.calls.filter((call: { chatId: string }) => !prepared.blockedContacts.has(call.chatId))).toHaveLength(1);
    expect(prepared.calls[0]).toMatchObject({ chatId: '558899999999@c.us', cnpjs: ['48102421000150', '45499311000185'],
      names: ['CLAUDIO PIRES DE OLIVEIRA', 'RAYELE PEREIRA SILVA'] });
    expect(prepared.issues).toContainEqual({ row: 4, cnpj: '33.317.715/0001-21', reason: 'Empresa bloqueada pelo marcador X; não chamar' });
    expect(service.monthlyMessage(draft, prepared.calls[0].names, prepared.calls[0].cnpjs))
      .toBe('Olá, acesso remoto de *CLAUDIO PIRES DE OLIVEIRA* e *RAYELE PEREIRA SILVA*?');
  });
  it('lê CNPJs separados e prepara uma mensagem para cada contato que compartilha o CNPJ', async () => {
    const db = { query: jest.fn().mockResolvedValue([
      { chatId: '558899999999@c.us', data: { cnpjs: ['48102421000150', '45499311000185'], tags: ['Arquivos Mensais'] } },
      { chatId: '558888888888@c.us', data: { cnpjs: ['45499311000185'], tags: ['Arquivos Mensais'] } },
    ]) };
    const service = new SheetAutomationService(db as never, {} as never, {} as never, {} as never) as any;
    const prepared = await service.prepareMonthlyCalls(draft,
      { ...control, rows: control.rows.slice(0, 2), rowNumbers: [2, 3] }, details, 'sessao');
    expect(prepared.ambiguous).toBe(0);
    expect(prepared.blockedContacts.size).toBe(0);
    expect(prepared.calls).toHaveLength(2);
    expect(prepared.calls.find((call: { chatId: string }) => call.chatId === '558899999999@c.us').cnpjs)
      .toEqual(['48102421000150', '45499311000185']);
    expect(prepared.calls.find((call: { chatId: string }) => call.chatId === '558888888888@c.us').cnpjs)
      .toEqual(['45499311000185']);
  });
  it('só considera contatos com CNPJ vinculado e etiqueta mensal, inclusive no nome antigo', async () => {
    const db = { query: jest.fn().mockResolvedValue([
      { chatId: '5511999999999@c.us', data: { cnpjs: ['48102421000150'], tags: [] } },
      { chatId: '5511888888888@c.us', data: { document: '45499311000185', tags: ['Arquivos Mensais'] } },
      { chatId: '5511777777777@c.us', data: { cnpjs: ['45499311000185'], tags: ['arquivosmensais'] } },
    ]) };
    const service = new SheetAutomationService(db as never, {} as never, {} as never, {} as never) as any;
    const prepared = await service.prepareMonthlyCalls(draft,
      { ...control, rows: control.rows.slice(0, 2), rowNumbers: [2, 3] }, details, 'sessao');
    expect(prepared.calls.map((call: { chatId: string }) => call.chatId)).toEqual(['5511777777777@c.us']);
    expect(prepared.excluded).toBe(1);
    expect(prepared.missing).toBe(0);
  });
  it('confere novamente etiqueta e CNPJs antes de enviar uma chamada preparada', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT data FROM openwa.contact_profiles')
      ? [{ data: { cnpjs: ['48102421000150'], tags: [] } }] : []);
    const sendText = jest.fn();
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never,
      { get: () => ({ sendText }) } as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue(details);
    jest.spyOn(service, 'prepareMonthlyCalls').mockResolvedValue({ calls: [{ chatId: '558899999999@c.us',
      cnpjs: ['48102421000150'], names: ['EMPRESA A'], rows: [{ cnpj: '48102421000150', rowNumber: 2 }] }],
    missing: 0, ambiguous: 0, alreadyCalled: 0, alreadyCalledContacts: new Set(),
    eligibleContactIds: new Set(), blockedContacts: new Set() });
    const result = await service.executeMonthlyCalls('sessao', 'regra', draft, control);
    expect(result).toMatchObject({ sent: 0, marked: 0, pending: 1 });
    expect(sendText).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO openwa.sheet_automation_rows'))).toBe(false);
  });
  it('envia aos dois contatos em ciclos distintos e só marca as linhas compartilhadas após ambos receberem', async () => {
    const statuses = new Map<string, string>();
    const query = jest.fn(async (sql: string, params: string[]) => {
      if (sql.includes('SELECT status,fingerprint')) return statuses.has(params[1]) ? [{ status: statuses.get(params[1]) }] : [];
      if (sql.includes('SELECT data FROM openwa.contact_profiles')) return [{ data: { cnpjs: ['48102421000150', '45499311000185'], tags: ['Arquivos Mensais'] } }];
      if (sql.includes('INSERT INTO openwa.sheet_automation_rows')) return [{ phone: params[1] }];
      if (sql.includes('UPDATE openwa.sheet_automation_rows SET status=$3')) statuses.set(params[1], params[2]);
      if (sql.includes('next_send_at=NOW()+')) return [{ id: 'regra' }];
      return [];
    });
    const sendText = jest.fn().mockResolvedValue({});
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never,
      { get: () => ({ sendText }) } as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue(details);
    jest.spyOn(service, 'prepareMonthlyCalls').mockResolvedValue({ calls: [
      { chatId: 'contato-a', cnpjs: ['48102421000150', '45499311000185'], names: ['EMPRESA A', 'EMPRESA B'],
        rows: [{ cnpj: '48102421000150', rowNumber: 2 }, { cnpj: '45499311000185', rowNumber: 3 }] },
      { chatId: 'contato-b', cnpjs: ['45499311000185'], names: ['EMPRESA B'],
        rows: [{ cnpj: '45499311000185', rowNumber: 3 }] },
    ], missing: 0, ambiguous: 0, alreadyCalled: 0, alreadyCalledContacts: new Set(),
    eligibleContactIds: new Set(['contato-a', 'contato-b']), blockedContacts: new Set() });
    const write = jest.spyOn(service, 'writeCalled').mockResolvedValue(undefined);
    const first = await service.executeMonthlyCalls('sessao', 'regra', draft, control);
    expect(first).toMatchObject({ sent: 1, marked: 0, pending: 1 });
    expect(first.finished).toBe(false);
    expect(write).not.toHaveBeenCalled();
    const second = await service.executeMonthlyCalls('sessao', 'regra', draft, control);
    expect(second).toMatchObject({ sent: 1, marked: 2, pending: 0 });
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(2);
    expect([...statuses.values()]).toEqual(['sent', 'sent']);
  });
  it('não marca a empresa compartilhada se um dos envios falhar', async () => {
    const statuses = new Map<string, string>();
    const query = jest.fn(async (sql: string, params: string[]) => {
      if (sql.includes('SELECT status,fingerprint')) return statuses.has(params[1]) ? [{ status: statuses.get(params[1]) }] : [];
      if (sql.includes('SELECT data FROM openwa.contact_profiles')) return [{ data: { cnpjs: ['48102421000150'], tags: ['Arquivos Mensais'] } }];
      if (sql.includes('INSERT INTO openwa.sheet_automation_rows')) return [{ phone: params[1] }];
      if (sql.includes('UPDATE openwa.sheet_automation_rows SET status=$3')) statuses.set(params[1], params[2]);
      if (sql.includes('next_send_at=NOW()+')) return [{ id: 'regra' }];
      return [];
    });
    const sendText = jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Sem conexão'));
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never,
      { get: () => ({ sendText }) } as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue(details);
    jest.spyOn(service, 'prepareMonthlyCalls').mockResolvedValue({ calls: [
      { chatId: 'contato-a', cnpjs: ['48102421000150'], names: ['EMPRESA A'], rows: [{ cnpj: '48102421000150', rowNumber: 2 }] },
      { chatId: 'contato-b', cnpjs: ['48102421000150'], names: ['EMPRESA A'], rows: [{ cnpj: '48102421000150', rowNumber: 2 }] },
    ], missing: 0, ambiguous: 0, alreadyCalled: 0, alreadyCalledContacts: new Set(),
    eligibleContactIds: new Set(['contato-a', 'contato-b']), blockedContacts: new Set() });
    const write = jest.spyOn(service, 'writeCalled').mockResolvedValue(undefined);
    await service.executeMonthlyCalls('sessao', 'regra', draft, control);
    const second = await service.executeMonthlyCalls('sessao', 'regra', draft, control);
    expect(second).toMatchObject({ sent: 0, marked: 0, failed: 1 });
    expect(write).not.toHaveBeenCalled();
    await service.executeMonthlyCalls('sessao', 'regra', draft, control);
    expect(sendText).toHaveBeenCalledTimes(2);
    expect([...statuses.values()]).toEqual(['sent_pending_sheet', 'send_failed']);
  });
  it('impede mensagem parcial se uma das empresas do contato não existe em Clientes', async () => {
    const db = { query: jest.fn().mockResolvedValue([
      { chatId: '558899999999@c.us', data: { cnpjs: ['48102421000150', '45499311000185'], tags: ['Arquivos Mensais'] } },
    ]) };
    const service = new SheetAutomationService(db as never, {} as never, {} as never, {} as never) as any;
    const result = await service.prepareMonthlyCalls(draft, control, { ...details, rows: details.rows.slice(0, 1) }, 'sessao');
    expect(result.calls).toHaveLength(1);
    expect(result.blockedContacts.has('558899999999@c.us')).toBe(true);
    expect(result.issues.some((issue: { reason: string }) => issue.reason.includes('nenhuma mensagem parcial'))).toBe(true);
  });
  it('não chama o contato inteiro quando uma de suas empresas tem o marcador X', async () => {
    const db = { query: jest.fn().mockResolvedValue([{ chatId: '558899999999@c.us',
      data: { cnpjs: ['48102421000150', '45499311000185', '33317715000121'], tags: ['Arquivos Mensais'] } }]) };
    const service = new SheetAutomationService(db as never, {} as never, {} as never, {} as never) as any;
    const result = await service.prepareMonthlyCalls(draft, control, details, 'sessao');
    expect(result.blockedContacts.has('558899999999@c.us')).toBe(true);
    expect(result.issues.some((issue: { reason: string }) => issue.reason.includes('bloqueada pelo marcador X'))).toBe(true);
  });
  it('envia uma vez e marca as duas empresas do mesmo contato', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT data FROM openwa.contact_profiles') ? [{ data: { cnpjs: ['48102421000150', '45499311000185'], tags: ['Arquivos Mensais'] } }]
      : sql.includes('next_send_at=NOW()+') ? [{ id: 'regra' }] : sql.includes('SELECT status,fingerprint') ? []
      : sql.includes('INSERT INTO openwa.sheet_automation_rows') ? [{ phone: 'claimed' }] : []);
    const sendText = jest.fn().mockResolvedValue({});
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never,
      { get: () => ({ sendText }) } as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue(details);
    jest.spyOn(service, 'prepareMonthlyCalls').mockResolvedValue({ calls: [{ chatId: '558899999999@c.us',
      cnpjs: ['48102421000150', '45499311000185'], names: ['EMPRESA A', 'EMPRESA B'],
      rows: [{ cnpj: '48102421000150', rowNumber: 2 }, { cnpj: '45499311000185', rowNumber: 3 }] }],
      missing: 0, ambiguous: 0, alreadyCalled: 0, alreadyCalledContacts: new Set(), eligibleContactIds: new Set(), blockedContacts: new Set() });
    const write = jest.spyOn(service, 'writeCalled').mockResolvedValue(undefined);
    const result = await service.executeMonthlyCalls('sessao', 'regra', draft, control);
    expect(result).toMatchObject({ sent: 1, marked: 2, failed: 0 });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0][1].text).toContain('*EMPRESA A* e *EMPRESA B*');
    expect(write).toHaveBeenCalledTimes(2);
  });
  it('não envia dois contatos no mesmo ciclo e guarda o próximo horário', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT data FROM openwa.contact_profiles') ? [{ data: { cnpjs: ['48102421000150'], tags: ['Arquivos Mensais'] } }]
      : sql.includes('next_send_at=NOW()+') ? [{ id: 'regra' }]
      : sql.includes('SELECT status,fingerprint') ? []
      : sql.includes('INSERT INTO openwa.sheet_automation_rows') ? [{ phone: 'claimed' }] : []);
    const sendText = jest.fn().mockResolvedValue({});
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never,
      { get: () => ({ sendText }) } as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue(details);
    jest.spyOn(service, 'prepareMonthlyCalls').mockResolvedValue({ calls: [
      { chatId: 'contato-a', cnpjs: ['48102421000150'], names: ['EMPRESA A'], rows: [{ cnpj: '48102421000150', rowNumber: 2 }] },
      { chatId: 'contato-b', cnpjs: ['45499311000185'], names: ['EMPRESA B'], rows: [{ cnpj: '45499311000185', rowNumber: 3 }] },
    ], missing: 0, ambiguous: 0, alreadyCalled: 0, alreadyCalledContacts: new Set(), eligibleContactIds: new Set(), blockedContacts: new Set() });
    jest.spyOn(service, 'writeCalled').mockResolvedValue(undefined);
    const result = await service.executeMonthlyCalls('sessao', 'regra', { ...draft, sendPace: '1-5' }, control);
    expect(result).toMatchObject({ sent: 1, pending: 1 });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.some(([sql, params]) => sql.includes('next_send_at=NOW()+') && params[1] >= 1 && params[1] <= 5)).toBe(true);
  });
  it('na segunda chamada escreve Nós chamamos 2x sem repetir a primeira etapa', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT data FROM openwa.contact_profiles') ? [{ data: { cnpjs: ['48102421000150'], tags: ['Arquivos Mensais'] } }]
      : sql.includes('next_send_at=NOW()+') ? [{ id: 'regra' }] : sql.includes('SELECT status,fingerprint') ? []
      : sql.includes('INSERT INTO openwa.sheet_automation_rows') ? [{ phone: 'claimed' }] : []);
    const sendText = jest.fn().mockResolvedValue({});
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never,
      { get: () => ({ sendText }) } as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue(details);
    jest.spyOn(service, 'prepareMonthlyCalls').mockResolvedValue({ calls: [{ chatId: '558899999999@c.us',
      cnpjs: ['48102421000150'], names: ['EMPRESA A'], rows: [{ cnpj: '48102421000150', rowNumber: 2 }] }],
      missing: 0, ambiguous: 0, alreadyCalled: 0, alreadyCalledContacts: new Set(), eligibleContactIds: new Set(), blockedContacts: new Set() });
    const write = jest.spyOn(service, 'writeCalled').mockResolvedValue(undefined);
    const result = await service.executeMonthlyCalls('sessao', 'regra', { ...draft, callRound: 2 }, control);
    expect(result).toMatchObject({ callRound: 2, sent: 1, marked: 1 });
    expect(write.mock.calls[0].slice(-2)).toEqual(['Nós chamamos', 'Nós chamamos 2x']);
    expect(query.mock.calls.some(([, params]) => Array.isArray(params) && params.includes(`${previousMonthSheet()}:2:558899999999@c.us`))).toBe(true);
  });
  it('não reenvia quando só falta marcar a planilha', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT status,fingerprint') ? [{ status: 'sent_pending_sheet' }] : []);
    const sendText = jest.fn();
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never,
      { get: () => ({ sendText }) } as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue(details);
    jest.spyOn(service, 'prepareMonthlyCalls').mockResolvedValue({ calls: [{ chatId: '558899999999@c.us',
      cnpjs: ['48102421000150', '45499311000185'], names: ['EMPRESA A', 'EMPRESA B'],
      rows: [{ cnpj: '48102421000150', rowNumber: 2 }, { cnpj: '45499311000185', rowNumber: 3 }] }],
      missing: 0, ambiguous: 0, alreadyCalled: 0, alreadyCalledContacts: new Set(), eligibleContactIds: new Set(), blockedContacts: new Set() });
    const write = jest.spyOn(service, 'writeCalled').mockResolvedValue(undefined);
    const result = await service.executeMonthlyCalls('sessao', 'regra', draft, control);
    expect(result).toMatchObject({ sent: 0, marked: 2, failed: 0 });
    expect(sendText).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(2);
  });
  it('confere a marcação já feita mesmo com a regra pausada, sem reenviar', async () => {
    const key = `${previousMonthSheet()}:558899999999@c.us`;
    const query = jest.fn(async (sql: string) => sql.includes('SELECT r.phone,r.target_cnpjs')
      ? [{ phone: key, targetCnpjs: null, data: { cnpjs: ['48102421000150'] } }] : []);
    const sendText = jest.fn();
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never,
      { get: () => ({ sendText }) } as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue({ headers: ['CNPJ', 'Chamado'],
      rows: [{ CNPJ: '48.102.421/0001-50', Chamado: 'Nós chamamos' }], rowNumbers: [2] });
    const checks = await service.reconcileMonthlyPending('sessao', { ...draft, id: 'regra', active: false });
    expect(checks.size).toBe(0);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status='sent',error=NULL"), ['regra', key]);
    expect(sendText).not.toHaveBeenCalled();
  });
  it('reconhece uma marcação manual diferente de Nós chamamos', async () => {
    const key = `${previousMonthSheet()}:558899999999@c.us`;
    const query = jest.fn(async (sql: string) => sql.includes('SELECT r.phone,r.target_cnpjs')
      ? [{ phone: key, targetCnpjs: ['48102421000150'] }] : []);
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never, {} as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue({ headers: ['CNPJ', 'Chamado'],
      rows: [{ CNPJ: '48.102.421/0001-50', Chamado: 'Eles chamaram' }], rowNumbers: [2] });
    const checks = await service.reconcileMonthlyPending('sessao', { ...draft, id: 'regra', active: false });
    expect(checks.size).toBe(0);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status='sent',error=NULL"), ['regra', key]);
  });
  it('não considera o valor da chamada anterior como marcação da segunda', async () => {
    const key = `${previousMonthSheet()}:2:558899999999@c.us`;
    const query = jest.fn(async (sql: string) => sql.includes('SELECT r.phone,r.target_cnpjs')
      ? [{ phone: key, targetCnpjs: ['48102421000150'] }] : []);
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never, {} as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue({ headers: ['CNPJ', 'Chamado'],
      rows: [{ CNPJ: '48.102.421/0001-50', Chamado: 'Nós chamamos' }], rowNumbers: [2] });
    const checks = await service.reconcileMonthlyPending('sessao', { ...draft, id: 'regra', callRound: 2 });
    expect(checks.get(key)).toContain('ainda sem marcação desta chamada');
    expect(query.mock.calls.some(([sql]) => sql.includes("SET status='sent'"))).toBe(false);
  });
  it('mantém a pendência se só parte dos CNPJs da mensagem foi marcada', async () => {
    const key = `${previousMonthSheet()}:558899999999@c.us`;
    const query = jest.fn(async (sql: string) => sql.includes('SELECT r.phone,r.target_cnpjs')
      ? [{ phone: key, targetCnpjs: ['48102421000150', '45499311000185'], data: { cnpjs: ['48102421000150'] } }] : []);
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never, {} as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue({ headers: ['CNPJ', 'Chamado'], rows: [
      { CNPJ: '48.102.421/0001-50', Chamado: 'Nós chamamos' },
      { CNPJ: '45.499.311/0001-85', Chamado: '' },
    ], rowNumbers: [2, 3] });
    const checks = await service.reconcileMonthlyPending('sessao', { ...draft, id: 'regra' });
    expect(checks.get(key)).toContain('Chamado está “vazio”');
    expect(query.mock.calls.some(([sql]) => sql.includes("SET status='sent'"))).toBe(false);
  });
});

describe('Chamada de clientes por CNPJ', () => {
  const draft = {
    name: 'Suporte remoto', spreadsheetId: '1A234567890abcdefghijklmnop',
    mode: 'cnpjCall', range: 'Controle!A1:H201', detailsRange: 'Clientes!A1:D201',
    controlCnpjColumn: 'CNPJ', detailsCnpjColumn: 'CNPJ', calledColumn: 'Chamado', calledValue: 'Nós chamamos',
    phoneColumn: '', mappings: [], messageTemplate: 'Olá, pode passar o acesso de {{Razão social}}?',
    sendMessage: true, active: false, intervalMinutes: 60,
  };
  it('compara CNPJs com e sem pontuação e exige as duas abas', () => {
    const service = new SheetAutomationService({} as never, {} as never, {} as never, {} as never) as any;
    expect(normalizeCnpj('48.102.421/0001-50')).toBe('48102421000150');
    expect(service.normalize(draft).calledValue).toBe('Nós chamamos');
    expect(() => service.normalize({ ...draft, detailsRange: '' })).toThrow('duas abas');
  });
  it('seleciona apenas contato único e linha com Chamado vazio', async () => {
    const db = { query: jest.fn().mockResolvedValue([
      { chatId: '558899999999@c.us', data: { document: '48.102.421/0001-50', custom: [] } },
      { chatId: '558877777777@c.us', data: { document: '45.499.311/0001-85', custom: [] } },
    ]) };
    const service = new SheetAutomationService(db as never, {} as never, {} as never, {} as never) as any;
    const control = { headers: ['CNPJ', 'Chamado'], rows: [
      { CNPJ: '48.102.421/0001-50', Chamado: '' },
      { CNPJ: '45.499.311/0001-85', Chamado: 'Eles chamaram' },
      { CNPJ: '11.111.111/0001-11', Chamado: '' },
    ], rowNumbers: [2, 3, 5] };
    const details = { headers: ['CNPJ', 'Razão social'], rows: [
      { CNPJ: '48102421000150', 'Razão social': 'EMBALLE INDÚSTRIA' },
    ], rowNumbers: [2] };
    const result = await service.prepareCnpjCalls(draft, control, details, 'sessao');
    expect(result).toMatchObject({ missing: 1, ambiguous: 0, alreadyCalled: 1 });
    expect(result.calls).toEqual([{ cnpj: '48102421000150', chatId: '558899999999@c.us',
      values: { CNPJ: '48102421000150', Chamado: '', 'Razão social': 'EMBALLE INDÚSTRIA' }, rowNumber: 2 }]);
  });
  it('não envia quando há mais de um contato para o CNPJ', async () => {
    const db = { query: jest.fn().mockResolvedValue([
      { chatId: '558899999999@c.us', data: { document: '48102421000150', custom: [] } },
      { chatId: '558888888888@c.us', data: { document: '', custom: [{ label: 'CNPJ', value: '48.102.421/0001-50' }] } },
    ]) };
    const service = new SheetAutomationService(db as never, {} as never, {} as never, {} as never) as any;
    const control = { headers: ['CNPJ', 'Chamado'], rows: [{ CNPJ: '48102421000150', Chamado: '' }], rowNumbers: [2] };
    const details = { headers: ['CNPJ', 'Razão social'], rows: [{ CNPJ: '48102421000150', 'Razão social': 'Empresa' }], rowNumbers: [2] };
    const result = await service.prepareCnpjCalls(draft, control, details, 'sessao');
    expect(result.calls).toHaveLength(0);
    expect(result.ambiguous).toBe(1);
  });
  it('não envia quando o CNPJ se repete na aba de controle, inclusive se uma linha já foi chamada', async () => {
    const db = { query: jest.fn().mockResolvedValue([
      { chatId: '558899999999@c.us', data: { document: '48102421000150', custom: [] } },
    ]) };
    const service = new SheetAutomationService(db as never, {} as never, {} as never, {} as never) as any;
    const control = { headers: ['CNPJ', 'Chamado'], rows: [
      { CNPJ: '48102421000150', Chamado: 'Nós chamamos' },
      { CNPJ: '48.102.421/0001-50', Chamado: '' },
    ], rowNumbers: [2, 3] };
    const details = { headers: ['CNPJ', 'Razão social'], rows: [{ CNPJ: '48102421000150', 'Razão social': 'Empresa' }], rowNumbers: [2] };
    const result = await service.prepareCnpjCalls(draft, control, details, 'sessao');
    expect(result.calls).toHaveLength(0);
    expect(result).toMatchObject({ ambiguous: 1, alreadyCalled: 1 });
  });
  it('não marca Chamado quando o envio falha', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('next_send_at=NOW()+') ? [{ id: 'regra' }] : sql.includes('SELECT status') ? [] : sql.includes('INSERT INTO openwa.sheet_automation_rows') ? [{ phone: '48102421000150' }] : []);
    const sendText = jest.fn().mockRejectedValue(new Error('WhatsApp indisponível'));
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never,
      { get: () => ({ sendText }) } as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue({ headers: [], rows: [], rowNumbers: [] });
    jest.spyOn(service, 'prepareCnpjCalls').mockResolvedValue({ calls: [{ cnpj: '48102421000150', chatId: '558899999999@c.us', values: { 'Razão social': 'Empresa' }, rowNumber: 2 }], missing: 0, ambiguous: 0, alreadyCalled: 0 });
    const write = jest.spyOn(service, 'writeCalled').mockResolvedValue(undefined);
    const result = await service.executeCnpjCalls('sessao', 'regra', draft, { headers: [], rows: [{}], rowNumbers: [2] });
    expect(result).toMatchObject({ sent: 0, marked: 0, failed: 1 });
    expect(write).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql, params]) => sql.includes('UPDATE openwa.sheet_automation_rows') && params[2] === 'send_failed')).toBe(true);
  });
  it('marca Chamado sem reenviar uma mensagem já enviada', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('SELECT status') ? [{ status: 'sent_pending_sheet' }] : []);
    const sendText = jest.fn();
    const service = new SheetAutomationService({ query } as never, {} as never, {} as never,
      { get: () => ({ sendText }) } as never) as any;
    jest.spyOn(service, 'fetchSheet').mockResolvedValue({ headers: [], rows: [], rowNumbers: [] });
    jest.spyOn(service, 'prepareCnpjCalls').mockResolvedValue({ calls: [{ cnpj: '48102421000150', chatId: '558899999999@c.us', values: { 'Razão social': 'Empresa' }, rowNumber: 2 }], missing: 0, ambiguous: 0, alreadyCalled: 0 });
    const write = jest.spyOn(service, 'writeCalled').mockResolvedValue(undefined);
    const result = await service.executeCnpjCalls('sessao', 'regra', draft, { headers: [], rows: [{}], rowNumbers: [2] });
    expect(result).toMatchObject({ sent: 0, marked: 1, failed: 0 });
    expect(sendText).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('não escreve Chamado se o CNPJ da linha mudou entre a leitura e a escrita', async () => {
    const service = new SheetAutomationService({} as never, {} as never, {} as never, {} as never) as any;
    jest.spyOn(service, 'googleToken').mockResolvedValue('token');
    const originalFetch = global.fetch;
    const request = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ values: [['11.111.111/0001-11']] }) });
    global.fetch = request;
    try {
      await expect(service.writeCalled(draft, { headers: ['CNPJ', 'Chamado'], rows: [], rowNumbers: [] }, 2, '48102421000150'))
        .rejects.toThrow('linha 2 mudou');
      expect(request).toHaveBeenCalledTimes(1);
    } finally { global.fetch = originalFetch; }
  });
});
