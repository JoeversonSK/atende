import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TicketDashboard } from "../app/ticket-dashboard.tsx";

test("encaminhado permanece na fila, não conta como ativo e mostra o destino", () => {
  const chatId = "5511999999999@c.us";
  const html = renderToStaticMarkup(createElement(TicketDashboard, {
    chats: [{ id: chatId, name: "Cliente de teste" }],
    owners: { [chatId]: { assigneeId: "agent-2", assigneeName: "Fabio - Estagiário", state: "forwarded",
      updatedAt: new Date().toISOString() } },
    overview: {
      contacts: [{ chatId, data: { status: "open" } }],
      agents: [{ id: "agent-2", displayName: "Fabio - Estagiário" }],
      activity: [{ chatId, name: "Cliente de teste", incoming: null, outgoing: null,
        waitingSince: null, queueSince: String(Math.floor(Date.now() / 1000)) }],
      completed: [], onsiteActive: [],
    },
    onOpen: () => {},
  }));
  assert.match(html, /Nenhum atendimento em andamento/);
  assert.match(html, /Encaminhado/);
  assert.match(html, /class="board-forwarded-inline" title="Encaminhado para Fabio - Estagiário"><span class="board-queue-state forwarded">Encaminhado<\/span><span class="board-forwarded-to">para<\/span><strong class="board-forwarded-name">Fabio<\/strong><\/span>/);
  assert.doesNotMatch(html, /Fabio - Estagiário<\/strong>/);
  assert.match(html, /Cliente de teste/);
  assert.match(html, /title="Abrir conversa com Cliente de teste e atribuir atendente"/);
});

test("após assumir, deixa a fila e aparece em atendimento", () => {
  const chatId = "5511999999999@c.us";
  const html = renderToStaticMarkup(createElement(TicketDashboard, {
    chats: [{ id: chatId, name: "Cliente de teste" }],
    owners: { [chatId]: { assigneeId: "agent-2", assigneeName: "Bia", state: "active",
      updatedAt: new Date().toISOString() } },
    overview: {
      contacts: [{ chatId, data: { status: "open" } }],
      agents: [{ id: "agent-2", displayName: "Bia" }],
      activity: [{ chatId, name: "Cliente de teste", incoming: null, outgoing: null,
        waitingSince: null, queueSince: null }],
      completed: [], onsiteActive: [],
    },
    onOpen: () => {},
  }));
  assert.doesNotMatch(html, /Nenhum atendimento em andamento/);
  assert.match(html, /Nenhum cliente na fila/);
  assert.match(html, /title="Abrir conversa com Cliente de teste e encaminhar atendimento"/);
  assert.match(html, /title="Prioridade normal">Normal<\/span>/);
});

test("em atendimento mostra só o primeiro nome do analista em conversas e visitas", () => {
  const chatId = "5511999999999@c.us";
  const html = renderToStaticMarkup(createElement(TicketDashboard, {
    chats: [{ id: chatId, name: "Cliente de teste" }],
    owners: { [chatId]: { assigneeId: "agent-2", assigneeName: "Wesley - Coordenador de Suporte",
      state: "active", updatedAt: new Date().toISOString() } },
    overview: {
      contacts: [{ chatId, data: { status: "open" } }],
      agents: [
        { id: "agent-2", displayName: "Wesley - Coordenador de Suporte" },
        { id: "agent-3", displayName: "Fabio - Estagiário" },
      ],
      activity: [], completed: [],
      onsiteActive: [{ id: "visit-1", assigneeId: "agent-3", assigneeName: "Fabio - Estagiário",
        clientName: "Cliente presencial", startedAt: new Date().toISOString() }],
    },
    onOpen: () => {},
  }));
  const activeSection = html.slice(html.indexOf('id="active-heading"'), html.indexOf('id="queue-heading"'));
  assert.match(activeSection, /<td><strong title="Wesley - Coordenador de Suporte">Wesley<\/strong><\/td>/);
  assert.match(activeSection, /<td><strong title="Fabio - Estagiário">Fabio<\/strong><\/td>/);
  assert.doesNotMatch(activeSection, /<strong[^>]*>Wesley - Coordenador de Suporte<\/strong>/);
});
