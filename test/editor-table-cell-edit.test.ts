import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  activateTableCell,
  activateTableCellByIndex,
  eventTargetElement,
  interpretCellKey,
  isInsideSelector,
  planCellInput,
  planCellNavigation,
  remapActiveCell,
  sanitizeCellValue,
} from "../src/editor/table-cell-edit.ts";
import {
  planTableOperation,
  tableTargetAt,
} from "../src/editor/table-operations.ts";

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
    assert.match(next.doc.toString(), /\| A \| \*\*1\*\* \| new value \|/);
    assert.equal(activateTableCellByIndex(next, 0, 1, 1)?.value, "**1**");
    assert.equal(activateTableCellByIndex(next, 0, 1, 2)?.value, "new value");
  });

  it("keeps insert-column-right edits in the new column", () => {
    const editor = state();
    const target = tableTargetAt(editor, source.indexOf("Value"));
    assert.ok(target);
    const inserted = planTableOperation(editor, target, "insert-column-right");
    assert.ok(inserted);
    const next = editor.update({ changes: inserted.changes }).state;
    const cell = activateTableCellByIndex(
      next,
      inserted.target.tableFrom,
      1,
      inserted.target.columnIndex,
      0,
    );
    assert.ok(cell);
    assert.equal(cell.columnIndex, 2);
    const typed = planCellInput(next, cell, "added");
    assert.ok(typed);
    const edited = next.update({ changes: typed.changes }).state;
    assert.equal(activateTableCellByIndex(edited, 0, 1, 1)?.value, "**1**");
    assert.equal(activateTableCellByIndex(edited, 0, 1, 2)?.value, "added");
  });

  it("edits the second appended empty column without touching the first", () => {
    const appended =
      "| Name | Value |  |  |\n" +
      "| --- | --- | --- | --- |\n" +
      "| A | **1** |  |  |";
    const editor = state(appended);
    const first = activateTableCellByIndex(editor, 0, 1, 2, 0);
    const second = activateTableCellByIndex(editor, 0, 1, 3, 0);
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.columnIndex, 2);
    assert.equal(second.columnIndex, 3);
    const plan = planCellInput(editor, second, "col-d");
    assert.ok(plan);
    const next = editor.update({ changes: plan.changes }).state;
    assert.equal(activateTableCellByIndex(next, 0, 1, 1)?.value, "**1**");
    assert.equal(activateTableCellByIndex(next, 0, 1, 2)?.value, "");
    assert.equal(activateTableCellByIndex(next, 0, 1, 3)?.value, "col-d");
  });

  it("edits a filled cell without touching table pipes", () => {
    const editor = state();
    const cell = activateTableCell(editor, source.indexOf("Name") + 1, 4);
    assert.ok(cell);
    const deleted = planCellInput(editor, cell, "Nam");
    assert.ok(deleted);
    const afterDelete = editor.update({ changes: deleted.changes }).state;
    assert.equal(afterDelete.doc.toString(), source.replace("Name", "Nam"));
    assert.match(afterDelete.doc.toString(), /\| Nam \| Value \|/);

    const emptied = planCellInput(afterDelete, deleted.active, "");
    assert.ok(emptied);
    const afterEmpty = afterDelete.update({ changes: emptied.changes }).state;
    assert.match(afterEmpty.doc.toString(), /\| {2}\| Value \|/);
    assert.doesNotMatch(afterEmpty.doc.toString().split("\n")[0], /Name|Nam/);
  });

  it("escapes raw pipes so they cannot break the table", () => {
    assert.equal(sanitizeCellValue("a|b"), "a\\|b");
    assert.equal(sanitizeCellValue("a\\|b"), "a\\|b");
    const editor = state();
    const cell = activateTableCell(editor, source.indexOf("Name") + 1, 0);
    assert.ok(cell);
    const plan = planCellInput(editor, cell, "a|b");
    assert.ok(plan);
    const next = editor.update({ changes: plan.changes }).state;
    assert.match(next.doc.toString(), /\| a\\\|b \| Value \|/);
    assert.equal(activateTableCellByIndex(next, 0, 0, 0)?.value, "a\\|b");
    assert.equal(activateTableCellByIndex(next, 0, 0, 1)?.value, "Value");
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

  it("resolves Text-node event targets to their parent element", () => {
    const parent = {
      closest(selector: string) {
        return selector === ".zmd-lp-table-cell-editing" ? parent : null;
      },
    };
    const text = { parentElement: parent };
    const event = {
      target: text,
      composedPath() {
        return [text, parent];
      },
    } as unknown as Event;
    assert.equal(eventTargetElement(event), parent);
    assert.equal(isInsideSelector(event, ".zmd-lp-table-cell-editing"), true);
  });

  it("applies printable keys and backspace to the logical cell value", () => {
    assert.deepEqual(interpretCellKey("Cell", 4, "x"), {
      kind: "input",
      value: "Cellx",
      caretOffset: 5,
    });
    assert.deepEqual(interpretCellKey("Cell", 4, "Backspace"), {
      kind: "input",
      value: "Cel",
      caretOffset: 3,
    });
    assert.equal(interpretCellKey("Cell", 4, "a", { meta: true }).kind, "pass");
    assert.equal(interpretCellKey("Cell", 4, "Enter").kind, "commit");
    assert.deepEqual(interpretCellKey("Cell", 2, "Tab", { shift: true }), {
      kind: "navigate",
      backwards: true,
    });
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
