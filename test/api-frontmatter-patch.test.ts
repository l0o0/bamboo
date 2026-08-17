import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFrontmatterPatch,
  parseFrontmatter,
} from "../src/modules/markdown/frontmatter.ts";

test("sets and replaces frontmatter keys while preserving the body", () => {
  const source = [
    "---",
    "title: Old Title",
    "tags:",
    "  - a",
    "---",
    "",
    "# Old Title",
    "",
    "body text",
  ].join("\n");

  const out = applyFrontmatterPatch(source, {
    set: { title: "New Title", status: "draft" },
    delete: ["tags"],
  });

  assert.match(out, /^---\n/);
  assert.match(out, /title: "?New Title"?/);
  assert.match(out, /status: draft/);
  assert.ok(!out.includes("tags:"));
  assert.match(out, /# Old Title/);
  assert.match(out, /body text/);

  const { data, body } = parseFrontmatter(out);
  assert.equal(data.title, "New Title");
  assert.equal(data.status, "draft");
  assert.equal(body.trim(), "# Old Title\n\nbody text");
});

test("creates a frontmatter block when the source has none", () => {
  const source = "# Hello\n\nplain body";
  const out = applyFrontmatterPatch(source, {
    set: { title: "Hello", tags: ["note", "ai"] },
  });

  assert.match(out, /^---\n/);
  const { data, body } = parseFrontmatter(out);
  assert.equal(data.title, "Hello");
  assert.deepEqual(data.tags, ["note", "ai"]);
  assert.equal(body.trim(), "# Hello\n\nplain body");
});

test("removes the frontmatter block when every key is deleted", () => {
  const source = "---\ntitle: A\ntype: note\n---\n\n# A\n\nbody";
  const out = applyFrontmatterPatch(source, {
    delete: ["title", "type"],
  });
  assert.ok(!out.startsWith("---"));
  assert.equal(out, "# A\n\nbody");
});

test("delete and null-set both remove keys", () => {
  const source = "---\ntitle: A\nnote: x\n---\n\nbody";
  const out = applyFrontmatterPatch(source, { set: { note: null } });
  const { data } = parseFrontmatter(out);
  assert.equal(data.title, "A");
  assert.ok(!("note" in data));
});

test("preserves CRLF line endings", () => {
  const source = "---\r\ntitle: A\r\n---\r\n\r\nbody";
  const out = applyFrontmatterPatch(source, { set: { title: "B" } });
  assert.ok(out.includes("\r\n"));
  const { data, body } = parseFrontmatter(out);
  assert.equal(data.title, "B");
  assert.equal(body.trim(), "body");
});

test("no-op patch keeps the document equivalent", () => {
  const source = "---\ntitle: A\n---\n\n# A\n\nbody";
  const out = applyFrontmatterPatch(source, { set: {} });
  const { data, body } = parseFrontmatter(out);
  assert.equal(data.title, "A");
  assert.equal(body.trim(), "# A\n\nbody");
});
