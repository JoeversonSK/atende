"use client";

import { useRef, useState } from "react";
import { FileUp, X } from "lucide-react";

type Cell = string | number | boolean | Date | null | undefined;
type CnpjContact = { row: number; phone: string; cnpjs: string[] };
type Preview = { total: number; matched: number; missing: number; ambiguous: number; duplicateCnpjs: number; issues: { row: number; phone: string; reason: string }[] };
type Result = { total: number; updated: number; unchanged: number; skipped: number; duplicateCnpjs: number; issues: Preview["issues"] };

const asText = (value: Cell) => value == null ? "" : value instanceof Date
  ? value.toLocaleDateString("pt-BR") : String(value).trim();
const header = (value: string) => value.toLocaleLowerCase("pt-BR").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const normalizePhone = (raw: string) => {
  let phone = raw.replace(/\D/g, "");
  if (phone.startsWith("00") && phone.length > 13) phone = phone.slice(2);
  if (!raw.startsWith("+") && /^\d{10,11}$/.test(phone)) phone = `55${phone}`;
  return /^\d{7,15}$/.test(phone) ? phone : "";
};

export function parseCnpjTable(rows: Cell[][]) {
  const headings = rows.findIndex(row => row.some(value => header(asText(value)) === "telefone"));
  const names = headings >= 0 ? rows[headings].map(value => header(asText(value))) : [];
  const phoneColumn = headings >= 0 ? names.findIndex(name => name === "telefone" || name === "celular") : 2;
  const cnpjColumns = headings >= 0 ? names.flatMap((name, index) => /^cnpj\d*$/.test(name) ? [index] : []) : [3, 4, 5, 6];
  if (phoneColumn < 0 || !cnpjColumns.length)
    throw new Error("A planilha precisa ter Telefone e ao menos uma coluna CNPJ, ou seguir o formato sem cabeçalho com telefone em C e CNPJs de D a G.");
  const contacts = new Map<string, CnpjContact>();
  const errors: string[] = [];
  let sourceRows = 0;
  for (let index = headings + 1; index < rows.length; index++) {
    const row = rows[index];
    if (!row?.some(value => asText(value))) continue;
    sourceRows++;
    const phone = normalizePhone(asText(row[phoneColumn]));
    if (!phone) { errors.push(`Linha ${index + 1}: telefone inválido.`); continue; }
    const cnpjs: string[] = [];
    for (const column of cnpjColumns) {
      const value = asText(row[column]);
      if (!value) continue;
      if (!/^[\d.\/-]+$/.test(value) || value.replace(/\D/g, "").length !== 14) {
        errors.push(`Linha ${index + 1}: CNPJ inválido na coluna ${column + 1}.`);
        continue;
      }
      cnpjs.push(value.replace(/\D/g, ""));
    }
    if (!cnpjs.length) { errors.push(`Linha ${index + 1}: nenhum CNPJ válido.`); continue; }
    const previous = contacts.get(phone);
    contacts.set(phone, { row: previous?.row || index + 1, phone,
      cnpjs: [...new Set([...(previous?.cnpjs || []), ...cnpjs])] });
  }
  const parsed = [...contacts.values()];
  const owners = new Map<string, Set<string>>();
  for (const contact of parsed) for (const cnpj of contact.cnpjs)
    owners.set(cnpj, new Set([...(owners.get(cnpj) || []), contact.phone]));
  return { contacts: parsed, errors, sourceRows,
    multiCnpjContacts: parsed.filter(contact => contact.cnpjs.length > 1).length,
    duplicateCnpjs: [...owners.values()].filter(phones => phones.size > 1).length };
}

export async function readCnpjFile(file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error("Escolha um arquivo .xlsx de até 10 MB.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Escolha um arquivo .xlsx.");
  const { readSheet } = await import("read-excel-file/browser");
  const rows = await readSheet(file);
  if (!rows.length) throw new Error("A planilha não possui dados.");
  return parseCnpjTable(rows.map(row => row.map(value => value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date ? value : String(value))));
}

export function ContactCnpjImport({ baseUrl, sessionId, token, onComplete, onClose }: {
  baseUrl: string; sessionId: string; token: string; onComplete: () => Promise<void>; onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ReturnType<typeof parseCnpjTable> | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/operator-auth/contacts/${encodeURIComponent(sessionId)}/cnpj-import`;

  async function request(mode: "preview" | "apply", contacts: CnpjContact[]) {
    const response = await fetch(`${endpoint}/${mode}`, { method: "POST",
      headers: { "Content-Type": "application/json", "X-Atende-Token": token },
      body: JSON.stringify({ contacts }) });
    const data = await response.json() as Preview & Result & { message?: string | string[] };
    if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(" ") : data.message || "Falha ao atualizar CNPJs.");
    return data;
  }

  async function choose(file?: File) {
    setParsed(null); setPreview(null); setResult(null); setError(""); setName(file?.name || "");
    if (!file) return;
    setBusy(true);
    try {
      const next = await readCnpjFile(file);
      setParsed(next);
      if (!next.errors.length && next.contacts.length) setPreview(await request("preview", next.contacts));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível ler a planilha."); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!parsed || parsed.errors.length || !preview?.matched) return;
    setBusy(true); setError("");
    try { setResult(await request("apply", parsed.contacts)); await onComplete().catch(() => undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível atualizar os CNPJs."); }
    finally { setBusy(false); }
  }

  return <div className="contact-import-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="contact-import-dialog" role="dialog" aria-modal="true" aria-label="Atualizar CNPJs dos contatos">
      <header><div><h2>Atualizar CNPJs</h2><p>Associe vários CNPJs ao mesmo contato pelo telefone.</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="Fechar"><X size={20}/></button></header>
      <p>Use a planilha sem cabeçalho com telefone na coluna C e CNPJs nas colunas D a G. Também é aceito um arquivo com cabeçalhos Telefone, CNPJ, CNPJ 2 e assim por diante. A atualização acrescenta CNPJs aos contatos existentes; mantém nomes, etiquetas, atribuições e histórico.</p>
      <input ref={input} type="file" accept=".xlsx" hidden onChange={event => void choose(event.target.files?.[0])}/>
      <button type="button" className="contact-import-pick" disabled={busy} onClick={() => input.current?.click()}><FileUp size={20}/>{name || "Selecionar planilha de CNPJs"}</button>
      {parsed && <><p><b>{parsed.contacts.length}</b> telefones em {parsed.sourceRows} linhas; <b>{parsed.multiCnpjContacts}</b> contatos com vários CNPJs.</p>
        {parsed.errors.length > 0 && <><p role="alert">Corrija {parsed.errors.length} linha(s) antes de continuar.</p><ul className="contact-import-errors">{parsed.errors.slice(0, 10).map(message => <li key={message}>{message}</li>)}</ul></>}
      </>}
      {preview && !result && <><p><b>{preview.matched}</b> contatos encontrados; {preview.missing} telefones não encontrados; {preview.ambiguous} telefones ambíguos.</p>
        {preview.duplicateCnpjs > 0 && <p role="status">{preview.duplicateCnpjs} CNPJs aparecem em telefones diferentes. Eles serão mantidos, e a automação mensal enviará uma mensagem para cada contato apto antes de marcar a linha como chamada.</p>}
        {preview.issues.length > 0 && <ul className="contact-import-errors">{preview.issues.slice(0, 10).map((issue,index) => <li key={`${issue.row}-${index}`}>Linha {issue.row}: {issue.phone} — {issue.reason}</li>)}</ul>}
        <button type="button" className="solid-button" disabled={busy || !preview.matched} onClick={() => void apply()}>{busy ? "Atualizando…" : `Atualizar CNPJs de ${preview.matched} contatos`}</button>
      </>}
      {result && <p role="status">Atualização concluída: {result.updated} contatos alterados, {result.unchanged} já estavam atualizados e {result.skipped} precisam de revisão. {result.duplicateCnpjs} CNPJs repetidos entre telefones.</p>}
      {error && <p className="contact-import-feedback" role="alert">{error}</p>}
    </section>
  </div>;
}
