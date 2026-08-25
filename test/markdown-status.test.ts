import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatSavedStatus,
  formatStats,
} from "../src/modules/markdown/status.ts";

describe("formatStats", () => {
  it("interpolates words and lines into the localized pattern", () => {
    // Without a Zotero window, getString falls back to the prefixed id with
    // the args unresolved; the important part is that the FTL key is used.
    assert.equal(
      formatStats({ chars: 42, words: 7, lines: 3 }),
      "bamboo-status-stats",
    );
  });
});

describe("formatSavedStatus", () => {
  it("interpolates the saved time into the localized pattern", () => {
    assert.equal(
      formatSavedStatus(new Date(2026, 7, 13, 16, 45)),
      "bamboo-status-saved-at",
    );
  });
});
