import { SheetAutomationService, normalizeCnpj } from './sheet-automation.controller';

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

  it('rejects unbounded ranges and unknown profile destinations', () => {
    expect(() => methods.normalize({ ...draft, range: 'A1:Z9999' })).toThrow('até 1.000 contatos');
    expect(() => methods.normalize({ ...draft, mappings: [{ column: 'Segredo', target: 'password' }] })).toThrow('mapeamento');
  });

  it('rejects a message variable that has no matching sheet column', async () => {
    const auth = { requireAdmin: jest.fn().mockResolvedValue({}) };
    const checked = new SheetAutomationService({} as never, auth as never, {} as never, {} as never);
    jest.spyOn(checked as any, 'fetchSheet').mockResolvedValue({ headers: ['Telefone', 'Primeiro nome', 'Etiquetas', 'Vencimento'], rows: [] });
    await expect(checked.preview('admin-token', { ...draft, messageTemplate: 'Olá, {{Coluna ausente}}' }))
      .rejects.toThrow('não existe no cabeçalho');
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
    const query = jest.fn(async (sql: string) => sql.includes('SELECT status') ? [] : sql.includes('INSERT INTO openwa.sheet_automation_rows') ? [{ phone: '48102421000150' }] : []);
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
