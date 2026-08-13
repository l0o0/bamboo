import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatSavedStatus,
  formatStats,
} from "../src/modules/markdown/status.ts";

describe("formatStats", () => {
  it("shows words and lines only", () => {
    assert.equal(
      formatStats({ chars: 42, words: 7, lines: 3 }),
      "7 words · 3 lines",
    );
  });
});

describe("formatSavedStatus", () => {
  it("shows the saved time and autosave information", () => {
    assert.equal(
      formatSavedStatus(new Date(2026, 7, 13, 16, 45)),
      "已保存 16:45 · 自动保存已开启",
    );
  });
});
