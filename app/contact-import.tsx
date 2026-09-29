"use client";

import { useRef, useState } from "react";
import { FileUp, X } from "lucide-react";

type ImportContact = { firstName: string; lastName: string; phone: string; tags: string[] };
type CellValue = string | number | null | undefined | { text?: string; result?: unknown; richText?: { text: string }[] };

const asText = (value: CellValue): string => {
  if (value == null) return "";
  if (typeof value === "number") return Number.isSafeInteger(value) ? value.toFixed(0) : String(value);
  if (typeof value === "string") return value.trim();
  if (typeof value.text === "string") return value.text.trim();
  if (value.richText) return value.richText.map(part => part.text).join("").trim();
  if (value.result !== undefined) return asText(value.result as CellValue);
  return "";
};
const normalizedHeader = (value: string) => value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
const usefulName = (value: string) => /[\p{L}\p{N}]/u.test(value) ? value.trim() : "";
const normalizePhone = (input: string) => {
  const raw = input.trim();
  let number = raw.replace(/\D/g, "");
  if (number.startsWith("00") && number.length > 13) number = number.slice(2);
  if (!raw.startsWith("+") && /^\d{10,11}$/.test(number)) number = `55${number}`;
  return /^\d{7,15}$/.test(number) ? raw.startsWith("+") && !number.startsWith("55") ? `+${number}` : number : "";
};

export function parseContactTable(rows: CellValue[][]) {
  const headerIndex = rows.findIndex(row => row.some(value => normalizedHeader(asText(value)) === "telefone"));
  if (headerIndex < 0) throw new Error("Não encontrei a coluna Telefone na planilha.");
  const headings = rows[headerIndex].map(value => normalizedHeader(asText(value)));
  const column = (names: string[]) => headings.findIndex(value => names.includes(value));
  const first = column(["primeironome", "nome"]), last = column(["sobrenome"]), phone = column(["telefone", "celular"]), tags = column(["etiquetas", "tags"]);
  if (first < 0 || last < 0 || phone < 0 || tags < 0) throw new Error("A planilha precisa ter as colunas Primeiro nome, Sobrenome, Telefone e Etiquetas.");
  const contacts = new Map<string, ImportContact>();
  const errors: string[] = [];
  let sourceRows = 0;
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    if (!row?.some(value => asText(value))) continue;
    sourceRows++;
    const number = normalizePhone(asText(row[phone]));
    if (!number) { errors.push(`Linha ${index + 1}: telefone inválido ou vazio.`); continue; }
    const firstName = usefulName(asText(row[first])), lastName = usefulName(asText(row[last]));
    const tagText = tags === headings.length - 1 ? row.slice(tags).map(asText).filter(Boolean).join(",") : asText(row[tags]);
    const incomingTags = tagText.split(",").map(tag => tag.trim()).filter(Boolean);
    const previous = contacts.get(number);
    contacts.set(number, {
      firstName: firstName || previous?.firstName || "",
      lastName: lastName || previous?.lastName || "",
      phone: number,
      tags: [...new Set([...(previous?.tags || []), ...incomingTags])],
    });
  }
  const parsed = [...contacts.values()];
  return { contacts: parsed, errors, sourceRows, unnamedCount: parsed.filter(contact => !contact.firstName && !contact.lastName).length };
}

function parseCsv(content: string) {
  const firstLine = content.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(field.trim()); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && content[index + 1] === "\n") index++;
      row.push(field.trim()); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("O CSV contém aspas sem fechamento.");
  if (row.length || field) { row.push(field.trim()); rows.push(row); }
  return rows;
}

async function readContactFile(file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error("Escolha um arquivo de até 10 MB.");
  const suffix = file.name.split(".").pop()?.toLowerCase();
  if (suffix === "csv") {
    const buffer = await file.arrayBuffer();
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
    catch { content = new TextDecoder("windows-1252").decode(buffer); }
    return parseContactTable(parseCsv(content));
  }
  if (suffix !== "xlsx") throw new Error("Use um arquivo .xlsx ou .csv. Para .xls, salve uma cópia em .xlsx primeiro.");
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("A planilha não possui abas.");
  const rows: CellValue[][] = [];
  worksheet.eachRow((row, number) => {
    rows[number - 1] = Array.from({ length: row.cellCount }, (_, index) => row.getCell(index + 1).value as CellValue);
  });
  return parseContactTable(rows);
}

export function ContactImport({ baseUrl, sessionId, token, onComplete, onClose }: {
  baseUrl: string; sessionId: string; token: string; onComplete: () => Promise<void>; onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ReturnType<typeof parseContactTable> | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [progress, setProgress] = useState(0);

  async function choose(file?: File) {
    setResult(null); setFeedback(""); setName(file?.name || ""); setProgress(0);
    if (!file) return;
    setBusy(true);
    try { setResult(await readContactFile(file)); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível ler a planilha."); }
    finally { setBusy(false); }
  }

  async function importContacts() {
    if (!result?.contacts.length || result.errors.length) return;
    setBusy(true); setFeedback(""); setProgress(0);
    let created = 0, updated = 0, assigned = 0, processed = 0;
    try {
      for (let index = 0; index < result.contacts.length; index += 200) {
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/operator-auth/contacts/${encodeURIComponent(sessionId)}/import`, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Atende-Token": token },
          body: JSON.stringify({ contacts: result.contacts.slice(index, index + 200) }),
        });
        const body = await response.json() as { created?: number; updated?: number; assigned?: number; message?: string | string[] };
        if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(" ") : body.message || "Falha ao importar contatos.");
        created += body.created || 0; updated += body.updated || 0; assigned += body.assigned || 0;
        processed = Math.min(index + 200, result.contacts.length);
        setProgress(processed);
      }
      await onComplete().catch(() => undefined);
      setFeedback(`Importação concluída: ${created} criados, ${updated} atualizados e ${assigned} atribuídos à Sabrina.`);
    } catch (error) {
      setFeedback(`${processed ? `${processed} contatos processados antes da interrupção. ` : ""}${error instanceof Error ? error.message : "Falha ao importar."}`);
      if (processed) await onComplete().catch(() => undefined);
    } finally { setBusy(false); }
  }

  return <div className="contact-import-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="contact-import-dialog" role="dialog" aria-modal="true" aria-label="Importar contatos">
      <header><div><h2>Importar contatos</h2><p>Atualize quem já existe e cadastre novos telefones.</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="Fechar"><X size={20}/></button></header>
      <p>Arquivo .xlsx ou .csv com <b>Primeiro nome, Sobrenome, Telefone e Etiquetas</b>. Separe as etiquetas por vírgula. Telefones brasileiros sem código do país recebem 55; para outros países, inclua + e o DDI.</p>
      <input ref={input} type="file" accept=".xlsx,.csv" hidden onChange={event => void choose(event.target.files?.[0])}/>
      <button type="button" className="contact-import-pick" disabled={busy} onClick={() => input.current?.click()}><FileUp size={20}/>{name || "Selecionar planilha"}</button>
      {result && <><p><b>{result.contacts.length}</b> telefones únicos em {result.sourceRows} linhas. {result.errors.length ? <b>{result.errors.length} linhas com erro — corrija o arquivo antes de importar.</b> : "Confira uma amostra abaixo antes de continuar."}{result.unnamedCount > 0 && <><br/><b>{result.unnamedCount} contatos sem nome no arquivo.</b> O nome ficará em branco até você editar o contato.</>}</p>
        {result.errors.length > 0 && <ul className="contact-import-errors">{result.errors.slice(0, 8).map(message => <li key={message}>{message}</li>)}</ul>}
        {!result.errors.length && <div className="contact-import-preview"><table><thead><tr><th>Nome</th><th>Telefone</th><th>Etiquetas</th></tr></thead><tbody>{result.contacts.slice(0, 8).map(contact => <tr key={contact.phone}><td>{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Contato sem nome"}</td><td>{contact.phone}</td><td>{contact.tags.join(", ") || "—"}</td></tr>)}</tbody></table></div>}
        <button type="button" className="solid-button" disabled={busy || !!result.errors.length || !result.contacts.length} onClick={() => void importContacts()}>{busy ? `Importando ${progress}/${result.contacts.length}…` : `Importar ${result.contacts.length} contatos`}</button>
      </>}
      {feedback && <p role="status" className="contact-import-feedback">{feedback}</p>}
    </section>
  </div>;
}
