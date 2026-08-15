import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  planTableMoveColumnTo,
  planTableMoveRowTo,
  planTableOperation,
  tableTargetAt,
  type TableAction,
} from "../src/editor/table-operations.ts";

const source =
  "Before\n\n" +
  "| Name | Value |\n" +
  "| :--- | ---: |\n" +
  "| A | **1** |\n" +
  "| B | 2 |\n" +
  "\nAfter";

function stateFor(doc = source) {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: GFM })],
  });
}

function apply(doc: string, needle: string, action: TableAction, offset = 1) {
  const state = stateFor(doc);
  const target = tableTargetAt(state, doc.indexOf(needle) + offset);
  assert.ok(target, `expected a table target for ${needle}`);
  const plan = planTableOperation(state, target, action);
  if (!plan) return null;
  const next = state.update({
    changes: plan.changes,
    selection: plan.selection,
  }).state;
  return {
    plan,
    doc: next.doc.toString(),
    selected: next.sliceDoc(plan.selection.anchor, plan.selection.head),
  };
}

describe("table row operations", () => {
  it("resolves source whitespace inside a logical cell", () => {
    const state = stateFor();
    const row = source.indexOf("| A | **1** |");
    assert.equal(tableTargetAt(state, row + 1)?.columnIndex, 0);
    assert.equal(tableTargetAt(state, row + 5)?.columnIndex, 1);
    const delimiter = source.indexOf("| :---");
    assert.equal(tableTargetAt(state, delimiter + 2), null);

    const emptyDoc = "| A | B |\n| --- | --- |\n|  | value |";
    const emptyState = stateFor(emptyDoc);
    const empty = tableTargetAt(emptyState, emptyDoc.lastIndexOf("|  |") + 2);
    assert.equal(empty?.rowIndex, 1);
    assert.equal(empty?.columnIndex, 0);
  });

  it("inserts an empty body row above and selects the matching column", () => {
    const result = apply(source, "**1**", "insert-row-above");
    assert.ok(result);
    assert.equal(
      result.doc,
      "Before\n\n| Name | Value |\n| :--- | ---: |\n|  |  |\n| A | **1** |\n| B | 2 |\n\nAfter",
    );
    assert.equal(result.selected, "");
    assert.equal(result.plan.target.rowIndex, 1);
    assert.equal(result.plan.target.columnIndex, 1);
  });

  it("inserts the first body row when invoked from the header", () => {
    const result = apply(source, "Value", "insert-row-below");
    assert.ok(result);
    assert.match(result.doc, /\| :--- \| ---: \|\n\| {2}\| {2}\|\n\| A/);
    assert.equal(result.plan.target.rowIndex, 1);
  });

  it("deletes only body rows and selects the adjacent row", () => {
    const result = apply(source, "**1**", "delete-row");
    assert.ok(result);
    assert.doesNotMatch(result.doc, /\*\*1\*\*/);
    assert.equal(result.selected, "2");
    assert.equal(apply(source, "Value", "delete-row"), null);
  });

  it("moves a body row and rejects boundary moves", () => {
    const moved = apply(source, "2 |", "move-row-up");
    assert.ok(moved);
    assert.match(moved.doc, /\| B \| 2 \|\n\| A \| \*\*1\*\* \|/);
    assert.equal(moved.selected, "2");
    assert.equal(apply(source, "A |", "move-row-up"), null);
    assert.equal(apply(source, "2 |", "move-row-down"), null);
  });
});

describe("table column and alignment operations", () => {
  it("inserts columns across header and body", () => {
    const left = apply(source, "**1**", "insert-column-left");
    assert.ok(left);
    assert.match(
      left.doc,
      /\| Name \| {2}\| Value \|\n\| :--- \| --- \| ---: \|/,
    );
    assert.match(left.doc, /\| A \| {2}\| \*\*1\*\* \|/);
    assert.equal(left.plan.target.columnIndex, 1);
  });

  it("moves columns with contents and alignments together", () => {
    const moved = apply(source, "Value", "move-column-left");
    assert.ok(moved);
    assert.match(moved.doc, /\| Value \| Name \|\n\| ---: \| :--- \|/);
    assert.match(moved.doc, /\| \*\*1\*\* \| A \|/);
    assert.equal(moved.selected, "Value");
    assert.equal(apply(source, "Name", "move-column-left"), null);
    assert.equal(apply(source, "Value", "move-column-right"), null);
  });

  it("deletes a column but protects the final column", () => {
    const deleted = apply(source, "Value", "delete-column");
    assert.ok(deleted);
    assert.match(deleted.doc, /\| Name \|\n\| :--- \|\n\| A \|/);
    assert.doesNotMatch(deleted.doc, /Value|\*\*1\*\*/);
    const oneColumn = "| Name |\n| --- |\n| A |";
    assert.equal(apply(oneColumn, "Name", "delete-column"), null);
  });

  for (const [action, marker] of [
    ["align-default", "---"],
    ["align-left", ":---"],
    ["align-center", ":---:"],
    ["align-right", "---:"],
  ] as const) {
    it(`serializes ${action}`, () => {
      const result = apply(source, "Name", action);
      if (action === "align-left") {
        assert.equal(result, null);
      } else {
        assert.ok(result);
        assert.match(
          result.doc,
          new RegExp(`\\| ${marker.replaceAll(":", "\\:")} \\| ---:`),
        );
      }
    });
  }

  it("preserves inline Markdown and escaped pipes while padding short rows", () => {
    const doc =
      "| Label | Value |\n" +
      "| --- | --- |\n" +
      "| [A](https://example.com) | x \\| y |\n" +
      "| Short | |";
    const inserted = apply(doc, "Value", "insert-column-right");
    assert.ok(inserted);
    assert.match(inserted.doc, /\[A\]\(https:\/\/example\.com\)/);
    assert.match(inserted.doc, /x \\\| y/);
    assert.match(inserted.doc, /\| Short \| {2}\| {2}\|/);
  });
});

describe("table drag reordering", () => {
  const doc =
    "| A | B | C |\n" +
    "| --- | --- | --- |\n" +
    "| 1 | 2 | 3 |\n" +
    "| 4 | 5 | 6 |";

  it("moves a body row directly to another body index", () => {
    const state = stateFor(doc);
    const plan = planTableMoveRowTo(state, doc.indexOf("| A"), 1, 2);
    assert.ok(plan);
    const next = state.update({ changes: plan.changes }).state;
    assert.match(next.doc.toString(), /\| 4 \| 5 \| 6 \|\n\| 1 \| 2 \| 3 \|/);
  });

  it("rejects header row drags and out-of-range row targets", () => {
    const state = stateFor(doc);
    assert.equal(planTableMoveRowTo(state, doc.indexOf("| A"), 0, 1), null);
    assert.equal(planTableMoveRowTo(state, doc.indexOf("| A"), 1, 99), null);
  });

  it("moves a column and its alignment directly", () => {
    const state = stateFor(doc);
    const plan = planTableMoveColumnTo(state, doc.indexOf("| A"), 0, 2);
    assert.ok(plan);
    const next = state.update({ changes: plan.changes }).state;
    assert.match(next.doc.toString(), /\| B \| C \| A \|/);
  });

  it("rejects out-of-range column targets", () => {
    const state = stateFor(doc);
    assert.equal(planTableMoveColumnTo(state, doc.indexOf("| A"), 0, 3), null);
  });
});
