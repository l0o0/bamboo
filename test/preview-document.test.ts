import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAssetsToHtml,
  buildStandaloneDocument,
  documentTitle,
  renderMarkdown,
} from "../src/modules/markdown/preview.ts";

test("strips frontmatter and renders a read-only document body", () => {
  const html = renderMarkdown(
    "---\ntitle: Hello\n---\n\n# Hello\n\nA paragraph.",
  );
  assert.match(html, /<h1.*>Hello<\/h1>/);
  assert.match(html, /<p>A paragraph\.<\/p>/);
  assert.doesNotMatch(html, /title: Hello/);
});

test("picks the document title from frontmatter then H1", () => {
  assert.equal(
    documentTitle("---\ntitle: From YAML\n---\n\n# Heading"),
    "From YAML",
  );
  assert.equal(documentTitle("# Only heading"), "Only heading");
});

test("builds a standalone HTML document for export and print", () => {
  const doc = buildStandaloneDocument({
    source: "# Export me\n\nHello",
    assets: { "assets/a.png": { dataUrl: "data:image/png;base64,xx" } },
  });
  assert.equal(doc.title, "Export me");
  assert.match(doc.standaloneHtml, /<!DOCTYPE html>/);
  assert.match(doc.standaloneHtml, /<title>Export me<\/title>/);
  assert.match(doc.standaloneHtml, /class="zotero-markdown-preview-inner"/);
  assert.match(doc.bodyHtml, /Export me/);
});

test("rewrites local image sources to cached data URLs", () => {
  const html = applyAssetsToHtml('<p><img src="assets/a.png" alt="pic"></p>', {
    "assets/a.png": { dataUrl: "data:image/png;base64,abc" },
  });
  assert.match(html, /src="data:image\/png;base64,abc"/);
});

test("highlights supported fenced code in preview and export", () => {
  const source = "```js\nconst answer = 42;\n```";
  const html = renderMarkdown(source);
  assert.match(html, /class="language-js"/);
  assert.match(html, /hljs-keyword/);
  assert.match(html, /hljs-number/);
  assert.match(buildStandaloneDocument({ source }).bodyHtml, /hljs-keyword/);
});

test("falls back to escaped code for unknown languages", () => {
  const html = renderMarkdown("```brainfuck\n<x>& y\n```");
  assert.match(html, /&lt;x&gt;&amp; y/);
  assert.doesNotMatch(html, /hljs-/);
});

test("accepts aliases and ignores fence metadata", () => {
  const html = renderMarkdown(
    '```TS title="demo"\nconst n: number = 1;\n```',
  );
  assert.match(html, /hljs-keyword/);
  assert.doesNotMatch(html, /title=&quot;demo&quot;/);
});

test("exports semantic Highlight.js styles", () => {
  const doc = buildStandaloneDocument({
    source: "```js\nconst value = 'text';\n```",
    theme: "dark",
  });
  assert.match(doc.standaloneHtml, /--zmd-code-keyword: #c084fc/);
  assert.match(doc.standaloneHtml, /\.hljs-keyword/);
  assert.match(doc.standaloneHtml, /var\(--zmd-code-keyword\)/);
});
