"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { ApiConfig } from "../../atende-api";
import type { Message } from "../../conversation-model";
import {
  loadedSearchMessageId,
  searchConversationMessages,
  searchLoadedMessages,
  searchSnippetText,
  type ConversationSearchHit,
  type MessageSearchHit,
} from "../conversation-message-search";

type Props = {
  chatId: string;
  chatName: string;
  config: ApiConfig;
  messages: Message[];
  onClose: () => void;
  onClearMatch: () => void;
  onSelect: (hit: MessageSearchHit) => boolean;
};

export function ConversationMessageSearch({ chatId, chatName, config, messages, onClose, onClearMatch, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [savedHits, setSavedHits] = useState<MessageSearchHit[]>([]);
  const [savedTotal, setSavedTotal] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedInThread, setSelectedInThread] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const moreAbortRef = useRef<AbortController | null>(null);
  const searchText = query.trim();
  const loadedHits = useMemo(() => searchLoadedMessages(messages, searchText), [messages, searchText]);
  const olderHits = useMemo(() => savedHits
    .filter(hit => !loadedSearchMessageId(messages, hit))
    .map(hit => ({ ...hit, source: "saved" as const })), [savedHits, messages]);
  const results: ConversationSearchHit[] = [
    ...loadedHits.slice(-visibleLimit).reverse(),
    ...olderHits,
  ];
  const selectedHit = results.find(hit => `${hit.source}:${hit.messageId}` === selectedId);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (searchText.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchConversationMessages(config, chatId, searchText, 0, controller.signal)
        .then(page => {
          if (controller.signal.aborted) return;
          setSavedHits(page.hits);
          setSavedTotal(page.total);
          setError("");
        })
        .catch(cause => {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível pesquisar mensagens antigas.");
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [config, chatId, searchText]);
  useEffect(() => () => { moreAbortRef.current?.abort(); }, []);

  function changeQuery(value: string) {
    moreAbortRef.current?.abort();
    setQuery(value);
    setSavedHits([]);
    setSavedTotal(0);
    setVisibleLimit(50);
    setLoading(value.trim().length >= 2);
    setLoadingMore(false);
    setError("");
    setSelectedId("");
    setSelectedInThread(false);
    onClearMatch();
  }

  function select(hit: ConversationSearchHit) {
    setSelectedId(`${hit.source}:${hit.messageId}`);
    setSelectedInThread(onSelect(hit));
  }

  async function loadMore() {
    if (loadingMore || savedHits.length >= savedTotal) return;
    const controller = new AbortController();
    moreAbortRef.current = controller;
    setLoadingMore(true);
    try {
      const page = await searchConversationMessages(config, chatId, searchText, savedHits.length, controller.signal);
      if (controller.signal.aborted) return;
      setSavedHits(current => [...current, ...page.hits]);
      setSavedTotal(page.total);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível carregar mais resultados.");
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  return <section className="wa-conversation-search" role="search" aria-label={`Buscar mensagens de ${chatName}`}>
    <div className="wa-conversation-search-input">
      <Search size={17} aria-hidden="true" />
      <input ref={inputRef} type="text" value={query} onChange={event => changeQuery(event.target.value)}
        placeholder="Buscar nesta conversa" aria-label="Buscar nesta conversa"
        onKeyDown={event => {
          if (event.key === "Escape") onClose();
          if (event.key === "Enter" && results.length) select(results[0]);
        }} />
      {query && <button type="button" className="wa-conversation-search-clear" onClick={() => { changeQuery(""); inputRef.current?.focus(); }}
        aria-label="Limpar pesquisa" title="Limpar pesquisa"><X size={14} /></button>}
    </div>
    {searchText.length >= 2 && <>
      {error && <p className="wa-conversation-search-warning">{loadedHits.length ? "As mensagens carregadas continuam pesquisáveis. " : ""}{error}</p>}
      {!results.length && !error && <p className="wa-conversation-search-empty" role="status" aria-live="polite">
        {loading ? "Buscando mensagens…" : "Nenhuma mensagem encontrada nesta conversa."}
      </p>}
      {results.length > 0 && <div className="wa-conversation-search-results">
        {results.map(hit => <button key={`${hit.source}:${hit.messageId}`} type="button"
          className={`wa-conversation-search-result ${selectedId === `${hit.source}:${hit.messageId}` ? "active" : ""}`}
          onClick={() => select(hit)}>
          <span><b>{hit.direction === "outgoing" ? "Você" : chatName}</b>
            <time>{hit.timeLabel || (hit.timestamp ? new Date(hit.timestamp).toLocaleString("pt-BR") : "")}</time></span>
          <small>{searchSnippetText(hit.snippet) || hit.body}</small>
        </button>)}
        {loadedHits.length > visibleLimit && <button className="wa-conversation-search-more" type="button" onClick={() => setVisibleLimit(current => current + 50)}>
          <ChevronDown size={16} />Mostrar mais mensagens desta conversa
        </button>}
        {savedHits.length < savedTotal && <button className="wa-conversation-search-more" type="button" onClick={() => { void loadMore(); }} disabled={loadingMore}>
          <ChevronDown size={16} />{loadingMore ? "Carregando…" : "Buscar mais no histórico salvo"}
        </button>}
      </div>}
      {selectedHit && !selectedInThread && <div className="wa-conversation-search-preview">
        <b>Mensagem antiga encontrada</b>
        <p>{selectedHit.body}</p>
        <small>Esta mensagem não está no trecho carregado da conversa; o conteúdo é exibido aqui sem alterar o histórico.</small>
      </div>}
    </>}
  </section>;
}
