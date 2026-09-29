/**
 * Repair media sending on whatsapp-web.js 1.34.7 with current WhatsApp Web builds.
 *
 * The media returned by `processMediaData()` is a MobX model. Spreading that raw model into the
 * outgoing message can copy its private `id`/`__x_id` fields over the freshly-created message key,
 * which makes WhatsApp Web reject audio and other media sends. Serialize the media model first,
 * remove both leaked identifiers and set the real message key after every options spread.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_WWJS = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js');
const UTILS_PATH = path.join('src', 'util', 'Injected', 'Utils.js');

const MESSAGE_FIND = `        const message = {
            ...options,
            id: newMsgKey,`;

const MESSAGE_REPLACE = `        const safeMediaOptions =
            (mediaOptions.toJSON ? mediaOptions.toJSON() : { ...mediaOptions }) || {};
        delete safeMediaOptions.id;
        delete safeMediaOptions.__x_id;

        const message = {
            ...options,
            id: newMsgKey,`;

const MEDIA_SPREAD_FIND = `            ...mediaOptions,
            ...(mediaOptions.toJSON ? mediaOptions.toJSON() : {}),
            ...quotedMsgOptions,`;

const MEDIA_SPREAD_REPLACE = `            ...safeMediaOptions,
            caption: mediaOptions.caption,
            isViewOnce: mediaOptions.isViewOnce,
            ...quotedMsgOptions,`;

const TAIL_FIND = `            ...botOptions,
            ...extraOptions,
        };`;

const TAIL_REPLACE = `            ...botOptions,
            ...extraOptions,
            // Never let an option or media model overwrite the real outgoing message key.
            id: newMsgKey,
        };`;

const LEGACY_MARKER = `
        // Media models currently expose a private enumerable __x_id. The media spread above can
        // overwrite the real outgoing message id and make addAndSendMsgToChat reject the model.
        delete message.__x_id;
`;

const transforms = [
  [MESSAGE_FIND, MESSAGE_REPLACE],
  [MEDIA_SPREAD_FIND, MEDIA_SPREAD_REPLACE],
  [TAIL_FIND, TAIL_REPLACE],
];

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function isApplied(wwjsDir = DEFAULT_WWJS) {
  try {
    const source = fs.readFileSync(path.join(wwjsDir, UTILS_PATH), 'utf8');
    return transforms.every(([, replacement]) => occurrences(source, replacement) === 1);
  } catch {
    return true;
  }
}

function applyMediaModelIdPatch(wwjsDir = DEFAULT_WWJS) {
  const utilsFile = path.join(wwjsDir, UTILS_PATH);
  if (!fs.existsSync(utilsFile)) {
    throw new Error(`whatsapp-web.js Utils.js not found at ${utilsFile}`);
  }

  let source = fs.readFileSync(utilsFile, 'utf8');
  if (transforms.every(([, replacement]) => occurrences(source, replacement) === 1)) {
    return { skipped: true };
  }

  // Upgrade installations where the previous, narrower repair has already been applied.
  if (occurrences(source, LEGACY_MARKER) === 1) source = source.replace(LEGACY_MARKER, '');

  for (const [find, replacement] of transforms) {
    const finds = occurrences(source, find);
    const replacements = occurrences(source, replacement);
    if (finds !== 1 || replacements !== 0) {
      throw new Error(
        `unsupported Utils.js shape for media model id repair ` +
          `(unpatched: ${finds}, patched: ${replacements}); ` +
          're-evaluate this transform against the installed whatsapp-web.js',
      );
    }
    source = source.replace(find, replacement);
  }

  fs.writeFileSync(utilsFile, source);
  return { skipped: false };
}

function run() {
  const bestEffort = process.argv.includes('--best-effort');
  try {
    const { skipped } = applyMediaModelIdPatch();
    console.log(`patch-wwebjs-media-model-id: ${skipped ? 'skipped (already present)' : 'applied'}`);
  } catch (error) {
    if (bestEffort) {
      console.warn(`patch-wwebjs-media-model-id: skipped — ${error.message}`);
      return;
    }
    console.error(`patch-wwebjs-media-model-id: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) run();

module.exports = {
  applyMediaModelIdPatch,
  isApplied,
  MESSAGE_FIND,
  MESSAGE_REPLACE,
  MEDIA_SPREAD_FIND,
  MEDIA_SPREAD_REPLACE,
  TAIL_FIND,
  TAIL_REPLACE,
  LEGACY_MARKER,
};
