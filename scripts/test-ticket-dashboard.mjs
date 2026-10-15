import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TicketDashboard } from "../app/ticket-dashboard.tsx";

test("encaminhado permanece na fila, não conta como ativo e mostra o destino", () => {
  const chatId = "5511999999999@c.us";
  const html = renderToStaticMarkup(createElement(TicketDashboard, {
    chats: [{ id: chatId, name: "Cliente de teste" }],
    owners: { [chatId]: { assigneeId: "agent-2", assigneeName: "Bia", state: "forwarded",
      updatedAt: new Date().toISOString() } },
    overview: {
      contacts: [{ chatId, data: { status: "open" } }],
      agents: [{ id: "agent-2", displayName: "Bia" }],
      activity: [{ chatId, name: "Cliente de teste", incoming: null, outgoing: null,
        waitingSince: null, queueSince: String(Math.floor(Date.now() / 1000)) }],
      completed: [], onsiteActive: [],
    },
    onOpen: () => {},
  }));
  assert.match(html, /Nenhum atendimento em andamento/);
  assert.match(html, /Encaminhado/);
  assert.match(html, /Para Bia/);
  assert.match(html, /class="board-forwarded-to"[^>]*>Para <strong>Bia<\/strong>/);
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
