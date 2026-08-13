import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  imageInsertTemplate,
  tableInsertTemplate,
} from "../src/modules/markdown/insert-template.ts";
import { iconH3 } from "../src/modules/markdown/icons.ts";

describe("toolbar insert templates", () => {
  it("inserts a small editable table template", () => {
    assert.deepEqual(tableInsertTemplate(), {
      text: "| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |",
      selectionFrom: 2,
      selectionTo: 10,
    });
  });

  it("selects image alt text after insertion", () => {
    assert.deepEqual(imageInsertTemplate(), {
      text: "![alt](url)",
      selectionFrom: 2,
      selectionTo: 5,
    });
  });

  it("renders heading 3 with distinct upper and lower strokes", () => {
    const icon = iconH3();
    assert.match(icon, /M17\.5 10\.5/);
    assert.match(icon, /M17 17\.5/);
    assert.doesNotMatch(icon, /M21 12c0-1\.5/);
  });
});
