import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const windowSource = readFileSync(
  new URL("../src/modules/markdown/window.ts", import.meta.url),
  "utf8",
);
const hostSource = readFileSync(
  new URL("../addon/content/markdownWindow.xhtml", import.meta.url),
  "utf8",
);
const tabSource = readFileSync(
  new URL("../src/modules/markdown/tab.ts", import.meta.url),
  "utf8",
);

test("uses the shared editor surface instead of a second editor implementation", () => {
  assert.match(windowSource, /mountMarkdownEditorSurface/);
  assert.match(windowSource, /refreshMarkdownSessionOnFocus/);
  assert.doesNotMatch(windowSource, /createMarkdownEditor/);
  assert.match(windowSource, /injectMarkdownStyles/);
});

test("explicitly refreshes a reused standalone window", () => {
  assert.match(windowSource, /windows\.get\(item\.id\)/);
  assert.match(windowSource, /await refreshMarkdownSessionOnFocus\(/);
});

test("uses a script-free chrome host for the standalone window", () => {
  assert.match(hostSource, /bamboo-markdown-window-root/);
  assert.doesNotMatch(hostSource, /<script/i);
  assert.match(hostSource, /width: 100%/);
});

test("does not tear down the shared surface until the close save succeeds", () => {
  const closeSession = tabSource.slice(
    tabSource.indexOf("export async function closeMarkdownSession"),
    tabSource.indexOf("/** Close (and flush) an open Markdown tab"),
  );
  assert.ok(
    closeSession.indexOf("await session.save.request") <
      closeSession.indexOf("session.modal?.destroy()"),
  );
});
