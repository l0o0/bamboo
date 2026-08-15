import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  activateTableCell,
  activateTableCellByIndex,
  planCellInput,
  planCellNavigation,
  remapActiveCell,
} from "../src/editor/table-cell-edit.ts";

const source =
  "| Name | Value |\n" + "| --- | --- |\n" + "| A | **1** |\n" + "|  | last |";

function state(doc = source) {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: GFM })],
  });
}

describe("Live table cell editing", () => {
  it("activates a logical cell and clamps the click offset", () => {
    const editor = state();
    const cell = activateTableCell(editor, source.indexOf("**1**") + 2, 99);
    assert.ok(cell);
    assert.equal(cell.rowIndex, 1);
    assert.equal(cell.columnIndex, 1);
    assert.equal(cell.value, "**1**");
    assert.equal(cell.caretOffset, 5);
  });

  it("activates an empty cell with a zero-width content range", () => {
    const editor = state();
    const emptyPipe = source.lastIndexOf("|  |") + 2;
    const cell = activateTableCell(editor, emptyPipe, 0);
    assert.ok(cell);
    assert.equal(cell.value, "");
    assert.equal(cell.from, cell.to);
    assert.equal(cell.columnIndex, 0);
  });

  it("activates and edits a newly appended empty cell by logical index", () => {
    const appended =
      "| Name | Value |  |\n" + "| --- | --- | --- |\n" + "| A | **1** |  |";
    const editor = state(appended);
    const cell = activateTableCellByIndex(editor, 0, 1, 2, 0);
    assert.ok(cell);
    assert.equal(cell.rowIndex, 1);
    assert.equal(cell.columnIndex, 2);
    assert.equal(cell.value, "");
    const plan = planCellInput(editor, cell, "new value");
    assert.ok(plan);
    const next = editor.update({ changes: plan.changes }).state;
    assert.match(next.doc.toString(), /\| A \| \*\*1\*\* \| {2}new value\|/);
  });

  it("replaces only cell content and preserves table structure", () => {
    const editor = state();
    const cell = activateTableCell(editor, source.indexOf("**1**") + 1, 0);
    assert.ok(cell);
    const plan = planCellInput(editor, cell, "`two`");
    assert.ok(plan);
    const next = editor.update({ changes: plan.changes }).state;
    assert.match(next.doc.toString(), /\| A \| `two` \|/);
    assert.equal(plan.active.rowIndex, 1);
    assert.equal(plan.active.columnIndex, 1);
  });

  it("remaps the same logical cell after its content changes", () => {
    const editor = state();
    const cell = activateTableCell(editor, source.indexOf("**1**") + 1, 0);
    assert.ok(cell);
    const plan = planCellInput(editor, cell, "longer value", 7);
    assert.ok(plan);
    const next = editor.update({ changes: plan.changes }).state;
    const remapped = remapActiveCell(next, plan.active);
    assert.equal(remapped?.value, "longer value");
    assert.equal(remapped?.caretOffset, 7);
  });

  it("drops an active target when its table no longer exists", () => {
    const editor = state();
    const cell = activateTableCell(editor, source.indexOf("**1**") + 1, 0);
    assert.ok(cell);
    assert.equal(remapActiveCell(state("plain text"), cell), null);
  });

  it("remaps a table after content is inserted before it", () => {
    const editor = state();
    const cell = activateTableCell(editor, source.indexOf("**1**") + 1, 2);
    assert.ok(cell);
    const changes = editor.changes({ from: 0, insert: "intro\n\n" });
    const next = editor.update({ changes }).state;
    const remapped = remapActiveCell(
      next,
      cell,
      changes.mapPos(cell.tableFrom, 1),
    );
    assert.equal(remapped?.value, "**1**");
    assert.equal(remapped?.rowIndex, 1);
    assert.equal(remapped?.columnIndex, 1);
  });

  it("navigates adjacent cells and appends a row at the final cell", () => {
    const editor = state();
    const middle = activateTableCell(editor, source.indexOf("**1**") + 1, 0);
    assert.ok(middle);
    const previous = planCellNavigation(editor, middle, true);
    assert.equal(previous?.active.columnIndex, 0);
    assert.equal(previous?.active.rowIndex, 1);

    const final = activateTableCell(editor, source.indexOf("last") + 1, 0);
    assert.ok(final);
    const appended = planCellNavigation(editor, final, false);
    assert.ok(appended?.changes);
    const next = editor.update({ changes: appended.changes }).state;
    assert.match(next.doc.toString(), /\| {2}\| {2}\|\n$/);
    assert.equal(appended.active.rowIndex, 3);
    assert.equal(appended.active.columnIndex, 0);
    const edited = planCellInput(next, appended.active, "new row");
    assert.ok(edited);
    const editedState = next.update({ changes: edited.changes }).state;
    assert.equal(
      activateTableCellByIndex(editedState, 0, 3, 0)?.value,
      "new row",
    );
    assert.equal(activateTableCellByIndex(editedState, 0, 2, 0)?.value, "");
  });
});
