import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceRecorderErrorMessage } from "../app/conversations/voice-recorder-errors.ts";

test("insecure origin explains why Chrome cannot request the microphone", () => {
  assert.match(voiceRecorderErrorMessage(new Error(), false, false), /HTTPS confiável/);
});

test("blocked, missing and busy microphones have distinct guidance", () => {
  assert.match(voiceRecorderErrorMessage(new DOMException("blocked", "NotAllowedError"), true, true), /Microfone bloqueado/);
  assert.match(voiceRecorderErrorMessage(new DOMException("missing", "NotFoundError"), true, true), /Nenhum microfone/);
  assert.match(voiceRecorderErrorMessage(new DOMException("busy", "NotReadableError"), true, true), /outros aplicativos/);
});
