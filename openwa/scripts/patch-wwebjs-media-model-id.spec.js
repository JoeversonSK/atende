'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyMediaModelIdPatch,
  isApplied,
  MESSAGE_FIND,
  MESSAGE_REPLACE,
  MEDIA_SPREAD_FIND,
  MEDIA_SPREAD_REPLACE,
  TAIL_FIND,
  TAIL_REPLACE,
  LEGACY_MARKER,
} = require('./patch-wwebjs-media-model-id');

function fakeWwjs(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwjs-media-id-'));
  const utilsFile = path.join(dir, 'src', 'util', 'Injected', 'Utils.js');
  fs.mkdirSync(path.dirname(utilsFile), { recursive: true });
  fs.writeFileSync(utilsFile, source);
  return { dir, utilsFile };
}

function pristine(extra = '') {
  return `before\n${MESSAGE_FIND}\nmiddle\n${MEDIA_SPREAD_FIND}\nlater\n${TAIL_FIND}\nafter\n${extra}`;
}

test('serializes media options and preserves the outgoing message key', () => {
  const { dir, utilsFile } = fakeWwjs(pristine());

  assert.equal(applyMediaModelIdPatch(dir).skipped, false);
  const patched = fs.readFileSync(utilsFile, 'utf8');
  assert.ok(patched.includes(MESSAGE_REPLACE));
  assert.ok(patched.includes(MEDIA_SPREAD_REPLACE));
  assert.ok(patched.includes(TAIL_REPLACE));
  assert.ok(patched.includes('delete safeMediaOptions.id;'));
  assert.ok(patched.includes('delete safeMediaOptions.__x_id;'));
});

test('is idempotent and reports the applied state', () => {
  const { dir, utilsFile } = fakeWwjs(pristine());
  assert.equal(isApplied(dir), false);
  applyMediaModelIdPatch(dir);
  const once = fs.readFileSync(utilsFile, 'utf8');
  assert.equal(isApplied(dir), true);
  assert.equal(applyMediaModelIdPatch(dir).skipped, true);
  assert.equal(fs.readFileSync(utilsFile, 'utf8'), once);
});

test('upgrades the previous narrow repair', () => {
  const { dir, utilsFile } = fakeWwjs(pristine(LEGACY_MARKER));

  assert.equal(applyMediaModelIdPatch(dir).skipped, false);
  const patched = fs.readFileSync(utilsFile, 'utf8');
  assert.equal(patched.includes(LEGACY_MARKER), false);
  assert.ok(patched.includes(MESSAGE_REPLACE));
});

test('refuses an unknown or mixed upstream shape without changing the file', () => {
  for (const source of ['unrecognised source', pristine(MESSAGE_REPLACE)]) {
    const { dir, utilsFile } = fakeWwjs(source);
    assert.throws(() => applyMediaModelIdPatch(dir), /unsupported Utils\.js shape/);
    assert.equal(fs.readFileSync(utilsFile, 'utf8'), source);
  }
});

test('reports a missing dependency tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwjs-media-id-empty-'));
  assert.throws(() => applyMediaModelIdPatch(dir), /Utils\.js not found/);
});

test('CLI: an unknown tree fails normally and is non-fatal under --best-effort', () => {
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wwjs-media-id-cli-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  const script = path.join(root, 'scripts', 'patch-wwebjs-media-model-id.js');
  fs.copyFileSync(path.join(__dirname, 'patch-wwebjs-media-model-id.js'), script);
  const utilsFile = path.join(root, 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');
  fs.mkdirSync(path.dirname(utilsFile), { recursive: true });
  fs.writeFileSync(utilsFile, 'unknown\n');

  const bare = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /unsupported Utils\.js shape/);

  const bestEffort = spawnSync(process.execPath, [script, '--best-effort'], { encoding: 'utf8' });
  assert.equal(bestEffort.status, 0);
  assert.match(bestEffort.stderr, /skipped/);
});
