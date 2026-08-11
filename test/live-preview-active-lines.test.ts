import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activeLinesFromSelection,
  frontmatterLineNumbers,
  shouldSkipLiveLine,
} from "../src/editor/live-preview/active-lines.ts";
import type { DocLines, LineInfo } from "../src/editor/live-preview/types.ts";

function docFrom(text: string): DocLines {
  const parts = text.split("\n");
  let pos = 0;
  const infos: LineInfo[] = parts.map((t, i) => {
    const from = pos;
    const to = pos + t.length;
    pos = to + 1;
    return { number: i + 1, from, to, text: t };
  });
  return {
    lines: infos.length,
    line: (n: number) => infos[n - 1],
    lineAt: (offset: number) => {
      for (const info of infos) {
        if (offset <= info.to) return info;
        // between lines (at \n): belongs to previous until next line start
        if (offset === info.to + 1 && info.number < infos.length) {
          // newline after this line → start of next
          continue;
        }
      }
      // clamp
      for (let i = infos.length - 1; i >= 0; i--) {
        if (offset >= infos[i].from) return infos[i];
      }
      return infos[0];
    },
  };
}

describe("activeLinesFromSelection", () => {
  it("marks single cursor line", () => {
    const d = docFrom("a\nb\nc");
    // offset 2 is start of line 2 ("b")
    const set = activeLinesFromSelection(d, 2, 2);
    assert.deepEqual([...set].sort((a, b) => a - b), [2]);
  });

  it("marks all lines covered by selection", () => {
    const d = docFrom("a\nb\nc");
    // "a\nb" covers lines 1-2
    const set = activeLinesFromSelection(d, 0, 3);
    assert.ok(set.has(1) && set.has(2));
    assert.equal(set.has(3), false);
  });
});

describe("frontmatterLineNumbers", () => {
  it("detects yaml fence block at start", () => {
    const text = "---\ntitle: x\n---\n\n# Hi";
    const set = frontmatterLineNumbers(text);
    assert.ok(set.has(1) && set.has(2) && set.has(3));
    assert.equal(set.has(5), false);
  });

  it("returns empty when no frontmatter", () => {
    const set = frontmatterLineNumbers("# Hi\n");
    assert.equal(set.size, 0);
  });
});

describe("shouldSkipLiveLine", () => {
  it("skips active and frontmatter lines", () => {
    assert.equal(shouldSkipLiveLine(1, new Set([1]), new Set()), true);
    assert.equal(shouldSkipLiveLine(2, new Set(), new Set([2])), true);
    assert.equal(shouldSkipLiveLine(3, new Set([1]), new Set([2])), false);
  });
});
