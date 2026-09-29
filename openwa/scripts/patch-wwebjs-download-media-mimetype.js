/**
 * Backport whatsapp-web.js#201914's MIME forwarding to 1.34.7.
 *
 * Current WhatsApp Web rejects uncached audio, video and image downloads when
 * DownloadManager receives the default application/octet-stream instead of the
 * media model's declared mimetype. The upstream Message.downloadMedia path in
 * 1.34.7 forwards the type but omits the mimetype, resulting in the opaque `t: t`
 * Puppeteer error. Add the missing field until the dependency ships the fix.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WWJS = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js');
const MESSAGE_PATH = path.join('src', 'structures', 'Message.js');
const FIND = `                        type: msg.type,
                        signal: new AbortController().signal,`;
const REPLACE = `                        type: msg.type,
                        mimetype: msg.mimetype,
                        signal: new AbortController().signal,`;

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function applyDownloadMediaMimetypePatch(wwjsDir = DEFAULT_WWJS) {
  const messageFile = path.join(wwjsDir, MESSAGE_PATH);
  if (!fs.existsSync(messageFile)) throw new Error(`whatsapp-web.js Message.js not found at ${messageFile}`);
  const source = fs.readFileSync(messageFile, 'utf8');
  const finds = occurrences(source, FIND);
  const replacements = occurrences(source, REPLACE);
  if (finds === 0 && replacements === 1) return { skipped: true };
  if (finds !== 1 || replacements !== 0) {
    throw new Error(
      `unsupported Message.js shape for download-media MIME repair ` +
        `(unpatched: ${finds}, patched: ${replacements}); re-evaluate against the installed whatsapp-web.js`,
    );
  }
  fs.writeFileSync(messageFile, source.replace(FIND, REPLACE));
  return { skipped: false };
}

function run() {
  const bestEffort = process.argv.includes('--best-effort');
  try {
    const { skipped } = applyDownloadMediaMimetypePatch();
    console.log(`patch-wwebjs-download-media-mimetype: ${skipped ? 'skipped (already present)' : 'applied'}`);
  } catch (error) {
    if (bestEffort) {
      console.warn(`patch-wwebjs-download-media-mimetype: skipped — ${error.message}`);
      return;
    }
    console.error(`patch-wwebjs-download-media-mimetype: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) run();

module.exports = { applyDownloadMediaMimetypePatch, FIND, REPLACE };
