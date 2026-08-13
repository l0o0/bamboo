import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  liveTableRows,
  planTableTab,
  tableLayoutAt,
} from "../src/editor/table.ts";

const source =
  "Before\n\n" +
  "| Name | Value |\n" +
  "| :--- | ---: |\n" +
  "| A | 1 |\n" +
  "| B | 2 |\n";

function stateAt(needle: string, offset = 0) {
  const anchor = source.indexOf(needle) + offset;
  return EditorState.create({
    doc: source,
    selection: { anchor },
    extensions: [markdown({ extensions: GFM })],
  });
}

describe("GFM table editing", () => {
  it("derives rows, cells, and alignment from the syntax tree", () => {
    const state = stateAt("Name", 1);
    const table = tableLayoutAt(state, state.selection.main.head);
    assert.ok(table);
    assert.equal(table.columnCount, 2);
    assert.deepEqual(
      table.rows.map((row) => row.kind),
      ["header", "delimiter", "body", "body"],
    );
    assert.deepEqual(table.alignments, ["left", "right"]);
    assert.equal(
      state.doc.sliceString(
        table.rows[0].cells[0].from,
        table.rows[0].cells[0].to,
      ),
      "Name",
    );
  });

  it("moves Tab to the next cell", () => {
    const state = stateAt("Name", 1);
    const plan = planTableTab(state, false);
    assert.ok(plan);
    assert.equal(state.doc.sliceString(plan.anchor, plan.head), "Value");
    assert.equal(plan.changes, undefined);
  });

  it("appends a row when Tab leaves the final cell", () => {
    const state = stateAt("| B | 2 |", 6);
    const plan = planTableTab(state, false);
    assert.ok(plan?.changes);
    assert.equal(plan.changes.insert, "|  |  |\n");
    assert.equal(plan.anchor, plan.changes.from + 2);
  });

  it("plans aligned Live rows while omitting the Markdown delimiter row", () => {
    const state = stateAt("Name", 1);
    const rows = liveTableRows(state);
    assert.deepEqual(
      rows.map((row) => [row.line, row.kind, row.columnCount]),
      [
        [3, "header", 2],
        [5, "body", 2],
        [6, "body", 2],
      ],
    );
    assert.deepEqual(rows[0].alignments, ["left", "right"]);
  });

  it("retains logical ranges for empty cells", () => {
    const doc = "| A | B |\n| --- | --- |\n|  | value |";
    const state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: GFM })],
    });
    const table = tableLayoutAt(state, doc.indexOf("value"));
    assert.ok(table);
    const body = table.rows.find((row) => row.kind === "body");
    assert.equal(body?.cells.length, 2);
    assert.equal(body?.cells[0].from, body?.cells[0].to);
  });
});
