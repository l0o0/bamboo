import assert from "node:assert/strict";
import test from "node:test";
import {
  createMarkdownImportPaths,
  logicalMarkdownFilename,
  storedMarkdownFilename,
} from "../src/modules/markdown/storage-filename";

test("adds one compact prefix to stored Markdown files", () => {
  assert.equal(storedMarkdownFilename("Note.md"), "zmd-Note.md");
  assert.equal(storedMarkdownFilename("zmd-Note.md"), "zmd-Note.md");
  assert.equal(storedMarkdownFilename("zmd-zmd-Note.md"), "zmd-Note.md");
});

test("keeps the logical filename free of the storage prefix", () => {
  assert.equal(logicalMarkdownFilename("zmd-研究计划.md"), "研究计划.md");
  assert.equal(logicalMarkdownFilename("研究计划.md"), "研究计划.md");
});

test("puts import uniqueness in the temporary directory", () => {
  assert.deepEqual(createMarkdownImportPaths("/tmp", "Note.md", "abc"), {
    directory: "/tmp/bamboo-abc",
    file: "/tmp/bamboo-abc/zmd-Note.md",
  });
});
