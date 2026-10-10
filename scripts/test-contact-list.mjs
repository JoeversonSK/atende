import assert from "node:assert/strict";
import test from "node:test";
import { availableContactTags, buildContactRows, findChatForSharedContact, findContactRowByPhone, findForwardCandidates } from "../app/conversations/contact-list.ts";

const chat = (id, name, extra = {}) => ({ id, name, last: "", time: "", unread: 0, ...extra });
const profile = (chatId, data) => ({ chatId, data });

test("une perfil importado por telefone ao único chat LID de mesmo nome", () => {
  const rows = buildContactRows(
    [chat("abc@lid", "João da Silva", { avatar: "/foto" })],
    [profile("5511999999999@c.us", { name: "Joao da Silva", phone: "5511999999999", tags: ["Cliente"] })],
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: "abc@lid", name: "João da Silva", phone: "5511999999999", avatar: "/foto", tags: ["Cliente"],
  });
});

test("não funde duas conversas reais nem exibe perfis ocultos ou grupos", () => {
  const rows = buildContactRows(
    [chat("abc@lid", "Cliente Exemplo"), chat("5511999999999@c.us", "Cliente Exemplo"),
      chat("grupo@g.us", "Grupo", { isGroup: true })],
    [
      profile("5511999999999@c.us", { name: "Cliente Exemplo", phone: "5511999999999" }),
      profile("oculto@c.us", { name: "Oculto", directoryHidden: true }),
      profile("grupo@g.us", { name: "Grupo" }),
    ],
  );
  assert.deepEqual(rows.map(row => row.id), ["abc@lid", "5511999999999@c.us"]);
});

test("busca destinatários sem acento e mantém etiquetas únicas", () => {
  const rows = buildContactRows(
    [chat("origem@c.us", "Origem"), chat("destino@c.us", "José")],
    [profile("destino@c.us", { name: "José", phone: "5511888888888", tags: ["Clipp", "Apolo", "Clipp"] })],
  );
  assert.deepEqual(findForwardCandidates(rows, "origem@c.us", "jose").map(row => row.id), ["destino@c.us"]);
  assert.deepEqual(availableContactTags(rows), ["Apolo", "Clipp"]);
});

test("encontra conversa do cartão compartilhado por telefone mascarado", () => {
  const rows = buildContactRows(
    [chat("cliente@lid", "Cliente")],
    [profile("cliente@lid", { name: "Cliente", phone: "5588988389380" })],
  );
  assert.equal(findContactRowByPhone(rows, "+55 88 98838-9380")?.id, "cliente@lid");
  assert.equal(findContactRowByPhone(rows, "+55 11 99999-0000"), undefined);
});

test("usa o nome quando telefone exibido e waid não coincidem com o cadastro", () => {
  const chats = [chat("cliente@lid", "Letícia Ribeiro COAFAC")];
  const rows = buildContactRows(chats, [profile("cliente@lid", { name: "Letícia Ribeiro COAFAC", phone: "558888389380" })]);
  assert.equal(findChatForSharedContact(chats, rows, {
    name: "Leticia", phone: "+55 88 98838-9380", waid: "558898389380",
  })?.id, "cliente@lid");
});
