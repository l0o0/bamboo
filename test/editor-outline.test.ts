import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  activeOutlineID,
  clampOutlinePosition,
  extractEditorOutline,
} from "../src/editor/outline.ts";

function markdownState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: GFM })],
  });
}

test("extracts ATX and Setext headings in document order", () => {
  const source = [
    "# One",
    "Two",
    "---",
    "### **Three** and [link](https://example.com)",
    "###### Six #",
  ].join("\n");

  assert.deepEqual(extractEditorOutline(markdownState(source)), [
    { id: "h1:0", level: 1, text: "One", from: 0 },
    {
      id: `h2:${source.indexOf("Two")}`,
      level: 2,
      text: "Two",
      from: source.indexOf("Two"),
    },
    {
      id: `h3:${source.indexOf("###")}`,
      level: 3,
      text: "Three and link",
      from: source.indexOf("###"),
    },
    {
      id: `h6:${source.indexOf("######")}`,
      level: 6,
      text: "Six",
      from: source.indexOf("######"),
    },
  ]);
});

test("excludes frontmatter, fenced code, and ordinary hash text", () => {
  const source = [
    "---",
    "title: Example",
    "# hidden frontmatter heading",
    "---",
    "",
    "```md",
    "# hidden code heading",
    "```",
    "ordinary # text",
    "## Visible",
  ].join("\n");
  const from = source.indexOf("## Visible");

  assert.deepEqual(extractEditorOutline(markdownState(source)), [
    { id: `h2:${from}`, level: 2, text: "Visible", from },
  ]);
});

test("finds the nearest preceding heading", () => {
  const items = [
    { id: "h1:0", level: 1 as const, text: "One", from: 0 },
    { id: "h2:20", level: 2 as const, text: "Two", from: 20 },
  ];

  assert.equal(activeOutlineID(items, 0), "h1:0");
  assert.equal(activeOutlineID(items, 19), "h1:0");
  assert.equal(activeOutlineID(items, 20), "h2:20");
  assert.equal(activeOutlineID(items, -1), null);
});

test("clamps stale positions and rejects invalid positions", () => {
  assert.equal(clampOutlinePosition(20, 50), 20);
  assert.equal(clampOutlinePosition(80, 50), 50);
  assert.equal(clampOutlinePosition(-4, 50), 0);
  assert.equal(clampOutlinePosition(Number.NaN, 50), null);
});
