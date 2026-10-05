import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCommand, normalizeUrl } from "../../extension/schema.js";
import { parseLLMResponse } from "../../extension/llm.js";

test("rejects unknown actions and dangerous URLs", () => {
  assert.throws(() => validateCommand({ action: "EVAL", code: "alert(1)" }), /Unsupported action/);
  assert.throws(() => validateCommand({ action: "OPEN_URL", url: "javascript:alert(1)" }), /Blocked URL scheme/);
  assert.throws(() => validateCommand({ action: "OPEN_URL", url: "file:///etc/passwd" }), /Blocked URL scheme/);
  assert.throws(() => validateCommand(null), /must be an object/);
});

test("normalizes URLs and strips unknown fields", () => {
  assert.equal(normalizeUrl("github.com"), "https://github.com/");
  assert.equal(normalizeUrl("localhost:3000/app"), "https://localhost:3000/app");
  assert.deepEqual(validateCommand({ action: "OPEN_URL", url: "github.com", extra: 1 }), { action: "OPEN_URL", url: "https://github.com/" });
});

test("clamps and defaults numeric fields", () => {
  assert.deepEqual(validateCommand({ action: "SCROLL", direction: "SIDEWAYS", amount: 1e9 }), { action: "SCROLL", direction: "DOWN", amount: 20000 });
  assert.deepEqual(validateCommand({ action: "MEDIA", op: "speed", rate: 99 }), { action: "MEDIA", op: "speed", rate: 4 });
  assert.deepEqual(validateCommand({ action: "MEDIA", op: "forward" }), { action: "MEDIA", op: "forward", seconds: 10 });
  assert.deepEqual(validateCommand({ action: "SEARCH", engine: "altavista", query: " cats " }), { action: "SEARCH", engine: "google", query: "cats" });
});

test("validates per-action requirements", () => {
  assert.throws(() => validateCommand({ action: "SEARCH", query: "  " }), /empty/);
  assert.throws(() => validateCommand({ action: "CLICK" }), /target/);
  assert.throws(() => validateCommand({ action: "TYPE", text: "" }), /Nothing to type/);
  assert.deepEqual(validateCommand({ action: "TYPE", text: "", clear: true }), { action: "TYPE", text: "", clear: true });
  assert.throws(() => validateCommand({ action: "PRESS_KEY", key: "F12" }), /Unsupported key/);
  assert.throws(() => validateCommand({ action: "TAB_GOTO", index: 0 }), /Invalid tab index/);
  assert.throws(() => validateCommand({ action: "TAB_GOTO" }), /index or a query/);
  assert.throws(() => validateCommand({ action: "HINTS", op: "click", number: 0 }), />= 1/);
  assert.throws(() => validateCommand({ action: "ZOOM", direction: "SIDEWAYS" }), /zoom/);
});

test("accepts backend-style nulls for optional fields", () => {
  assert.deepEqual(validateCommand({ action: "TAB_GOTO", index: null, query: "gmail" }), { action: "TAB_GOTO", query: "gmail" });
  assert.deepEqual(validateCommand({ action: "TYPE", text: "hi", target: null }), { action: "TYPE", text: "hi" });
  assert.deepEqual(validateCommand({ action: "TAB_PIN", pinned: null }), { action: "TAB_PIN" });
});

test("LLM output is parsed, whitelisted and validated", () => {
  assert.deepEqual(parseLLMResponse('```json\n{"action":"ZOOM","direction":"IN"}\n```'), { action: "ZOOM", direction: "IN" });
  assert.deepEqual(parseLLMResponse('Sure! {"action": "SEARCH", "engine": "youtube", "query": "jazz"}'), { action: "SEARCH", engine: "youtube", query: "jazz" });
  assert.equal(parseLLMResponse('{"action":"UNKNOWN"}'), null);
  assert.equal(parseLLMResponse('{"action":"STOP"}'), null);
  assert.equal(parseLLMResponse('{"action":"OPEN_URL","url":"javascript:alert(1)"}'), null);
  assert.equal(parseLLMResponse("not json"), null);
  assert.equal(parseLLMResponse(""), null);
});
