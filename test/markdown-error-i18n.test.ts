import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const keys = [
  "error-stored-image-only",
  "error-not-text-attachment",
  "error-read-only-image",
  "error-image-reference-unsupported",
  "error-image-missing",
  "error-attachment-gone",
  "error-rename-missing",
  "error-rename-exists",
  "error-rename-failed",
  "error-print-window",
  "error-image-format",
  "error-image-empty",
  "error-image-too-large",
  "error-attachment-directory",
  "error-preview-too-large",
  "error-preview-timeout",
  "error-preview-worker-failed",
  "error-preview-worker-unavailable",
  "preview-loading",
  "preview-retry",
];

test("remaining Markdown user-facing errors have both locale entries", () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const source = readFileSync(
      new URL(`../addon/locale/${locale}/mainWindow.ftl`, import.meta.url),
      "utf8",
    );
    for (const key of keys)
      assert.match(source, new RegExp(`^${key}\\s*=`, "m"));
  }
});
