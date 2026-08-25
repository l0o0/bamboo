import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatModalBytes,
  formatModalDate,
  modalTitle,
  normalizeMarkdownFilename,
  prefsFromSettings,
  settingsFromPrefs,
} from "../src/modules/markdown/modal.ts";
import { markdownModalCSS } from "../src/modules/markdown/styles.ts";

test("normalizes Markdown filenames without losing the extension", () => {
  assert.equal(
    normalizeMarkdownFilename("  Meeting notes  "),
    "Meeting-notes.md",
  );
  assert.equal(
    normalizeMarkdownFilename("Meeting notes.md"),
    "Meeting-notes.md",
  );
  assert.equal(normalizeMarkdownFilename("报告.md"), "报告.md");
});

test("formats document metadata values for the modal", () => {
  assert.equal(formatModalBytes(0), "0 B");
  assert.equal(formatModalBytes(1536), "1.5 KB");
  assert.equal(formatModalBytes(null), "—");
  assert.equal(
    formatModalDate("2026-08-22T10:00:00.000Z", "en-US"),
    "8/22/2026",
  );
  assert.equal(formatModalDate(null, "en-US"), "—");
});

test("maps plugin preferences to and from modal settings", () => {
  const settings = settingsFromPrefs({
    enable: true,
    frontmatter: false,
    fontSize: 16,
    shortcutNewStandaloneMd: "accel,shift,M",
  });
  assert.deepEqual(settings, {
    enable: true,
    frontmatter: false,
    fontSize: 16,
    shortcutNewStandaloneMd: "accel,shift,M",
  });
  assert.deepEqual(prefsFromSettings({ ...settings, fontSize: 18 }), {
    enable: true,
    frontmatter: false,
    fontSize: 18,
    shortcutNewStandaloneMd: "accel,shift,M",
  });
});

test("provides stable modal titles via localized keys", () => {
  // Without a Zotero window, getString falls back to the prefixed Fluent id.
  assert.equal(modalTitle("document-info"), "bamboo-more-document-info");
  assert.equal(modalTitle("rename"), "bamboo-more-rename");
  assert.equal(modalTitle("settings"), "bamboo-more-settings");
});

test("defines a centered accessible modal surface", () => {
  const css = markdownModalCSS();
  assert.match(css, /\.zotero-markdown-modal-backdrop/);
  assert.match(css, /align-items:\s*center/);
  assert.match(css, /justify-content:\s*center/);
  assert.match(css, /\.zotero-markdown-modal-button\.is-primary/);
});

test("defines a responsive settings workspace without changing compact dialogs", () => {
  const css = markdownModalCSS();
  assert.match(css, /\.zotero-markdown-modal\.is-settings/);
  assert.match(css, /grid-template-columns:\s*188px minmax\(0, 1fr\)/);
  assert.match(
    css,
    /zotero-markdown-settings-nav-item\[aria-selected="true"\]/,
  );
  assert.match(css, /zotero-markdown-settings-footer/);
  assert.match(css, /@media \(max-width:\s*560px\)/);
});

test("supports a tab-root mount without relying on document.body", () => {
  const source = readFileSync(
    new URL("../src/modules/markdown/modal.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /options\.mount \|\| doc\.body \|\| doc\.documentElement/,
  );
  assert.match(source, /mount\.appendChild\(backdrop\)/);
});

test("defines editor and shortcut settings controls", () => {
  const css = markdownModalCSS();
  assert.match(css, /zotero-markdown-settings-row/);
  assert.match(css, /zotero-markdown-settings-shortcut-row/);
  assert.match(css, /zotero-markdown-modal-shortcut-control/);
  const source = readFileSync(
    new URL("../src/modules/markdown/modal.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /getString\("settings-shortcut-edit"\)/);
  assert.match(source, /zotero-markdown-settings-workspace/);
  assert.match(source, /zotero-markdown-settings-navigation/);
  assert.match(source, /aria-selected/);
  assert.match(source, /SETTINGS_PAGES/);
  assert.match(source, /getString\("modal-done"\)/);
  assert.match(source, /shortcut-overflow/);
  assert.doesNotMatch(source, /button\(doc, "清除", "clear-shortcut"\)/);
  assert.doesNotMatch(source, /button\(doc, "恢复默认", "restore-shortcut"\)/);
  assert.match(source, /shortcutNewStandaloneMd/);
  assert.doesNotMatch(source, /打开 Zotero 设置/);
  assert.doesNotMatch(source, /native-settings/);
  assert.match(source, /if \(event\.defaultPrevented\) return/);
});
