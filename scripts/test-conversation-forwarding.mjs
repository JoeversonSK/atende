import assert from "node:assert/strict";
import test from "node:test";
import { forwardMessageToContacts } from "../app/conversations/conversation-forwarding.ts";

const config = { baseUrl: "http://atende.test", apiKey: "teste", sessionId: "sessao" };

test("encaminha em sequência e mantém apenas os destinatários que falharam", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body });
    return body.toChatId === "segundo@c.us"
      ? Response.json({ message: "Acesso restrito ao atendimento." }, { status: 403 })
      : Response.json({ messageId: "enviada" });
  };
  try {
    const result = await forwardMessageToContacts(config, "origem@c.us", "msg-1",
      ["primeiro@c.us", "segundo@c.us", "terceiro@c.us"], id => id === "segundo@c.us" ? "Segundo" : id);
    assert.deepEqual(calls.map(call => call.body.toChatId),
      ["primeiro@c.us", "segundo@c.us", "terceiro@c.us"]);
    assert.ok(calls.every(call => call.url.endsWith("/sessions/sessao/messages/forward")));
    assert.ok(calls.every(call => call.body.fromChatId === "origem@c.us" && call.body.messageId === "msg-1"));
    assert.deepEqual(result, {
      delivered: 2,
      failed: [{ id: "segundo@c.us", name: "Segundo", reason: "Acesso restrito ao atendimento." }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uma falha de rede não interrompe os outros destinatários", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    if (JSON.parse(init.body).toChatId === "primeiro@c.us") throw new TypeError("Rede indisponível");
    return Response.json({ messageId: "enviada" });
  };
  try {
    const result = await forwardMessageToContacts(config, "origem@c.us", "msg-2",
      ["primeiro@c.us", "segundo@c.us"], id => id);
    assert.equal(result.delivered, 1);
    assert.deepEqual(result.failed, [{ id: "primeiro@c.us", name: "primeiro@c.us", reason: "Rede indisponível" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
