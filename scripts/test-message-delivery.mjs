import assert from "node:assert/strict";
import test from "node:test";
import { deliverMedia, deliverText, signOutgoingText } from "../app/conversations/message-delivery.ts";
import { createFlowTemplate } from "../app/conversations/flow-variables.ts";

const config = { baseUrl: "http://atende.test", apiKey: "teste", sessionId: "sessao" };

test("assinatura ocupa uma linha e preserva parágrafos da mensagem", () => {
  assert.equal(signOutgoingText("Ana", "\nOlá, Maria\n\nTudo bem?"), "*Ana:*\nOlá, Maria\n\nTudo bem?");
});

test("envia texto citado ao endpoint correto", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return Response.json({ messageId: "mensagem-1", timestamp: 123 });
  };
  try {
    const result = await deliverText(config, "cliente@c.us", "Olá", "original-1");
    assert.ok(captured.url.endsWith("/messages/send-text"));
    assert.deepEqual(captured.body, {
      chatId: "cliente@c.us", text: "Olá", quotedMessageId: "original-1",
    });
    assert.equal(result.messageId, "mensagem-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("converte áudio de voz e preserva o sinalizador ptt", async () => {
  const originalFetch = globalThis.fetch;
  const originalFileReader = globalThis.FileReader;
  const calls = [];
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = "data:audio/webm;base64,YXVkaW8=";
      this.onload();
    }
  };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json(String(url).includes("/convert/voice")
      ? { base64: "b2dn", mimetype: "audio/ogg; codecs=opus" }
      : { messageId: "enviada" });
  };
  try {
    await deliverMedia(config, "cliente@c.us", { name: "gravacao.webm", type: "audio/webm" }, true);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].url.endsWith("/media/convert/voice"));
    assert.ok(calls[1].url.endsWith("/messages/send-audio"));
    assert.deepEqual(calls[1].body, {
      chatId: "cliente@c.us", base64: "b2dn",
      mimetype: "audio/ogg; codecs=opus", filename: "mensagem-de-voz.ogg", ptt: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.FileReader = originalFileReader;
  }
});

test("preenche campos do fluxo no fuso de São Paulo", () => {
  const fill = createFlowTemplate(
    "Ana", { id: "cliente@c.us", name: "Nome WhatsApp", phone: "5511999999999", last: "", time: "", unread: 0 },
    { name: "Cliente cadastrado", tags: ["Clipp", "Apolo"], custom: [{ label: "Plano", value: "Gold" }], status: "open" },
    new Date("2026-10-07T15:30:00.000Z"),
  );
  assert.equal(fill("{{saudacao}}, {{nome}}. {{atendente}} · {{etiquetas}} · {{campos_personalizados}} · {{data}} {{hora}}"),
    "Boa tarde, Cliente cadastrado. Ana · Clipp, Apolo · Plano: Gold · 07/10/2026 12:30");
});
