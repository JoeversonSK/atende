import assert from "node:assert/strict";
import test from "node:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationSidebar } from "../app/conversations/components/conversation-sidebar.tsx";

const chat = { id: "5511999999999@c.us", name: "Cliente de teste", last: "Olá", time: "10:28", unread: 0 };

function render(assignments = {}, currentChat = chat) {
  return renderToStaticMarkup(createElement(ConversationSidebar, {
    search: "", setSearch: () => {}, filter: "all", setFilter: () => {}, tagFilter: "", setTagFilter: () => {},
    filterMenuOpen: false, setFilterMenuOpen: () => {}, filterMenuPage: "main", setFilterMenuPage: () => {},
    filterPopoverRef: createRef(), availableChatTags: [], shownChats: [currentChat], chats: [currentChat],
    selectedId: "", assignments, syncWarning: "", hasSession: true, onChooseChat: () => {},
  }));
}

test("destaca o nome completo do atendente e mostra o ícone junto ao nome", () => {
  const html = render({ [chat.id]: { assigneeId: "agent-1", assigneeName: "Wesley - Coordenador de Suporte", state: "active" } });
  assert.match(html, /chat-owner-icon/);
  assert.match(html, /chat-owner-label assigned active/);
  assert.match(html, /<strong>Wesley - Coordenador de Suporte<\/strong><small>Em atendimento<\/small>/);
  assert.doesNotMatch(html, /wa-chat-meta/);
});

test("distingue encaminhado de atendimento iniciado", () => {
  const html = render({ [chat.id]: { assigneeId: "agent-2", assigneeName: "Bia", state: "forwarded" } });
  assert.match(html, /chat-owner-label assigned forwarded/);
  assert.match(html, /<strong>Bia<\/strong><small>Encaminhado<\/small>/);
});

test("sinaliza em vermelho atribuições para Sabrina sem alterar outros responsáveis", () => {
  const active = render({ [chat.id]: { assigneeName: "Sabrina - Financeiro", state: "active" } });
  const forwarded = render({ [chat.id]: { assigneeName: "sabrina", state: "forwarded" } });
  const other = render({ [chat.id]: { assigneeName: "Sabrinara", state: "active" } });
  assert.match(active, /chat-owner-icon financial-alert/);
  assert.match(active, /Cliente com pendência financeira/);
  assert.match(forwarded, /chat-owner-icon financial-alert/);
  assert.doesNotMatch(other, /chat-owner-icon financial-alert/);
});

test("não mostra o boneco de atribuição em conversa sem responsável ou grupo", () => {
  assert.doesNotMatch(render(), /chat-owner-icon/);
  assert.match(render(), /Sem responsável/);
  const group = { ...chat, id: "123456789@g.us", isGroup: true };
  assert.doesNotMatch(render({ [group.id]: { assigneeName: "Bia" } }, group), /chat-owner-icon/);
});
