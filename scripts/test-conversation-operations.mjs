import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionRecord, resolveSessionId, restoreSessionIfNeeded, startSessionAndReadQr,
} from "../app/conversations/session-connection.ts";
import {
  assignConversation, closeTicket, listAssignments, readAssignment, removeAssignment,
} from "../app/conversations/ticket-actions.ts";

const config = { baseUrl: "http://atende.test", apiKey: "teste", sessionId: "sessao" };

test("descobre sessão existente sem criá-la e só restaura quando desconectada", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({ path, method: init?.method || "GET" });
    if (path === "/api/health") return Response.json({ status: "ok" });
    if (path === "/api/sessions?limit=100") return Response.json([{ id: "sessao" }]);
    if (path === "/api/sessions/sessao" ) return Response.json({ status: "disconnected" });
    return Response.json({ success: true });
  };
  try {
    const sessionId = await resolveSessionId({ ...config, sessionId: "" });
    assert.equal(sessionId, "sessao");
    let restoring = 0;
    await restoreSessionIfNeeded({ ...config, sessionId }, () => restoring++);
    assert.equal(restoring, 1);
    assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), [
      "GET /api/health", "GET /api/sessions?limit=100",
      "GET /api/sessions/sessao", "POST /api/sessions/sessao/start",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mantém sessão conectada sem reinício e lê QR após a criação", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init?.method || "GET", body: init?.body ? JSON.parse(init.body) : null });
    if (path === "/api/health") return Response.json({ status: "ok" });
    if (path === "/api/sessions/sessao") return Response.json({ status: "connected" });
    if (path === "/api/sessions" && init?.method === "POST") return Response.json({ id: "nova" });
    if (path === "/api/sessions/nova/qr") return Response.json({ qrCode: "codigo-qr" });
    return Response.json({ success: true });
  };
  try {
    assert.equal(await resolveSessionId(config), "sessao");
    let restoring = 0;
    await restoreSessionIfNeeded(config, () => restoring++);
    assert.equal(restoring, 0);
    const created = await createSessionRecord(config, 123);
    assert.equal(created.sessionId, "nova");
    assert.equal(await startSessionAndReadQr(created), "codigo-qr");
    assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), [
      "GET /api/health", "GET /api/sessions/sessao", "POST /api/sessions",
      "POST /api/sessions/nova/start", "GET /api/sessions/nova/qr",
    ]);
    assert.deepEqual(calls[2].body, { name: "atende-123" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("atribuição e encerramento preservam os dados retornados pela API", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    const method = init?.method || "GET";
    calls.push({ path, method, body: init?.body ? JSON.parse(init.body) : null });
    if (method === "GET") return Response.json({ assigneeName: "Ana", assigneeId: "1" });
    if (method === "PUT") return Response.json({
      assigneeName: "Bia", assigneeId: "2", reopened: true,
      profileData: { name: "Cliente", status: "open" },
    });
    if (path.endsWith("/close")) return Response.json({ data: { name: "Cliente", status: "closed" } });
    return Response.json({ success: true });
  };
  try {
    assert.deepEqual(await readAssignment(config, "cliente@c.us"), { assigneeName: "Ana", assigneeId: "1" });
    const assigned = await assignConversation(config, "cliente@c.us", "Bia", "2");
    assert.equal(assigned.reopened, true);
    assert.equal(assigned.profileData.name, "Cliente");
    await removeAssignment(config, "cliente@c.us");
    assert.deepEqual(await closeTicket(config, "cliente@c.us"), { name: "Cliente", status: "closed" });
    assert.deepEqual(calls.map(call => call.method), ["GET", "PUT", "DELETE", "POST"]);
    assert.ok(calls[0].path.endsWith("/conversations/cliente%40c.us/assignment"));
    assert.deepEqual(calls[1].body, { assigneeName: "Bia", assigneeId: "2" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("erro de atribuição não é tratado como sucesso", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message: "Sem permissão" }, { status: 403 });
  try {
    assert.equal(await readAssignment(config, "cliente@c.us"), undefined);
    await assert.rejects(assignConversation(config, "cliente@c.us", "Ana", "1"), /Sem permissão/);
    await assert.rejects(removeAssignment(config, "cliente@c.us"), /Sem permissão/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("consulta as atribuições sem alterar dados quando a API não responde", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{ chatId: "cliente@c.us", assigneeName: "Ana" }]);
  try {
    assert.deepEqual(await listAssignments(config), [{ chatId: "cliente@c.us", assigneeName: "Ana" }]);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    assert.equal(await listAssignments(config), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
