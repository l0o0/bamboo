import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preferences = readFileSync(
  new URL("../addon/content/preferences.xhtml", import.meta.url),
  "utf8",
);

test("keeps the Zotero preference pane as a settings entry only", () => {
  assert.match(preferences, /zotero-markdown-open-settings/);
  assert.match(preferences, /pref-open-settings/);
  assert.doesNotMatch(preferences, /preference="enable"/);
  assert.doesNotMatch(preferences, /preference="frontmatter"/);
  assert.doesNotMatch(preferences, /preference="fontSize"/);
  assert.doesNotMatch(preferences, /preference="shortcutNewStandaloneMd"/);
});

test("binds the preference entry to the shared Markdown settings opener", () => {
  const source = readFileSync(
    new URL("../src/modules/markdown/settings.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /openMarkdownSettings/);
  assert.match(source, /bindMarkdownSettingsPreferencePane/);
  assert.match(source, /zotero-markdown-open-settings/);
  assert.match(source, /markdownSettingsAbout/);
  assert.match(source, /about:\s*markdownSettingsAbout\(\)/);
});

test("passes the same about metadata to tab settings", () => {
  const source = readFileSync(
    new URL("../src/modules/markdown/tab.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /about:\s*markdownSettingsAbout\(\)/);
});
