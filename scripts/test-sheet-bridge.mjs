import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("./ponte-google-sheets.gs", import.meta.url), "utf8");
const secret = "segredo-sintetico-para-testes-com-mais-de-32-caracteres";

function bridge(values) {
  const cells = new Map(Object.entries(values));
  const sheet = {
    getId: () => "planilha-de-teste",
    getRange(address) {
      const row = Number(address.match(/\d+$/)?.[0]);
      if (!row) throw new Error("Endereço inválido");
      return {
        getNumRows: () => 1, getNumColumns: () => 1,
        getSheet: () => ({ getSheetId: () => 1 }), getRow: () => row,
        getA1Notation: () => address,
        getDisplayValue: () => cells.get(address) || "",
        setValue: value => cells.set(address, value),
      };
    },
  };
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => secret }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => sheet, flush: () => {} },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: value => ({ setMimeType: () => value }) },
  };
  runInNewContext(source, context);
  return { cells, call: input => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ ...input, secret }) } })) };
}

test("ponte atualiza dois CNPJs após conferir todas as células", () => {
  const { cells, call } = bridge({
    "Setembro2026!B2": "12345678000190", "Setembro2026!I2": "", "Setembro2026!J2": "",
    "Setembro2026!B3": "98765432000110", "Setembro2026!I3": "Gerado e enviado", "Setembro2026!J3": "",
  });
  assert.deepEqual(call({ action: "updateMany", spreadsheetId: "planilha-de-teste", keys: [
    { cell: "Setembro2026!B2", expected: "12345678000190" },
    { cell: "Setembro2026!B3", expected: "98765432000110" },
  ], changes: [
    { cell: "Setembro2026!I2", expectedValue: "", nextValue: "Gerado" },
    { cell: "Setembro2026!J2", expectedValue: "", nextValue: "Geradas" },
    { cell: "Setembro2026!J3", expectedValue: "", nextValue: "Geradas" },
  ] }), { ok: true });
  assert.equal(cells.get("Setembro2026!I2"), "Gerado");
  assert.equal(cells.get("Setembro2026!I3"), "Gerado e enviado");
});

test("ponte não altera nenhuma linha se uma célula mudou", () => {
  const { cells, call } = bridge({ "Setembro2026!B2": "12345678000190", "Setembro2026!I2": "corrigido" });
  const result = call({ action: "updateMany", spreadsheetId: "planilha-de-teste",
    keys: [{ cell: "Setembro2026!B2", expected: "12345678000190" }],
    changes: [{ cell: "Setembro2026!I2", expectedValue: "", nextValue: "Gerado" }] });
  assert.equal(result.ok, false);
  assert.equal(cells.get("Setembro2026!I2"), "corrigido");
});
