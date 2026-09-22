const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const state = [];
let cursor = 0;
const react = { ...React, useState(initial) {
  const index = cursor++;
  if (!(index in state)) state[index] = initial;
  return [state[index], value => { state[index] = value; }];
} };
const compiled = ts.transpileModule(fs.readFileSync('app/account-panels.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', compiled)(id => {
  if (id === 'react') return react;
  if (id.startsWith('./')) return {};
  return require(id);
}, loaded, loaded.exports);
const config = { baseUrl: 'http://localhost:2785', apiKey: 'fake-test-key', sessionId: 'test' };
let role = 'admin';
function render() { cursor = 0; return loaded.exports.SettingsScreen({ user: { role }, config }); }
function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) { for (const child of node) { const match = find(child, predicate); if (match) return match; } return; }
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
const button = (tree, label) => find(tree, n => n.type === 'button' && n.props['aria-label'] === label);
const key = tree => find(tree, n => n.props?.id === 'connection-api-key');
const tab = (tree, label) => find(tree, n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children.includes(label));
(async () => {
  tab(render(), 'WhatsApp').props.onClick();
  assert.equal(key(render()).props.type, 'password');
  button(render(), 'Mostrar chave').props.onClick();
  assert.equal(key(render()).props.type, 'text');
  button(render(), 'Ocultar chave').props.onClick();
  assert.equal(key(render()).props.type, 'password');
  let copied;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { copied = value; } } } });
  button(render(), 'Copiar chave').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(copied, config.apiKey);
  assert.ok(find(render(), n => n.props?.role === 'status' && n.props.children.startsWith('Chave copiada')));
  navigator.clipboard.writeText = async () => { throw new Error('Denied'); };
  button(render(), 'Copiar chave').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(find(render(), n => n.props?.role === 'status' && n.props.children.includes('Ctrl+C')));
  button(render(), 'Mostrar chave').props.onClick();
  tab(render(), 'Meu perfil').props.onClick();
  tab(render(), 'WhatsApp').props.onClick();
  assert.equal(key(render()).props.type, 'password');
  role = 'operator';
  assert.equal(key(render()), undefined);
  console.log('PASS: masked default, reveal/hide, copy success/failure, hide on tab change and admin-only field (fake key).');
})().catch(error => { console.error(error); process.exitCode = 1; });
