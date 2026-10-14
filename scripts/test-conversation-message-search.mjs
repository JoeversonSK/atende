import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationMessageSearch } from "../app/conversations/components/conversation-message-search.tsx";
import {
  loadedSearchMessageId,
  searchConversationMessages,
  searchLoadedMessages,
  searchSnippetText,
} from "../app/conversations/conversation-message-search.ts";

const config = { baseUrl: "http://atende.test", apiKey: "teste", sessionId: "sessao-1" };

test("campo da busca não exibe texto auxiliar nem botão de fechar duplicado", () => {
  const html = renderToStaticMarkup(createElement(ConversationMessageSearch, {
    chatId: "cliente@c.us", chatName: "Cliente", config, messages: [],
    onClose: () => {}, onClearMatch: () => {}, onSelect: () => false,
  }));
  assert.match(html, /Buscar nesta conversa/);
  assert.doesNotMatch(html, /Busque no histórico da conversa|wa-conversation-search-status|wa-conversation-search-close/);
});

test("pesquisa apenas na sessão e conversa selecionadas, com paginação", async () => {
  const originalFetch = globalThis.fetch;
  let requested;
  globalThis.fetch = async (url, init) => {
    requested = { url: new URL(url), init };
    return Response.json({ hits: [], total: 0 });
  };
  try {
    assert.deepEqual(await searchConversationMessages(config, "cliente@c.us", "nota fiscal", 50), { hits: [], total: 0 });
    assert.equal(requested.url.pathname, "/api/search");
    assert.equal(requested.url.searchParams.get("q"), "nota fiscal");
    assert.equal(requested.url.searchParams.get("sessionId"), "sessao-1");
    assert.equal(requested.url.searchParams.get("chatId"), "cliente@c.us");
    assert.equal(requested.url.searchParams.get("limit"), "50");
    assert.equal(requested.url.searchParams.get("offset"), "50");
    assert.equal(requested.init.method, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("localiza um resultado pelo ID do WhatsApp ou pelo ID salvo", () => {
  const messages = [
    { id: "mensagem-visivel", waMessageId: "wa-1", identityIds: ["mensagem-visivel", "wa-1"] },
    { id: "mensagem-salva", identityIds: ["db-2"] },
  ];
  assert.equal(loadedSearchMessageId(messages, { messageId: "db-1", waMessageId: "wa-1" }), "mensagem-visivel");
  assert.equal(loadedSearchMessageId(messages, { messageId: "db-2", waMessageId: "" }), "mensagem-salva");
  assert.equal(loadedSearchMessageId(messages, { messageId: "db-3", waMessageId: "wa-3" }), null);
});

test("encontra texto visível no histórico ao vivo mesmo sem registro no índice", () => {
  const messages = [
    { id: "ao-vivo-1", waMessageId: "wa-1", identityIds: ["wa-1"],
      body: "Tem o relógio físico Blue", time: "08/09 · 14:56", timestamp: 1790000000000, mine: true },
    { id: "ao-vivo-2", body: "Outra mensagem", time: "08/09 · 14:57", mine: false },
  ];
  const hits = searchLoadedMessages(messages, "tem");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].messageId, "ao-vivo-1");
  assert.equal(hits[0].source, "loaded");
  assert.equal(loadedSearchMessageId(messages, hits[0]), "ao-vivo-1");
  assert.equal(searchLoadedMessages(messages, "RELOGIO").length, 1);
  assert.deepEqual(searchLoadedMessages(messages, "t"), []);
});

test("mostra trechos como texto, sem interpretar tags de destaque", () => {
  assert.equal(searchSnippetText("pedido <mark>confirmado</mark>"), "pedido confirmado");
});
