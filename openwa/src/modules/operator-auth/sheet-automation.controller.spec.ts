import { SheetAutomationService } from './sheet-automation.controller';

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
