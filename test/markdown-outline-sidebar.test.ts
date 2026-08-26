import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  outlineIndentPx,
  outlineVisibleAtWidth,
} from "../src/modules/markdown/outline-sidebar.ts";
import { iconPanelLeft } from "../src/modules/markdown/icons.ts";
import { outlineSidebarCSS } from "../src/modules/markdown/styles.ts";

test("caps indentation and auto-hides only at narrow widths", () => {
  assert.equal(outlineIndentPx(1), 8);
  assert.equal(outlineIndentPx(3), 32);
  assert.equal(outlineIndentPx(6), 44);
  assert.equal(outlineVisibleAtWidth(true, 900), true);
  assert.equal(outlineVisibleAtWidth(true, 620), false);
  assert.equal(outlineVisibleAtWidth(false, 900), false);
});

test("defines unframed geometry and complete collapse", () => {
  const css = outlineSidebarCSS();

  assert.match(css, /inline-size: clamp\(200px, 18vw, 280px\)/);
  assert.match(css, /border-inline-end: 1px solid var\(--zmd-border\)/);
  assert.match(css, /is-outline-collapsed[\s\S]*display: none/);
  assert.match(css, /text-overflow: ellipsis/);
  assert.doesNotMatch(css, /zotero-markdown-outline-header/);
  assert.doesNotMatch(css, /zotero-markdown-outline-collapse/);
  assert.doesNotMatch(css, /box-shadow/);
});

test("uses the leading toolbar panel button as the only outline control", () => {
  const source = readFileSync("src/modules/markdown/tab.ts", "utf8");
  const toggleIndex = source.indexOf('"data-action": "outline-toggle"');
  const saveIndex = source.indexOf('"data-action": "save"');

  assert.ok(toggleIndex >= 0);
  assert.ok(saveIndex > toggleIndex);
  assert.match(source, /zotero-markdown-outline-sidebar/);
  assert.match(source, /onOutline:/);
  assert.match(source, /revealPosition/);
  assert.doesNotMatch(source, /zotero-markdown-outline-header/);
  assert.doesNotMatch(source, /outlineCollapseEl/);
  assert.doesNotMatch(source, /iconPanelLeftClose/);
  assert.match(iconPanelLeft(), /chrome:\/\/bamboo\/content\/icons\/markdown/);
});

test("uses XHTML-safe markup for sidebar toolbar icons", () => {
  const icon = iconPanelLeft();

  assert.match(icon, /^<img\b[^>]*\/>$/);
  assert.doesNotMatch(icon, /<\/img>/);
});
