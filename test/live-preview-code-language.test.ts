import assert from "node:assert/strict";
import test from "node:test";
import {
  fenceLanguageToken,
  normalizeFenceLanguage,
} from "../src/modules/markdown/code-language-aliases.ts";

test("normalizes supported fenced-code language aliases", () => {
  assert.equal(normalizeFenceLanguage("js"), "javascript");
  assert.equal(normalizeFenceLanguage("TSX"), "typescript");
  assert.equal(normalizeFenceLanguage("xml"), "html");
  assert.equal(normalizeFenceLanguage("sh"), "bash");
  assert.equal(normalizeFenceLanguage("c++"), "cpp");
  assert.equal(normalizeFenceLanguage("rs"), "rust");
});

test("uses only the first fence info token", () => {
  assert.equal(fenceLanguageToken('  js title="demo"  '), "js");
  assert.equal(normalizeFenceLanguage('js title="demo"'), "javascript");
});

test("returns null for empty and unsupported languages", () => {
  assert.equal(normalizeFenceLanguage(""), null);
  assert.equal(normalizeFenceLanguage("brainfuck"), null);
});
