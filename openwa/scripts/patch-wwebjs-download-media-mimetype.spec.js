'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyDownloadMediaMimetypePatch, FIND, REPLACE } = require('./patch-wwebjs-download-media-mimetype.js');

function fixture(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wwebjs-media-mime-'));
  const dir = path.join(root, 'src', 'structures');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Message.js'), source);
  return root;
}

test('adds mimetype to the download manager options and is idempotent', () => {
  const root = fixture(`before\n${FIND}\nafter\n`);
  assert.deepEqual(applyDownloadMediaMimetypePatch(root), { skipped: false });
  assert.match(fs.readFileSync(path.join(root, 'src', 'structures', 'Message.js'), 'utf8'), /mimetype: msg\.mimetype/);
  assert.deepEqual(applyDownloadMediaMimetypePatch(root), { skipped: true });
});

test('rejects an unknown dependency shape', () => {
  const root = fixture('different source');
  assert.throws(() => applyDownloadMediaMimetypePatch(root), /unsupported Message\.js shape/);
});

test('recognizes an upstream-patched shape', () => {
  const root = fixture(REPLACE);
  assert.deepEqual(applyDownloadMediaMimetypePatch(root), { skipped: true });
});
