"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { ArrowLeft, Check, ChevronRight, Filter, MessageCircle, Search, UserRound, X } from "lucide-react";
import type { Chat } from "../../conversation-model";
import { ContactAvatar } from "./contact-avatar";

type FilterValue = "all" | "unread" | "mine";
type Assignment = { assigneeName: string; assigneeId?: string; updatedAt?: string };

export type ConversationSidebarProps = {
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  filter: FilterValue;
  setFilter: Dispatch<SetStateAction<FilterValue>>;
  tagFilter: string;
  setTagFilter: Dispatch<SetStateAction<string>>;
  filterMenuOpen: boolean;
  setFilterMenuOpen: Dispatch<SetStateAction<boolean>>;
  filterMenuPage: "main" | "tags";
  setFilterMenuPage: Dispatch<SetStateAction<"main" | "tags">>;
  filterPopoverRef: RefObject<HTMLDivElement | null>;
  availableChatTags: string[];
  shownChats: Chat[];
  chats: Chat[];
  selectedId?: string;
  assignments: Record<string, Assignment>;
  syncWarning: string;
  hasSession: boolean;
  onChooseChat: (chat: Chat) => void;
};

export function ConversationSidebar({
  search, setSearch, filter, setFilter, tagFilter, setTagFilter,
  filterMenuOpen, setFilterMenuOpen, filterMenuPage, setFilterMenuPage,
  filterPopoverRef, availableChatTags, shownChats, chats, selectedId,
  assignments, syncWarning, hasSession, onChooseChat,
}: ConversationSidebarProps) {
  return <aside className="wa-sidebar">
    <div className="wa-search-bar">
      <label><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)}
        aria-label="Buscar contato ou número" placeholder="Buscar contato ou número…" /></label>
      <div className="wa-filter-control" ref={filterPopoverRef}>
        <button className={tagFilter ? "active" : ""} onClick={() => {
          setFilterMenuOpen(open => !open);
          if (filterMenuOpen) setFilterMenuPage("main");
        }} aria-label="Adicionar filtros" aria-expanded={filterMenuOpen}>
          <Filter size={18} />{tagFilter && <i aria-hidden="true" />}
        </button>
        {filterMenuOpen && <section className="wa-filter-popover" aria-label="Filtros das conversas">
          <header>
            {filterMenuPage === "tags" && <button className="wa-filter-back" onClick={() => setFilterMenuPage("main")}
              aria-label="Voltar aos filtros"><ArrowLeft size={16} /></button>}
            <span>{filterMenuPage === "main" ? "ADICIONAR FILTROS" : "ETIQUETA"}</span>
            <button className="wa-filter-close" onClick={() => { setFilterMenuOpen(false); setFilterMenuPage("main"); }}
              aria-label="Fechar filtros"><X size={15} /></button>
          </header>
          {filterMenuPage === "main" ? <button className="wa-filter-option" onClick={() => setFilterMenuPage("tags")}>
            <span><b>Etiqueta</b>{tagFilter && <small>{tagFilter}</small>}</span><ChevronRight size={18} />
          </button> : <div className="wa-filter-tag-list">
            <button className={!tagFilter ? "selected" : ""} onClick={() => {
              setTagFilter(""); setFilterMenuOpen(false); setFilterMenuPage("main");
            }}><span>Todas as etiquetas</span>{!tagFilter && <Check size={16} />}</button>
            {availableChatTags.map(tag => <button key={tag} className={tagFilter === tag ? "selected" : ""}
              onClick={() => { setTagFilter(tag); setFilterMenuOpen(false); setFilterMenuPage("main"); }}>
              <span>{tag}</span>{tagFilter === tag && <Check size={16} />}
            </button>)}
            {!availableChatTags.length && <p>Nenhuma etiqueta cadastrada.</p>}
          </div>}
        </section>}
      </div>
    </div>
    <div className="wa-filters" aria-label="Filtrar conversas">
      {([ ["all", "Todas"], ["unread", "Não lidas"], ["mine", "Minhas"] ] as const).map(([value, label]) =>
        <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""}
          onClick={() => setFilter(value)}>{label}
          {value === "unread" && chats.some(chat => chat.unread > 0) &&
            <span>{chats.filter(chat => chat.unread > 0).length}</span>}
        </button>)}
      {tagFilter && <button className="wa-applied-filter active" onClick={() => setTagFilter("")}
        title="Remover filtro de etiqueta">Etiqueta: {tagFilter}<X size={12} /></button>}
    </div>
    <div className="list-caption"><span>{shownChats.length} conversa{shownChats.length === 1 ? "" : "s"}</span><span>MAIS RECENTES</span></div>
    {syncWarning && <p className="sync-warning" role="status">{syncWarning}</p>}
    <div className="wa-chat-list">
      {shownChats.length ? shownChats.map(chat => <button key={chat.id} onClick={() => onChooseChat(chat)}
        aria-pressed={selectedId === chat.id}
        className={`wa-chat ${selectedId === chat.id ? "selected" : ""} ${chat.unread ? "has-unread" : ""}`}>
        <ContactAvatar chat={chat} />
        <span className="wa-chat-copy">
          <span><b>{chat.name}</b><time className={chat.unread ? "unread-time" : ""}>{chat.time}</time></span>
          <span><i>{chat.last}</i>
            {assignments[chat.id] && <span className="wa-owner-marker"
              title={`Atribuído para ${assignments[chat.id].assigneeName}`}
              aria-label={`Atribuído para ${assignments[chat.id].assigneeName}`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="7" r="4" /><path d="M4 21v-3a8 8 0 0 1 16 0v3Z" />
              </svg>
            </span>}
            {chat.unread > 0 && <em>{chat.unread > 99 ? "99+" : chat.unread}</em>}
          </span>
          <span className={`chat-owner-label ${assignments[chat.id] ? "assigned" : ""}`}>
            <UserRound size={11} />{assignments[chat.id]?.assigneeName || "Sem responsável"}
          </span>
        </span>
      </button>) : <div className="wa-list-empty"><MessageCircle size={28} />
        <p>{hasSession ? "Nenhuma conversa encontrada." : "Conecte o OpenWA para ver as conversas."}</p>
      </div>}
    </div>
  </aside>;
}
