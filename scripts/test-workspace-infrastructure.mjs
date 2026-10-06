import assert from "node:assert/strict";
import { test } from "node:test";
import { operatorJson, operatorRequest } from "../app/atende-api.ts";
import { startPollingSchedule } from "../app/workspace-polling.ts";

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("cliente HTTP preserva rota, token, corpo e erro da API", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(calls.length === 1 ? { ok: true } : { message: ["Campo inválido", "Tente novamente"] }), {
      status: calls.length === 1 ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    assert.deepEqual(await operatorJson("http://localhost:3000/", "token-local", "/me", { method: "PUT", body: "{}" }), { ok: true });
    assert.equal(calls[0].url, "http://localhost:3000/api/operator-auth/me");
    assert.equal(calls[0].init.headers.get("X-Atende-Token"), "token-local");
    assert.equal(calls[0].init.headers.get("Content-Type"), "application/json");
    await assert.rejects(operatorJson("http://localhost:3000", "token-local", "/me"), /Campo inválido Tente novamente/);
    await operatorRequest("http://localhost:3000", null, "/login");
    assert.equal(calls[2].init.headers.has("X-Atende-Token"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("agendador evita consultas sobrepostas e encerra o temporizador", async () => {
  let runs = 0;
  let releaseFirst;
  const first = new Promise(resolve => { releaseFirst = resolve; });
  const schedule = startPollingSchedule([{ id: "team", intervalMs: 20, immediate: true, run: () => {
    runs += 1;
    return runs === 1 ? first : undefined;
  } }]);
  try {
    await wait(85);
    assert.equal(runs, 1);
    releaseFirst();
    await wait(65);
    assert.ok(runs >= 2);
    schedule.stop();
    const finishedRuns = runs;
    await wait(50);
    assert.equal(runs, finishedRuns);
  } finally {
    releaseFirst();
    schedule.stop();
  }
});
