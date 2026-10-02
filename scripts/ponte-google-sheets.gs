/**
 * Ponte privada da central para UMA planilha. Cole no Apps Script vinculado à
 * planilha; configure ATENDE_BRIDGE_SECRET nas Propriedades do script.
 * O segredo e a URL /exec ficam somente no servidor da central.
 */
function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    const secret = props.getProperty('ATENDE_BRIDGE_SECRET');
    if (!secret || secret.length < 32 || request.secret !== secret) throw new Error('Acesso negado.');
    const sheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!sheet || request.spreadsheetId !== sheet.getId()) throw new Error('Planilha não autorizada.');
    if (request.action === 'read') {
      const target = sheet.getRange(String(request.range));
      if (target.getNumRows() > 1001 || target.getNumColumns() > 52) throw new Error('Intervalo acima do limite permitido.');
      return reply_({ ok: true, values: target.getDisplayValues() });
    }
    if (request.action === 'mark') {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        const cnpjCell = sheet.getRange(String(request.cnpjCell));
        const cell = sheet.getRange(String(request.cell));
        if (cnpjCell.getNumRows() !== 1 || cnpjCell.getNumColumns() !== 1 ||
            cell.getNumRows() !== 1 || cell.getNumColumns() !== 1 ||
            cnpjCell.getSheet().getSheetId() !== cell.getSheet().getSheetId() ||
            cnpjCell.getRow() !== cell.getRow()) throw new Error('Células inválidas.');
        const actualCnpj = String(cnpjCell.getDisplayValue()).replace(/\D/g, '');
        if (actualCnpj !== String(request.expectedCnpj)) throw new Error('A linha mudou; o Chamado não foi alterado.');
        const actual = String(cell.getDisplayValue()).trim();
        const next = String(request.nextValue);
        if (actual !== next) {
          if (actual !== String(request.expectedValue || '')) throw new Error('Chamado mudou; o valor não foi sobrescrito.');
          cell.setValue(next);
          SpreadsheetApp.flush();
        }
        return reply_({ ok: true });
      } finally { lock.releaseLock(); }
    }
    throw new Error('Ação inválida.');
  } catch (error) {
    return reply_({ ok: false, error: String(error && error.message || error) });
  }
}

function reply_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
