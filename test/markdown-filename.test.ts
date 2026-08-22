import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTimestampedMarkdownFilename,
  markdownAttachmentTitle,
  markdownDocumentTitle,
} from "../src/modules/markdown/detect";

const fixedTime = new Date(2026, 7, 13, 14, 35, 42);

test("builds a timestamped Note filename without spaces", () => {
  assert.equal(
    buildTimestampedMarkdownFilename("Note", fixedTime),
    "Note-2026-08-13-14-35.md",
  );
});

test("normalizes whitespace and repeated separators in generated filenames", () => {
  assert.equal(
    buildTimestampedMarkdownFilename("  Multi  Agent -- Notes  ", fixedTime),
    "Multi-Agent-Notes-2026-08-13-14-35.md",
  );
});

test("uses the timestamped filename stem as the document title", () => {
  assert.equal(
    markdownDocumentTitle("Note-2026-08-13-14-35.md"),
    "Note-2026-08-13-14-35",
  );
  assert.equal(markdownDocumentTitle("Note.md"), "Note");
});

test("keeps the Markdown suffix on attachment titles without duplicating it", () => {
  assert.equal(markdownAttachmentTitle("Meeting notes"), "Meeting notes.md");
  assert.equal(markdownAttachmentTitle("Meeting notes.md"), "Meeting notes.md");
});
