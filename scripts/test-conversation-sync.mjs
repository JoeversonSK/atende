import assert from "node:assert/strict";
import test from "node:test";
import { buildSyncedChats, fetchChatSnapshot, filterVisibleChats } from "../app/conversations/conversation-sync.ts";
import { appendOptimisticText, confirmOptimisticText, discardOptimisticText,
  fetchMessageRecords, reconcileMessageRecords } from "../app/conversations/conversation-history.ts";

const config = { baseUrl: "http://atende.test", apiKey: "teste", sessionId: "sessao" };
const overview = { contacts: [], activity: [], agents: [], completed: [] };

test("carrega todas as páginas antes de entregar a lista", async () => {
  const originalFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname + new URL(url).search;
    paths.push(path);
    if (path.includes("/operator-auth/contacts/")) return Response.json(overview);
    if (path.includes("offset=1000")) return Response.json([{ id: "ultimo@c.us", name: "Último" }]);
    return Response.json(Array.from({ length: 1000 }, (_, index) => ({ id: `${index}@c.us`, name: `Contato ${index}` })));
  };
  try {
    const snapshot = await fetchChatSnapshot(config);
    assert.equal(snapshot.live, true);
    assert.equal(snapshot.records.length, 1001);
    assert.ok(paths.some(path => path.includes("offset=1000")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("usa atividade salva quando a lista ao vivo está indisponível", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes("/operator-auth/contacts/")
    ? Response.json({ ...overview, activity: [{ chatId: "salvo@c.us", name: "Salvo", incoming: "10", outgoing: "11" }] })
    : new Response(null, { status: 503 });
  try {
    const snapshot = await fetchChatSnapshot(config);
    assert.equal(snapshot.live, false);
    assert.deepEqual(snapshot.records, [{ id: "salvo@c.us", name: "Salvo", timestamp: 11, lastMessage: "Histórico salvo" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mantém leitura otimista, avatar e perfil e preserva os grupos", () => {
  const chats = buildSyncedChats({
    records: [
      { id: "cliente@c.us", name: "Nome WhatsApp", unreadCount: 3 },
      { id: "grupo@g.us", name: "Grupo", unreadCount: 2 },
    ],
    overview: { ...overview, contacts: [{ chatId: "cliente@c.us", data: { name: "Nome cadastrado", phone: "5511999999999" } }] },
    pictures: new Map([["cliente@c.us", "/avatar"]]),
    readSnapshot: new Map([["cliente@c.us", 0]]),
    readVersions: new Map([["cliente@c.us", 1]]),
    pendingReads: new Set(),
  });
  assert.equal(chats.length, 2);
  assert.equal(chats[0].name, "Nome cadastrado");
  assert.equal(chats[0].phone, "5511999999999");
  assert.equal(chats[0].avatar, "/avatar");
  assert.equal(chats[0].unread, 0);
  assert.equal(chats[1].name, "Grupo");
  assert.equal(chats[1].isGroup, true);
  assert.equal(chats[1].unread, 2);
});

test("separa grupos de Todas, Não lidas e Minhas sem alterar a busca", () => {
  const chats = [
    { id: "cliente@c.us", name: "Cliente", unread: 2 },
    { id: "outro@c.us", name: "Outro", unread: 0 },
    { id: "equipe@g.us", name: "Equipe", isGroup: true, unread: 3 },
  ];
  const tags = new Map([["cliente@c.us", ["VIP"]]]);
  const assignments = { "cliente@c.us": { assigneeId: "operador" } };
  const visible = (filter, search = "", tag = "") =>
    filterVisibleChats(chats, filter, search, tag, tags, assignments, "operador").map(chat => chat.id);
  assert.deepEqual(visible("all"), ["cliente@c.us", "outro@c.us"]);
  assert.deepEqual(visible("unread"), ["cliente@c.us"]);
  assert.deepEqual(visible("mine"), ["cliente@c.us"]);
  assert.deepEqual(visible("groups"), ["equipe@g.us"]);
  assert.deepEqual(visible("groups", "equi"), ["equipe@g.us"]);
  assert.deepEqual(visible("groups", "", "VIP"), ["equipe@g.us"]);
  assert.deepEqual(visible("all", "", "VIP"), ["cliente@c.us"]);
});

test("recupera mensagens salvas quando o histórico ao vivo falha", async () => {
  const originalFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname + new URL(url).search;
    paths.push(path);
    return path.includes("deep=true")
      ? new Response(null, { status: 503 })
      : Response.json({ messages: [{ id: "salva", body: "Histórico salvo", status: "sent" }] });
  };
  try {
    const result = await fetchMessageRecords(config, "cliente@c.us", true);
    assert.equal(result.fallback, true);
    assert.equal(result.source, "database");
    assert.equal(result.records[0].body, "Histórico salvo");
    assert.ok(paths.some(path => path.includes("deep=true")));
    assert.ok(paths.some(path => path.includes("inlineMedia=true")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserva envio otimista ao substituir o histórico e ignora registros pendentes", () => {
  const optimistic = {
    id: "optimistic-1", identityIds: ["optimistic-1"], body: "Enviando",
    mine: true, time: "", timestamp: 1, type: "text", source: "optimistic",
  };
  const history = reconcileMessageRecords(
    [optimistic],
    [{ id: "recebida", body: "Recebida", timestamp: 2 }],
    "history",
    true,
  );
  assert.equal(history.length, 2);
  assert.ok(history.some(message => message.id === "optimistic-1"));
  const stored = reconcileMessageRecords([], [
    { id: "pending", body: "Ainda não enviada", status: "pending" },
    { id: "sent", body: "Enviada", status: "sent" },
  ], "database");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].body, "Enviada");
});

test("confirma mensagem otimista sem perder resposta vinculada ou outras mensagens", () => {
  const pending = appendOptimisticText([], "Olá", "optimistic-1", 1_000,
    { id: "original", body: "Pergunta" });
  assert.equal(pending[0].source, "optimistic");
  assert.equal(pending[0].quotedMessage.id, "original");
  const confirmed = confirmOptimisticText(pending, "optimistic-1",
    { messageId: "enviada-1", timestamp: 2 }, 1_000);
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].waMessageId, "enviada-1");
  assert.equal(confirmed[0].timestamp, 2_000);
  assert.equal(confirmed[0].quotedMessage.body, "Pergunta");
  assert.ok(confirmed[0].identityIds.includes("optimistic-1"));
  assert.deepEqual(discardOptimisticText(pending, "optimistic-1"), []);
});
