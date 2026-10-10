"use client";

import { Forward, Search, Send, X } from "lucide-react";
import { messageDisplayText, type Message } from "../../conversation-model";
import type { ContactRow } from "../contact-list";
import { PasteFilePreview } from "./paste-file-preview";

export type PendingPaste =
  | { kind: "files"; files: File[]; omittedFiles: number; chatId: string; chatName: string }
  | { kind: "text"; text: string; chatId: string; chatName: string };

export function PasteConfirmationDialog({
  pending, draft, busy, onCancel, onConfirm,
}: {
  pending: PendingPaste;
  draft: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <div className="wa-backdrop paste-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onCancel();
  }}>
    <form className="forward-modal paste-modal" role="dialog" aria-modal="true" aria-labelledby="paste-confirm-title"
      onSubmit={event => { event.preventDefault(); onConfirm(); }}
      onKeyDown={event => { if (event.key === "Escape" && !busy) onCancel(); }}>
      <header><div><h2 id="paste-confirm-title">Confirmar envio do conteúdo colado</h2><p>Confira antes de enviar para {pending.chatName}.</p></div><button type="button" onClick={onCancel} disabled={busy} aria-label="Fechar"><X size={20}/></button></header>
      {pending.kind === "text"
        ? <div className="paste-preview-text">{pending.text}</div>
        : <><ul className="paste-preview-files">{pending.files.map((file, index) => <PasteFilePreview key={`${file.name}-${index}`} file={file} index={index}/>)}</ul>{pending.omittedFiles > 0 && <p className="paste-omitted">Mais {pending.omittedFiles} arquivo(s) não serão enviados. O limite é 10 por vez.</p>}</>}
      <footer><button type="button" autoFocus onClick={onCancel} disabled={busy}>Cancelar</button><button type="submit" disabled={busy || (pending.kind === "text" && !draft.trim())}><Send size={16}/>Confirmar envio</button></footer>
    </form>
  </div>;
}

export function FlowCnpjSelectionDialog({
  flowName, cnpjs, selected, busy, onToggle, onAll, onCancel, onConfirm,
}: {
  flowName: string;
  cnpjs: string[];
  selected: string[];
  busy: boolean;
  onToggle: (cnpj: string) => void;
  onAll: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const format=(cnpj:string)=>cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,"$1.$2.$3/$4-$5");
  return <div className="wa-backdrop paste-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onCancel();}}>
    <form className="forward-modal flow-cnpj-modal" role="dialog" aria-modal="true" aria-labelledby="flow-cnpj-title"
      onSubmit={event=>{event.preventDefault();onConfirm();}} onKeyDown={event=>{if(event.key==="Escape"&&!busy)onCancel();}}>
      <header><div><h2 id="flow-cnpj-title">Escolher CNPJs finalizados</h2><p>O fluxo “{flowName}” marcará SPED como Gerado e Vendas como Geradas na aba mensal para os CNPJs selecionados.</p></div><button type="button" onClick={onCancel} disabled={busy} aria-label="Fechar"><X size={20}/></button></header>
      <div className="flow-cnpj-options"><button type="button" onClick={onAll} disabled={busy}>Selecionar todos</button>{cnpjs.map(cnpj=><label key={cnpj}><input type="checkbox" checked={selected.includes(cnpj)} disabled={busy} onChange={()=>onToggle(cnpj)}/><span>{format(cnpj)}</span></label>)}</div>
      <footer><button type="button" onClick={onCancel} disabled={busy}>Cancelar</button><button type="submit" disabled={busy||!selected.length}><Send size={16}/>{`Enviar e atualizar ${selected.length} ${selected.length===1?"CNPJ":"CNPJs"}`}</button></footer>
    </form>
  </div>;
}

export function ForwardMessageDialog({
  message, busy, search, onSearch, selectedIds, contacts, candidates, error,
  onToggle, onCancel, onSend,
}: {
  message: Message;
  busy: boolean;
  search: string;
  onSearch: (value: string) => void;
  selectedIds: string[];
  contacts: ContactRow[];
  candidates: ContactRow[];
  error: string;
  onToggle: (chatId: string) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const mediaName = ({ image: "Foto", video: "Vídeo", audio: "Áudio", voice: "Áudio", document: "Arquivo" } as Record<string, string>)[message.type];
  return <div className="wa-backdrop forward-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onCancel();
  }}>
    <form className="forward-modal" role="dialog" aria-modal="true" aria-labelledby="forward-title"
      onSubmit={event => { event.preventDefault(); onSend(); }}>
      <header><div><h2 id="forward-title">Encaminhar mensagem</h2><p>Escolha até 10 contatos para receber a mensagem original.</p></div><button type="button" onClick={onCancel} disabled={busy} aria-label="Fechar"><X size={20}/></button></header>
      <div className="forward-preview"><Forward size={17}/><span>{messageDisplayText(message) || mediaName || "Mensagem"}</span></div>
      <label className="forward-search"><Search size={17}/><input autoFocus aria-label="Buscar contato para encaminhar" value={search} onChange={event => onSearch(event.target.value)} placeholder="Buscar contato ou número"/></label>
      {selectedIds.length > 0 && <div className="forward-selected">{selectedIds.map(id => <button key={id} type="button" disabled={busy} onClick={() => onToggle(id)}>{contacts.find(contact => contact.id === id)?.name || id}<X size={13}/></button>)}</div>}
      <div className="forward-contact-list" role="group" aria-label="Contatos de destino">
        {candidates.slice(0, 80).map(contact => <label key={contact.id} className="forward-contact"><input type="checkbox" disabled={busy} checked={selectedIds.includes(contact.id)} onChange={() => onToggle(contact.id)}/><span className="forward-contact-avatar">{contact.name.charAt(0).toUpperCase()}</span><span className="forward-contact-name"><b>{contact.name}</b><small>{contact.phone || contact.id.replace(/@.*/, "")}</small></span></label>)}
        {!candidates.length && <p className="forward-empty">Nenhum contato encontrado.</p>}
        {candidates.length > 80 && <p className="forward-more">Mostrando os primeiros 80 contatos. Refine a busca para encontrar outros.</p>}
      </div>
      {error && <p className="forward-error" role="alert">{error}</p>}
      <footer><button type="button" onClick={onCancel} disabled={busy}>Cancelar</button><button type="submit" disabled={busy || !selectedIds.length}><Forward size={17}/>{busy ? "Encaminhando…" : `Encaminhar para ${selectedIds.length}`}</button></footer>
    </form>
  </div>;
}

export function NewContactDialog({
  firstName, onFirstName, lastName, onLastName, countryCode, onCountryCode,
  phone, onPhone, error, saving, onClose, onSubmit,
}: {
  firstName: string;
  onFirstName: (value: string) => void;
  lastName: string;
  onLastName: (value: string) => void;
  countryCode: string;
  onCountryCode: (value: string) => void;
  phone: string;
  onPhone: (value: string) => void;
  error: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return <div className="wa-backdrop">
    <form className="wa-modal new-contact-modal" role="dialog" aria-modal="true" aria-labelledby="new-contact-title"
      onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      <header><h2 id="new-contact-title">Adicionar novo contato</h2><button type="button" onClick={onClose} aria-label="Fechar"><X/></button></header>
      <div className="new-contact-fields">
        <p>Por favor adicione o nome e número de WhatsApp do contato que você deseja criar.</p>
        <input autoFocus aria-label="Primeiro nome" autoComplete="given-name" maxLength={80} value={firstName} onChange={event => onFirstName(event.target.value)} placeholder="Primeiro nome" />
        <input aria-label="Segundo nome" autoComplete="family-name" maxLength={80} value={lastName} onChange={event => onLastName(event.target.value)} placeholder="Segundo nome" />
        <div className="new-contact-phone"><select aria-label="Código do país" value={countryCode} onChange={event => onCountryCode(event.target.value)}><option value="55">🇧🇷 +55</option><option value="1">🇺🇸 +1</option><option value="351">🇵🇹 +351</option><option value="34">🇪🇸 +34</option><option value="54">🇦🇷 +54</option></select><input aria-label="Número do WhatsApp com DDD" type="tel" inputMode="tel" autoComplete="tel-national" maxLength={20} value={phone} onChange={event => onPhone(event.target.value)} placeholder="DDD + número" /></div>
        {error && <p className="new-contact-error" role="alert">{error}</p>}
      </div>
      <button type="submit" className="wa-primary" disabled={saving}>{saving ? "Criando…" : "Criar contato"}</button>
    </form>
  </div>;
}
