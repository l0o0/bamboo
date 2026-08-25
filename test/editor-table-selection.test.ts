import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  isTableHandleClick,
  remapTableSelection,
  sameTableSelection,
  selectionAfterDelete,
  selectionContainsCell,
  type TableSelection,
} from "../src/editor/table-selection.ts";
import { tableLayoutAt } from "../src/editor/table.ts";

const source =
  "Before\n\n" +
  "| A | B | C |\n" +
  "| --- | --- | --- |\n" +
  "| 1 | 2 | 3 |\n" +
  "| 4 | 5 | 6 |\n" +
  "\nAfter";

function stateFor(doc = source) {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: GFM })],
  });
}

describe("table selection identity", () => {
  it("matches only the same logical row or column", () => {
    assert.equal(
      sameTableSelection(
        { kind: "column", tableFrom: 0, columnIndex: 1 },
        { kind: "column", tableFrom: 0, columnIndex: 1 },
      ),
      true,
    );
    assert.equal(
      sameTableSelection(
        { kind: "column", tableFrom: 0, columnIndex: 1 },
        { kind: "column", tableFrom: 0, columnIndex: 2 },
      ),
      false,
    );
    assert.equal(
      sameTableSelection(
        { kind: "row", tableFrom: 0, rowIndex: 1 },
        { kind: "column", tableFrom: 0, columnIndex: 1 },
      ),
      false,
    );
    assert.equal(sameTableSelection(null, null), true);
  });

  it("matches cells inside a selected row or column", () => {
    const row: TableSelection = { kind: "row", tableFrom: 0, rowIndex: 1 };
    const column: TableSelection = {
      kind: "column",
      tableFrom: 0,
      columnIndex: 1,
    };
    assert.equal(selectionContainsCell(row, 1, 2), true);
    assert.equal(selectionContainsCell(row, 2, 2), false);
    assert.equal(selectionContainsCell(column, 0, 1), true);
    assert.equal(selectionContainsCell(column, 2, 0), false);
    assert.equal(selectionContainsCell(null, 1, 1), false);
  });
});

describe("table selection remapping", () => {
  it("remaps a table selection after content is inserted before the table", () => {
    const editor = stateFor();
    const tableFrom = source.indexOf("| A |");
    const selection: TableSelection = {
      kind: "row",
      tableFrom,
      rowIndex: 2,
    };
    const changes = { from: 0, to: 0, insert: "Intro\n\n" };
    const update = editor.update({ changes });
    const nextState = update.state;
    assert.deepEqual(
      remapTableSelection(nextState, selection, update.changes),
      {
        kind: "row",
        tableFrom: tableFrom + changes.insert.length,
        rowIndex: 2,
      },
    );
  });

  it("clears selection when its table no longer exists", () => {
    const editor = stateFor();
    const tableFrom = source.indexOf("| A |");
    const selection: TableSelection = {
      kind: "column",
      tableFrom,
      columnIndex: 1,
    };
    const changes = {
      from: tableFrom - 2,
      to: source.indexOf("\n\nAfter"),
      insert: "removed",
    };
    const update = editor.update({ changes });
    const nextState = update.state;
    assert.equal(
      remapTableSelection(nextState, selection, update.changes),
      null,
    );
  });
});

describe("table selection after deletion", () => {
  it("selects the next row or the previous row at the end", () => {
    const editor = stateFor();
    const layout = tableLayoutAt(editor, source.indexOf("| A |") + 1);
    assert.ok(layout);
    const afterRowDelete = stateFor(source.replace("| 1 | 2 | 3 |\n", ""));
    const nextRowLayout = tableLayoutAt(
      afterRowDelete,
      afterRowDelete.doc.toString().indexOf("| A |") + 1,
    );
    assert.ok(nextRowLayout);
    assert.deepEqual(
      selectionAfterDelete(
        { kind: "row", tableFrom: layout.from, rowIndex: 1 },
        nextRowLayout,
        1,
      ),
      { kind: "row", tableFrom: layout.from, rowIndex: 1 },
    );
    assert.deepEqual(
      selectionAfterDelete(
        { kind: "row", tableFrom: layout.from, rowIndex: 2 },
        nextRowLayout,
        2,
      ),
      { kind: "row", tableFrom: layout.from, rowIndex: 1 },
    );
  });

  it("keeps a valid adjacent column after deleting the final column", () => {
    const editor = stateFor();
    const layout = tableLayoutAt(editor, source.indexOf("| A |") + 1);
    assert.ok(layout);
    const afterColumnDelete = stateFor(
      source
        .replace("| A | B | C |", "| A | B |")
        .replace("| --- | --- | --- |", "| --- | --- |")
        .replace("| 1 | 2 | 3 |", "| 1 | 2 |")
        .replace("| 4 | 5 | 6 |", "| 4 | 5 |"),
    );
    const nextColumnLayout = tableLayoutAt(
      afterColumnDelete,
      afterColumnDelete.doc.toString().indexOf("| A |") + 1,
    );
    assert.ok(nextColumnLayout);
    assert.deepEqual(
      selectionAfterDelete(
        { kind: "column", tableFrom: layout.from, columnIndex: 2 },
        nextColumnLayout,
        2,
      ),
      { kind: "column", tableFrom: layout.from, columnIndex: 1 },
    );
  });
});

describe("table handle click threshold", () => {
  it("distinguishes a click from a drag", () => {
    assert.equal(isTableHandleClick(10, 10, 13, 10), true);
    assert.equal(isTableHandleClick(10, 10, 15, 10), false);
  });
});
