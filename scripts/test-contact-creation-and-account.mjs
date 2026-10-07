import assert from "node:assert/strict";
import test from "node:test";
import { prepareNewContact, saveNewContact } from "../app/conversations/contact-creation.ts";
import { confirmChatRead } from "../app/conversations/conversation-sync.ts";
import { authenticateOperator, logoutOperator, updateOperatorName } from "../app/operator-account.ts";

const config = { baseUrl: "http://atende.test", apiKey: "teste", sessionId: "sessao" };

test("normaliza telefone sem duplicar DDI e valida nome e DDD", () => {
  assert.deepEqual(prepareNewContact(" Ana ", " Silva ", "55", "(11) 99999-8888"), {
    id: "5511999998888@c.us", name: "Ana Silva", phone: "5511999998888",
  });
  assert.equal(prepareNewContact("Ana", "", "55", "+55 11 99999-8888").phone, "5511999998888");
  assert.throws(() => prepareNewContact(" ", "Silva", "55", "11999998888"), /primeiro nome/);
  assert.throws(() => prepareNewContact("Ana", "", "55", "123"), /número válido/);
});

test("cadastro preserva campos e revisão existentes do perfil", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    return init.method === "PUT"
      ? Response.json({ data: { name: "Ana Silva", phone: "5511999998888", tags: ["VIP"] } })
      : Response.json({ revision: 7, data: { name: "Antigo", tags: ["VIP"] } });
  };
  try {
    const contact = prepareNewContact("Ana", "Silva", "55", "11999998888");
    const saved = await saveNewContact(config, contact);
    assert.equal(saved.name, "Ana Silva");
    assert.ok(calls[0].url.endsWith("/operator-auth/contacts/sessao/5511999998888%40c.us"));
    assert.deepEqual(calls[1].body, { revision: 7, data: { name: "Ana Silva", phone: "5511999998888", tags: ["VIP"] } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("autenticação, atualização do nome e saída usam as rotas e corpos esperados", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    return Response.json(path.endsWith("/login") || path.endsWith("/register")
      ? { user: { id: "1", displayName: "Ana" }, token: "token" }
      : path.endsWith("/me") ? { id: "1", displayName: "Ana Silva" } : { success: true });
  };
  try {
    assert.equal((await authenticateOperator(config.baseUrl, false, "ana", "", "senha")).token, "token");
    await authenticateOperator(config.baseUrl, true, "ana", "Ana", "senha");
    assert.equal((await updateOperatorName(config.baseUrl, "token", " Ana Silva ")).displayName, "Ana Silva");
    await logoutOperator(config.baseUrl, "token");
    assert.deepEqual(calls.map(call => call.path), [
      "/api/operator-auth/login", "/api/operator-auth/register", "/api/operator-auth/me", "/api/operator-auth/logout",
    ]);
    assert.deepEqual(calls[0].body, { username: "ana", password: "senha" });
    assert.deepEqual(calls[1].body, { username: "ana", displayName: "Ana", password: "senha" });
    assert.deepEqual(calls[2].body, { displayName: "Ana Silva" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("leitura só é confirmada quando o WhatsApp responde com sucesso", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ success: calls.length === 1 });
  };
  try {
    await confirmChatRead(config, "cliente@c.us");
    await assert.rejects(confirmChatRead(config, "cliente@c.us"), /não confirmou a leitura/);
    assert.ok(calls[0].url.endsWith("/sessions/sessao/chats/read"));
    assert.deepEqual(calls[0].body, { chatId: "cliente@c.us" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
