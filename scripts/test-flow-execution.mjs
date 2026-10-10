import assert from "node:assert/strict";
import test from "node:test";
import { executeConversationFlow } from "../app/conversations/flow-execution.ts";
import { linkedFlowCnpjs } from "../app/conversations/flow-variables.ts";

const config = { baseUrl: "http://atende.test", apiKey: "teste", sessionId: "sessao" };
const flow = (kind, steps) => ({ id: "fluxo", name: "Teste", description: "", active: true, kind, steps, pollOptions: [] });
const fill = value => (value || "").replaceAll("{{cliente}}", "Maria");

test("atribui uma vez, envia mensagem assinada e encerra na ordem dos blocos", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const effects = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
    if (path.endsWith("/start")) return Response.json({ assignment: { assigneeName: "Ana" }, data: { status: "open" } });
    if (path.endsWith("/close")) return Response.json({ data: { status: "closed" } });
    return Response.json({ messageId: "mensagem-1" });
  };
  try {
    const result = await executeConversationFlow({
      config, chatId: "cliente@c.us", operatorName: "Ana", fill,
      flow: flow("start", [
        { id: "1", type: "action", action: "assign-current" },
        { id: "2", type: "message", text: "Olá, {{cliente}}" },
        { id: "3", type: "action", action: "close-ticket" },
      ]),
      onAssigned: started => effects.push(["assigned", started.data.status]),
      onClosed: (data, evaluation) => effects.push(["closed", data.status, evaluation]),
    });
    assert.deepEqual(calls.map(call => call.path.split("/").at(-1)), ["start", "send-text", "close"]);
    assert.equal(calls[1].body.text, "*Ana:*\nOlá, Maria");
    assert.deepEqual(effects, [["assigned", "open"], ["closed", "closed", false]]);
    assert.deepEqual(result, { assignedByFlow: true, closedByFlow: true, waitingForAnswer: false, evaluation: false });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("enquete grava continuação preenchida e aguarda resposta sem enviar blocos seguintes", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: JSON.parse(init.body) });
    return Response.json(path.endsWith("send-poll") ? { messageId: "enquete-1" } : { success: true });
  };
  try {
    const result = await executeConversationFlow({
      config, chatId: "cliente@c.us", operatorName: "Ana", fill,
      flow: flow("regular", [
        { id: "1", type: "poll", question: "Escolha, {{cliente}}", options: ["Sim", "Não"] },
        { id: "2", type: "message", text: "Obrigada, {{cliente}}" },
        { id: "3", type: "image", data: "aW1hZ2Vt", caption: "Foto de {{cliente}}" },
      ]),
      onAssigned: () => assert.fail("não deve atribuir"),
      onClosed: () => assert.fail("não deve encerrar"),
    });
    assert.deepEqual(calls.map(call => call.path.split("/").at(-1)), ["send-poll", "flow-continuation"]);
    assert.deepEqual(calls[0].body, {
      chatId: "cliente@c.us", name: "Escolha, Maria", options: ["Sim", "Não"], allowMultipleAnswers: false,
    });
    assert.equal(calls[1].body.pollMessageId, "enquete-1");
    assert.deepEqual(calls[1].body.expectedOptions, ["Sim", "Não"]);
    assert.equal(calls[1].body.steps[0].text, "*Ana:*\nObrigada, Maria");
    assert.equal(calls[1].body.steps[1].caption, "*Ana:*\nFoto de Maria");
    assert.equal(result.waitingForAnswer, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("avaliação encerra pelo endpoint próprio sem executar os blocos", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(new URL(url).pathname);
    return Response.json({ data: { status: "closed" } });
  };
  try {
    const effects = [];
    const result = await executeConversationFlow({
      config, chatId: "cliente@c.us", operatorName: "Ana", fill,
      flow: flow("evaluation", [{ id: "1", type: "message", text: "não enviar" }]),
      onAssigned: () => assert.fail("não deve atribuir"),
      onClosed: (data, evaluation) => effects.push([data.status, evaluation]),
    });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].endsWith("/evaluation"));
    assert.deepEqual(effects, [["closed", true]]);
    assert.equal(result.evaluation, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("erro no envio interrompe o fluxo antes do próximo bloco", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ message: "Falha de envio" }, { status: 500 });
  };
  try {
    await assert.rejects(executeConversationFlow({
      config, chatId: "cliente@c.us", operatorName: "Ana", fill,
      flow: flow("regular", [
        { id: "1", type: "message", text: "Primeira" },
        { id: "2", type: "message", text: "Segunda" },
      ]),
      onAssigned: () => {}, onClosed: () => {},
    }), /Falha de envio/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bloco de planilha usa a API protegida e interrompe o fluxo se a atualização falhar", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    calls.push(path);
    return path.includes("flow-sheet")
      ? Response.json({ message: "Linha ambígua" }, { status: 409 })
      : Response.json({ messageId: "mensagem-1" });
  };
  try {
    await assert.rejects(executeConversationFlow({
      config, chatId: "cliente@c.us", operatorName: "Ana", fill,
      flow: flow("regular", [
        { id: "planilha", type: "sheet" },
        { id: "texto", type: "message", text: "Não enviar" },
      ]), onAssigned: () => {}, onClosed: () => {},
    }), /Linha ambígua/);
    assert.deepEqual(calls, ["/api/operator-auth/contacts/sessao/cliente%40c.us/flow-sheet/fluxo/planilha"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("enquete conserva a referência segura do bloco de planilha na continuação", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
    return Response.json({ messageId: "enquete-1" });
  };
  try {
    await executeConversationFlow({
      config, chatId: "cliente@c.us", operatorName: "Ana", fill,
      flow: flow("regular", [
        { id: "enquete", type: "poll", question: "Escolha", options: ["Sim", "Não"] },
        { id: "planilha", type: "sheet", lookupValue: "{{cliente}}" },
      ]), onAssigned: () => {}, onClosed: () => {},
    });
    assert.equal(calls[1].body.steps[0].flowId, "fluxo");
    assert.equal(calls[1].body.steps[0].lookupValue, "{{cliente}}");
  } finally { globalThis.fetch = originalFetch; }
});

test("consolida CNPJs vinculados e legados sem duplicar", () => {
  assert.deepEqual(linkedFlowCnpjs({cnpjs:["12.345.678/0001-90","12345678000190"],
    document:"98.765.432/0001-10",custom:[{label:"CNPJ",value:"11.222.333/0001-44"}]}),
  ["12345678000190","98765432000110","11222333000144"]);
});

test("bloco de finalização envia somente os CNPJs escolhidos para a API", async () => {
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (url,init)=>{calls.push({path:new URL(url).pathname,body:JSON.parse(init.body||"{}")});return Response.json({success:true});};
  try {
    await executeConversationFlow({config,chatId:"cliente@c.us",operatorName:"Ana",fill,
      selectedCnpjs:["12345678000190"],flow:flow("regular",[{id:"finalizar",type:"monthly-complete"}]),
      onAssigned:()=>{},onClosed:()=>{}});
    assert.deepEqual(calls,[{path:"/api/operator-auth/contacts/sessao/cliente%40c.us/flow-sheet/fluxo/finalizar",
      body:{selectedCnpjs:["12345678000190"]}}]);
  } finally {globalThis.fetch=originalFetch;}
});
