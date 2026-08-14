import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { planTableEdgeAction } from "../src/editor/table-edge-actions.ts";

const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";

function state(doc = source) {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: GFM })],
  });
}

describe("Live table edge actions", () => {
  it("appends one final column from the right edge", () => {
    const editor = state();
    const plan = planTableEdgeAction(
      editor,
      source.indexOf("B"),
      "append-column",
    );
    assert.ok(plan);
    const next = editor.update({ changes: plan.changes }).state;
    assert.equal(
      next.doc.toString(),
      "| A | B |  |\n| --- | --- | --- |\n| 1 | 2 |  |",
    );
  });

  it("appends one final body row", () => {
    const editor = state();
    const plan = planTableEdgeAction(editor, source.indexOf("1"), "append-row");
    assert.ok(plan);
    const next = editor.update({ changes: plan.changes }).state;
    assert.equal(
      next.doc.toString(),
      "| A | B |\n| --- | --- |\n| 1 | 2 |\n|  |  |",
    );
  });

  it("appends after the widest row in a ragged table", () => {
    const ragged = "| A | B |\n| --- | --- |\n| 1 | 2 | 3 |";
    const editor = state(ragged);
    const plan = planTableEdgeAction(
      editor,
      ragged.indexOf("B"),
      "append-column",
    );
    assert.ok(plan);
    const next = editor.update({ changes: plan.changes }).state;
    assert.equal(
      next.doc.toString(),
      "| A | B |  |  |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 |  |",
    );
  });

  it("ignores positions outside a table", () => {
    assert.equal(planTableEdgeAction(state("plain"), 2, "append-row"), null);
  });
});
