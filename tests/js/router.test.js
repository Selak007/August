import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { routeCommand, normalizeUtterance, resolveSiteUrl, parseNumber } from "../../extension/router.js";
import { validateCommand } from "../../extension/schema.js";

const { cases } = JSON.parse(readFileSync(new URL("../router_parity_cases.json", import.meta.url)));

test("router matches shared parity fixture", () => {
  for (const c of cases) {
    assert.deepEqual(routeCommand(c.utterance, c.context || {}).command, c.expected, c.utterance);
  }
});

test("every routed command passes schema validation unchanged", () => {
  for (const c of cases.filter(c => c.expected)) {
    const expected = c.expected.url ? { ...c.expected, url: new URL(c.expected.url).href } : c.expected;
    assert.deepEqual(validateCommand(c.expected), expected, c.utterance);
  }
});

test("benchmark dataset still routes to the expected action", () => {
  const data = JSON.parse(readFileSync(new URL("../benchmark_dataset.json", import.meta.url)));
  const rows = Array.isArray(data) ? data : data.utterances || data.cases;
  for (const row of rows) {
    const cmd = routeCommand(row.utterance).command;
    if (row.expected_tier === "deterministic") {
      assert.equal(cmd?.action, row.expected_action, row.utterance);
    }
  }
});

test("normalizeUtterance strips wake word, politeness and punctuation", () => {
  assert.equal(normalizeUtterance("Hey August, could you open YouTube please."), "open YouTube");
  assert.equal(normalizeUtterance("august"), "august");
  assert.equal(normalizeUtterance("Type Hello, world."), "Type Hello, world.");
});

test("resolveSiteUrl prefers exact and longest aliases", () => {
  assert.equal(resolveSiteUrl("netflix"), "https://www.netflix.com");
  assert.equal(resolveSiteUrl("x"), "https://www.x.com");
  assert.equal(resolveSiteUrl("youtube music"), "https://music.youtube.com");
  assert.equal(resolveSiteUrl("example.com/path"), "https://example.com/path");
  assert.equal(resolveSiteUrl("something unknown"), null);
});

test("parseNumber handles digits, ordinals, words and homophones", () => {
  assert.equal(parseNumber("12"), 12);
  assert.equal(parseNumber("3rd"), 3);
  assert.equal(parseNumber("second"), 2);
  assert.equal(parseNumber("to"), 2);
  assert.equal(parseNumber("last"), -1);
  assert.equal(parseNumber("banana"), null);
});
