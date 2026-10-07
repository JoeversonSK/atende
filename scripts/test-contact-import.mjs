import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { readContactFile } from "../app/contact-import.tsx";

const header = ["Primeiro nome", "Sobrenome", "Telefone", "Etiquetas"];
const values = ["Ana", "Silva", "11999998888", "Clipp, Apolo"];
const cell = (column, row, value) =>
  `<c r="${column}${row}" t="inlineStr"><is><t>${value}</t></is></c>`;
const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:D2"/><sheetData>
  <row r="1">${header.map((value, index) => cell("ABCD"[index], 1, value)).join("")}</row>
  <row r="2">${values.map((value, index) => cell("ABCD"[index], 2, value)).join("")}</row>
  </sheetData></worksheet>`;
const entries = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
    <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    </Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>`,
  "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <sheets><sheet name="Contatos" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    </Relationships>`,
  "xl/worksheets/sheet1.xml": worksheet,
};

test("importa a primeira aba XLSX com nomes, telefone e etiquetas", async () => {
  const bytes = zipSync(Object.fromEntries(Object.entries(entries).map(([name, xml]) => [name, strToU8(xml)])));
  const file = new File([bytes], "contatos.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const result = await readContactFile(file);
  assert.equal(result.sourceRows, 1);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.contacts, [{
    firstName: "Ana", lastName: "Silva", phone: "5511999998888", tags: ["Clipp", "Apolo"],
  }]);
});
