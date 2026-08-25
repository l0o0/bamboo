import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseAtxHeading,
  parseBlockQuotePrefix,
  fencedCodeLineKindsFromLines,
  parseListPrefix,
} from "../src/editor/live-preview/structure.ts";
import { parseInlineL2 } from "../src/editor/live-preview/inline.ts";

describe("parseAtxHeading", () => {
  it("parses h1", () => {
    const r = parseAtxHeading("# Hello");
    assert.equal(r?.level, 1);
    assert.equal(r?.markEnd, 2);
    assert.equal(r?.textStart, 2);
  });
  it("parses h2", () => {
    const r = parseAtxHeading("## Title");
    assert.equal(r?.level, 2);
    assert.equal(r?.markEnd, 3);
  });
  it("rejects non-heading", () => {
    assert.equal(parseAtxHeading("not a heading"), null);
  });
});

describe("parseListPrefix", () => {
  it("parses unordered list", () => {
    const r = parseListPrefix("- item");
    assert.ok(r);
    assert.equal(r!.markEnd, 2);
  });
  it("parses ordered list", () => {
    const r = parseListPrefix("1. item");
    assert.ok(r);
    assert.equal(r!.markEnd, 3);
  });

  it("preserves nested unordered-list indentation and marker", () => {
    const r = parseListPrefix("    - nested item");
    assert.ok(r);
    assert.equal(r!.indent, "    ");
    assert.equal(r!.marker, "-");
    assert.equal(r!.ordered, false);
    assert.equal(r!.markEnd, 6);
  });

  it("identifies ordered-list marker for its live label", () => {
    const r = parseListPrefix("  10. item");
    assert.ok(r);
    assert.equal(r!.indent, "  ");
    assert.equal(r!.marker, "10.");
    assert.equal(r!.ordered, true);
  });
});

describe("parseBlockQuotePrefix", () => {
  it("parses quote", () => {
    const r = parseBlockQuotePrefix("> hello");
    assert.ok(r);
    assert.ok(r!.markEnd >= 1);
  });
});

describe("parseInlineL2", () => {
  it("finds inline code", () => {
    const r = parseInlineL2("x `code` y");
    assert.ok(r.some((x) => x.kind === "code"));
    assert.ok(r.some((x) => x.kind === "mark" && x.from === 2));
  });
  it("supports multi-backtick code runs", () => {
    const r = parseInlineL2("``code``");
    assert.ok(r.some((x) => x.kind === "code" && x.from === 2 && x.to === 6));
  });
  it("finds links", () => {
    const r = parseInlineL2("see [text](https://ex.com) end");
    assert.ok(r.some((x) => x.kind === "link"));
  });
  it("finds strikethrough markers and content", () => {
    const r = parseInlineL2("before ~~deleted~~ after");
    assert.deepEqual(
      r.filter((x) => x.kind === "strike"),
      [{ from: 9, to: 16, kind: "strike" }],
    );
    assert.equal(r.filter((x) => x.kind === "mark").length, 2);
  });
  it("ignores escaped bold / strikethrough markers", () => {
    const r = parseInlineL2("\\*\\*not bold\\*\\* \\~\\~not strike\\~\\~");
    assert.equal(
      r.some((x) => x.kind === "strong"),
      false,
    );
    assert.equal(
      r.some((x) => x.kind === "strike"),
      false,
    );
    assert.equal(
      r.some((x) => x.kind === "em"),
      false,
    );
  });
  it("skips escaped closing markers", () => {
    const r = parseInlineL2("**bold\\** tail");
    // The `\**` after "bold" is escaped, so no strong range is produced.
    assert.equal(
      r.some((x) => x.kind === "strong"),
      false,
    );
  });
});

describe("fencedCodeLineKindsFromLines", () => {
  it("marks paired fence and content lines", () => {
    assert.deepEqual(
      fencedCodeLineKindsFromLines([
        "before",
        "```ts",
        "const value = 1",
        "```",
        "after",
      ]),
      [null, "fence-open", "content", "fence-close", null],
    );
  });

  it("does not treat an unclosed fence as a rendered block", () => {
    assert.deepEqual(fencedCodeLineKindsFromLines(["before", "```", "code"]), [
      null,
      null,
      null,
    ]);
  });

  it("does not close a fence on a line with trailing info (CommonMark)", () => {
    // ` ```js ` inside a python fence is content, not a closing fence.
    assert.deepEqual(
      fencedCodeLineKindsFromLines([
        "```python",
        "code",
        "```js",
        "more",
        "```",
      ]),
      ["fence-open", "content", "content", "content", "fence-close"],
    );
  });
});

describe("edge-case parses", () => {
  it("recognizes a bare `#` as an empty heading", () => {
    const r = parseAtxHeading("#");
    assert.equal(r?.level, 1);
    assert.equal(r?.markEnd, 1);
    assert.equal(parseAtxHeading("#Hello"), null);
  });

  it("limits ordered-list markers to nine digits (CommonMark)", () => {
    assert.ok(parseListPrefix("123456789. item"));
    assert.equal(parseListPrefix("1234567890. item"), null);
  });

  it("skips long uniform delimiter runs without producing ranges", () => {
    const r = parseInlineL2("*".repeat(10000));
    assert.equal(r.length, 0);
    const t = parseInlineL2("~".repeat(5000));
    assert.equal(t.length, 0);
  });
});
