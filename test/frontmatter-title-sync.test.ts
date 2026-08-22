import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNoteWithFrontmatter,
  extractFirstHeadingTitle,
  frontmatterTitleChange,
  syncFrontmatterTitle,
} from "../src/modules/markdown/frontmatter";

test("extracts the first H1 after frontmatter", () => {
  assert.equal(
    extractFirstHeadingTitle(
      "---\ntitle: Old\n---\n\n## Skip\n# New title ##\n# Later",
    ),
    "New title",
  );
});

test("updates an existing frontmatter title without changing the body", () => {
  assert.equal(
    syncFrontmatterTitle("---\ntitle: Old\ntype: note\n---\n\n# New", "New"),
    "---\ntitle: New\ntype: note\n---\n\n# New",
  );
});

test("adds title when frontmatter exists without one", () => {
  assert.equal(
    syncFrontmatterTitle("---\ntype: note\n---\n\n# New", "A: B"),
    '---\ntitle: "A: B"\ntype: note\n---\n\n# New',
  );
});

test("returns a minimal frontmatter-only editor change", () => {
  const source = "---\ntitle: Old\ntype: note\n---\n\n# New";
  const change = frontmatterTitleChange(source, "New");
  assert.deepEqual(change, { from: 11, to: 14, insert: "New" });
});

test("uses the generated document title in literature frontmatter and H1", () => {
  const parent = {
    getField: (field: string) =>
      field === "title" ? "Source title" : field === "date" ? "2026" : "",
    getCreators: () => [],
    itemType: "journalArticle",
    key: "ABC123",
    libraryID: 1,
  } as unknown as Zotero.Item;
  const source = buildNoteWithFrontmatter({
    title: "Source-title-2026-08-13-14-35",
    parent,
  });
  assert.match(source, /title: Source-title-2026-08-13-14-35/);
  assert.match(source, /# Source-title-2026-08-13-14-35/);
  assert.doesNotMatch(source, /title: Source title/);
});
