import type { ChangeDesc, EditorState } from "@codemirror/state";
import { tableLayoutAt, type TableLayout } from "./table";

export type TableSelection =
  | { kind: "row"; tableFrom: number; rowIndex: number }
  | { kind: "column"; tableFrom: number; columnIndex: number }
  | null;

export function sameTableSelection(
  a: TableSelection,
  b: TableSelection,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind || a.tableFrom !== b.tableFrom) {
    return false;
  }
  return a.kind === "row"
    ? a.rowIndex === (b as typeof a).rowIndex
    : a.columnIndex === (b as typeof a).columnIndex;
}

export function selectionContainsCell(
  selection: TableSelection,
  rowIndex: number,
  columnIndex: number,
): boolean {
  if (!selection) return false;
  return selection.kind === "row"
    ? selection.rowIndex === rowIndex
    : selection.columnIndex === columnIndex;
}

function selectionExists(selection: TableSelection, layout: TableLayout) {
  if (!selection || layout.from !== selection.tableFrom) return false;
  if (selection.kind === "row") {
    const bodyRows = layout.rows.filter((row) => row.kind === "body");
    return selection.rowIndex >= 1 && selection.rowIndex <= bodyRows.length;
  }
  return (
    selection.columnIndex >= 0 && selection.columnIndex < layout.columnCount
  );
}

export function remapTableSelection(
  state: EditorState,
  selection: TableSelection,
  changes: ChangeDesc,
): TableSelection {
  if (!selection) return null;
  const tableFrom = changes.mapPos(selection.tableFrom, 1);
  const layout = tableLayoutAt(
    state,
    Math.min(state.doc.length, tableFrom + 1),
  );
  const remapped = { ...selection, tableFrom };
  if (
    !layout ||
    layout.from !== tableFrom ||
    !selectionExists(remapped, layout)
  ) {
    return null;
  }
  return remapped;
}

export function selectionAfterDelete(
  selection: Exclude<TableSelection, null>,
  nextLayout: TableLayout,
  deletedIndex: number,
): TableSelection {
  if (selection.kind === "row") {
    const bodyRowCount = nextLayout.rows.filter(
      (row) => row.kind === "body",
    ).length;
    if (!bodyRowCount) return null;
    return {
      kind: "row",
      tableFrom: nextLayout.from,
      rowIndex: Math.min(Math.max(1, deletedIndex), bodyRowCount),
    };
  }
  if (!nextLayout.columnCount) return null;
  return {
    kind: "column",
    tableFrom: nextLayout.from,
    columnIndex: Math.min(
      Math.max(0, deletedIndex),
      nextLayout.columnCount - 1,
    ),
  };
}

export function isTableHandleClick(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  threshold = 4,
): boolean {
  return Math.hypot(endX - startX, endY - startY) <= threshold;
}
