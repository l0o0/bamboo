import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseAtxHeading,
  parseBlockQuotePrefix,
  parseListPrefix,
} from "../src/editor/live-preview/structure.ts";
import {
  parseInlineL1,
  parseInlineL2,
} from "../src/editor/live-preview/inline.ts";

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
});

describe("parseBlockQuotePrefix", () => {
  it("parses quote", () => {
    const r = parseBlockQuotePrefix("> hello");
    assert.ok(r);
    assert.ok(r!.markEnd >= 1);
  });
});

describe("parseInlineL1", () => {
  it("finds bold markers", () => {
    const r = parseInlineL1("a **b** c");
    const marks = r.filter((x) => x.kind === "mark");
    assert.ok(marks.some((m) => m.from === 2 && m.to === 4));
    assert.ok(marks.some((m) => m.from === 5 && m.to === 7));
    assert.ok(r.some((x) => x.kind === "strong" && x.from === 4 && x.to === 5));
  });
});

describe("parseInlineL2", () => {
  it("finds inline code", () => {
    const r = parseInlineL2("x `code` y");
    assert.ok(r.some((x) => x.kind === "code"));
    assert.ok(r.some((x) => x.kind === "mark" && x.from === 2));
  });
  it("finds links", () => {
    const r = parseInlineL2("see [text](https://ex.com) end");
    assert.ok(r.some((x) => x.kind === "link"));
  });
});
