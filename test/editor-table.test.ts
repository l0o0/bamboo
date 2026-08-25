import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  cellWidgetRange,
  liveTableRows,
  planTableTab,
  sameTableCellIdentity,
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
  it("keeps delimiter columns and alignment across valid pipe styles", () => {
    for (const [doc, expected] of [
      [
        "| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |",
        ["left", "center", "right"],
      ],
      [
        "A | B | C\n:--- | :---: | ---:\n1 | 2 | 3",
        ["left", "center", "right"],
      ],
      ["|A|B|C|\n|---|---|---|\n|1|2|3|", [null, null, null]],
      [
        "| A | B | C |\n| --- |  ---  | --- |\n| 1 | 2 | 3 |",
        [null, null, null],
      ],
    ]) {
      const state = EditorState.create({
        doc,
        extensions: [markdown({ extensions: GFM })],
      });
      const table = tableLayoutAt(state, doc.indexOf("B"));
      assert.ok(table, doc);
      assert.equal(table.columnCount, 3, doc);
      assert.deepEqual(table.alignments, expected, doc);
    }
  });

  it("keeps table width when a body row is shorter", () => {
    const doc = "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |";
    const state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: GFM })],
    });
    const table = tableLayoutAt(state, doc.indexOf("B"));
    assert.ok(table);
    assert.equal(table.columnCount, 3);
    assert.equal(
      table.rows.find((row) => row.kind === "body")?.cells.length,
      2,
    );
  });

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
      rows.map((row) => [
        row.line,
        row.kind,
        row.columnCount,
        row.visibleRowCount,
      ]),
      [
        [3, "header", 2, 3],
        [5, "body", 2, 3],
        [6, "body", 2, 3],
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

  it("gives trailing empty cells a non-zero widget range so they stay clickable", () => {
    const doc = "| A | B |  |  |\n| --- | --- | --- | --- |\n| 1 | 2 |  |  |";
    const state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: GFM })],
    });
    const rows = liveTableRows(state);
    assert.equal(rows[0].columnCount, 4);
    const ranges = rows.flatMap((row) =>
      row.cells.map((cell) => cellWidgetRange(cell)),
    );
    assert.ok(ranges.every((range) => !range.point && range.from < range.to));
    const last = rows[0].cells[3];
    assert.equal(last.from, last.to);
    assert.ok(cellWidgetRange(last).from < cellWidgetRange(last).to);
    const hideFrom = cellWidgetRange(last).to;
    assert.ok(hideFrom < state.doc.line(1).to);
  });

  it("keeps a fully empty last row clickable and non-point", () => {
    const doc =
      "| Column 1 | aaColumn 2aaaaa | abb | faaaaaa | fdafdf |\n" +
      "| --- | --- | --- | --- | --- |\n" +
      "| Cell | Cellbab | aadfdfdfd | bbb | fdafdfd |\n" +
      "|  |  |  |  |  |";
    const state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: GFM })],
    });
    const rows = liveTableRows(state);
    assert.equal(rows.length, 3);
    assert.equal(rows[2].isLast, true);
    assert.equal(rows[2].cells.length, 5);
    assert.ok(
      rows[2].cells.every((cell) => {
        const range = cellWidgetRange(cell);
        return !range.point && range.from < range.to && cell.from === cell.to;
      }),
    );
  });

  it("assigns stable row and column metadata to every visible cell", () => {
    const state = stateAt("Name", 1);
    const rows = liveTableRows(state);
    assert.deepEqual(
      rows.flatMap((row) =>
        row.cells.map((cell) => [cell.rowIndex, cell.columnIndex]),
      ),
      [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
        [2, 0],
        [2, 1],
      ],
    );
  });

  it("only reuses widget DOM for the same logical cell", () => {
    const cell = { tableFrom: 10, rowIndex: 1, columnIndex: 2 };
    assert.equal(
      sameTableCellIdentity(cell, {
        tableFrom: 10,
        rowIndex: 1,
        columnIndex: 2,
      }),
      true,
    );
    assert.equal(
      sameTableCellIdentity(cell, {
        tableFrom: 10,
        rowIndex: 1,
        columnIndex: 3,
      }),
      false,
    );
    assert.equal(
      sameTableCellIdentity(cell, {
        tableFrom: 11,
        rowIndex: 1,
        columnIndex: 2,
      }),
      false,
    );
  });
});

describe("GFM table empty cells", () => {
  const tableSource =
    "| Name | Value | Extra |\n" +
    "| --- | --- | --- |\n" +
    "| A | | C |\n" +
    "| D || F |\n";

  it("keeps empty and adjacent-pipe cells as columns", () => {
    const anchor = tableSource.indexOf("| A |");
    const state = EditorState.create({
      doc: tableSource,
      selection: { anchor },
      extensions: [markdown({ extensions: GFM })],
    });
    const table = tableLayoutAt(state, anchor);
    assert.ok(table);
    assert.equal(table.columnCount, 3);
    const body = table.rows.filter((row) => row.kind === "body");
    assert.equal(body.length, 2);
    // Row `| A | | C |` → cells A, "", C (empty cell preserved).
    assert.deepEqual(
      body[0].cells.map((cell) => state.doc.sliceString(cell.from, cell.to)),
      ["A", "", "C"],
    );
    // Row `| D || F |` → cells D, "", F (adjacent pipes keep the column).
    assert.deepEqual(
      body[1].cells.map((cell) => state.doc.sliceString(cell.from, cell.to)),
      ["D", "", "F"],
    );
  });
});
