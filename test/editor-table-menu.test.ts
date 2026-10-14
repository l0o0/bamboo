import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tableMenuItems } from "../src/editor/table-menu.ts";
import type { TableTarget } from "../src/editor/table-operations.ts";
import type { TableSelection } from "../src/editor/table-selection.ts";
import { DEFAULT_TABLE_LABELS } from "../src/editor/table-labels.ts";

function target(overrides: Partial<TableTarget> = {}): TableTarget {
  return {
    tableFrom: 0,
    rowIndex: 1,
    columnIndex: 1,
    bodyRowCount: 3,
    columnCount: 3,
    alignment: "center",
    ...overrides,
  };
}

describe("table context menu state", () => {
  it("keeps stable row, column, and alignment groups", () => {
    const groups = tableMenuItems(target(), false);
    assert.deepEqual(
      groups.map((group) => group.map((item) => item.action)),
      [
        [
          "insert-row-above",
          "insert-row-below",
          "move-row-up",
          "move-row-down",
          "delete-row",
        ],
        [
          "insert-column-left",
          "insert-column-right",
          "move-column-left",
          "move-column-right",
        ],
        ["align-default", "align-left", "align-center", "align-right"],
      ],
    );
  });

  it("disables header row mutation but keeps insertion available", () => {
    const items = tableMenuItems(target({ rowIndex: 0 }), false).flat();
    const state = Object.fromEntries(
      items.map((item) => [item.action, item.disabled]),
    );
    assert.equal(state["insert-row-above"], false);
    assert.equal(state["insert-row-below"], false);
    assert.equal(state["move-row-up"], true);
    assert.equal(state["move-row-down"], true);
    assert.equal(state["delete-row"], true);
  });

  it("disables boundary moves", () => {
    const first = tableMenuItems(target({ rowIndex: 1 }), false).flat();
    assert.equal(
      first.find((item) => item.action === "move-row-up")?.disabled,
      true,
    );
    const last = tableMenuItems(target({ rowIndex: 3 }), false).flat();
    assert.equal(
      last.find((item) => item.action === "move-row-down")?.disabled,
      true,
    );
  });

  it("marks current alignment and disables every action when read-only", () => {
    const editable = tableMenuItems(target(), false).flat();
    assert.equal(
      editable.find((item) => item.action === "align-center")?.checked,
      true,
    );
    assert.equal(
      editable.find((item) => item.action === "align-left")?.checked,
      false,
    );
    assert.ok(
      tableMenuItems(target(), true)
        .flat()
        .every((item) => item.disabled),
    );
  });

  it("scopes menu actions to a selected row", () => {
    const selection: TableSelection = {
      kind: "row",
      tableFrom: 0,
      rowIndex: 1,
    };
    const actions = tableMenuItems(target(), false, selection)
      .flat()
      .map((item) => item.action);
    assert.ok(actions.includes("clear-selection"));
    assert.ok(actions.includes("delete-selection"));
    assert.ok(!actions.includes("delete-row"));
    assert.equal(
      actions.filter((action) => action.startsWith("delete-")).length,
      1,
    );
    assert.ok(actions.includes("insert-row-above"));
    assert.ok(!actions.includes("insert-column-left"));
    assert.ok(
      !actions.some((action) =>
        ["copy", "cut", "paste"].includes(String(action)),
      ),
    );
  });

  it("disables deletion for a selected final column", () => {
    const selection: TableSelection = {
      kind: "column",
      tableFrom: 0,
      columnIndex: 0,
    };
    const deleteItem = tableMenuItems(
      target({ columnCount: 1, columnIndex: 0 }),
      false,
      selection,
    )
      .flat()
      .find((item) => item.action === "delete-selection");
    assert.equal(deleteItem?.disabled, true);
  });

  it("disables every mutation action in read-only selection menus", () => {
    const selection: TableSelection = {
      kind: "column",
      tableFrom: 0,
      columnIndex: 1,
    };
    const items = tableMenuItems(target(), true, selection).flat();
    assert.ok(items.every((item) => item.disabled));
  });

  it("uses the supplied locale for both cell and selected-row commands", () => {
    const labels = {
      ...DEFAULT_TABLE_LABELS,
      "delete-row": "删除行",
      "delete-selected-row": "删除选中的行",
      "align-left": "左对齐",
    };
    const cell = tableMenuItems(target(), false, null, labels).flat();
    assert.equal(
      cell.find((item) => item.action === "delete-row")?.label,
      "删除行",
    );
    const selected = tableMenuItems(
      target(),
      false,
      {
        kind: "row",
        tableFrom: 0,
        rowIndex: 1,
      },
      labels,
    ).flat();
    assert.equal(
      selected.find((item) => item.action === "delete-selection")?.label,
      "删除选中的行",
    );
    assert.equal(
      selected.find((item) => item.action === "align-selection-left")?.label,
      "左对齐",
    );
    assert.equal(
      tableMenuItems(target(), false)
        .flat()
        .find((item) => item.action === "delete-row")?.label,
      "Delete row",
    );
  });
});
