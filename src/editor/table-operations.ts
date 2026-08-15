import type { EditorState } from "@codemirror/state";
import { tableLayoutAt, type TableAlignment, type TableLayout } from "./table";

export type TableAction =
  | "insert-row-above"
  | "insert-row-below"
  | "move-row-up"
  | "move-row-down"
  | "delete-row"
  | "insert-column-left"
  | "insert-column-right"
  | "move-column-left"
  | "move-column-right"
  | "delete-column"
  | "align-default"
  | "align-left"
  | "align-center"
  | "align-right";

export interface TableTarget {
  tableFrom: number;
  rowIndex: number;
  columnIndex: number;
  bodyRowCount: number;
  columnCount: number;
  alignment: TableAlignment;
}

export interface TableOperationPlan {
  changes: { from: number; to: number; insert: string };
  selection: { anchor: number; head: number };
  target: TableTarget;
}

interface EditableTable {
  header: string[];
  alignments: TableAlignment[];
  body: string[][];
}

function content(state: EditorState, from: number, to: number) {
  return state.doc.sliceString(from, to);
}

function editableTable(state: EditorState, layout: TableLayout): EditableTable {
  const headerRow = layout.rows.find((row) => row.kind === "header");
  const bodyRows = layout.rows.filter((row) => row.kind === "body");
  const columnCount = Math.max(
    layout.columnCount,
    ...bodyRows.map((row) => row.cells.length),
  );
  const values = (cells: Array<{ from: number; to: number }>) =>
    Array.from({ length: columnCount }, (_, index) => {
      const cell = cells[index];
      return cell ? content(state, cell.from, cell.to) : "";
    });
  return {
    header: values(headerRow?.cells || []),
    alignments: Array.from(
      { length: columnCount },
      (_, index) => layout.alignments[index] || null,
    ),
    body: bodyRows.map((row) => values(row.cells)),
  };
}

function cellAt(layout: TableLayout, position: number) {
  const visibleRows = layout.rows.filter((row) => row.kind !== "delimiter");
  for (let rowIndex = 0; rowIndex < visibleRows.length; rowIndex++) {
    const row = visibleRows[rowIndex];
    for (let columnIndex = 0; columnIndex < row.cells.length; columnIndex++) {
      const cell = row.cells[columnIndex];
      if (position >= cell.outerFrom && position <= cell.outerTo) {
        return { rowIndex, columnIndex };
      }
    }
  }
  return null;
}

export function tableTargetAt(
  state: EditorState,
  position: number,
): TableTarget | null {
  const layout = tableLayoutAt(state, position);
  if (!layout) return null;
  const cell = cellAt(layout, position);
  if (!cell) return null;
  return {
    tableFrom: layout.from,
    rowIndex: cell.rowIndex,
    columnIndex: cell.columnIndex,
    bodyRowCount: layout.rows.filter((row) => row.kind === "body").length,
    columnCount: layout.columnCount,
    alignment: layout.alignments[cell.columnIndex] || null,
  };
}

function delimiter(alignment: TableAlignment) {
  if (alignment === "left") return ":---";
  if (alignment === "center") return ":---:";
  if (alignment === "right") return "---:";
  return "---";
}

function serializedRow(cells: string[]) {
  return `| ${cells.join(" | ")} |`;
}

function serialize(table: EditableTable) {
  return [
    serializedRow(table.header),
    serializedRow(table.alignments.map(delimiter)),
    ...table.body.map(serializedRow),
  ].join("\n");
}

function cellSelection(
  tableFrom: number,
  table: EditableTable,
  rowIndex: number,
  columnIndex: number,
) {
  const rows = [table.header, table.alignments.map(delimiter), ...table.body];
  let offset = tableFrom;
  const serializedIndex = rowIndex === 0 ? 0 : rowIndex + 1;
  for (let index = 0; index < serializedIndex; index++) {
    offset += serializedRow(rows[index]).length + 1;
  }
  offset += 2;
  for (let index = 0; index < columnIndex; index++) {
    offset += rows[serializedIndex][index].length + 3;
  }
  const value = rows[serializedIndex][columnIndex] || "";
  return { anchor: offset, head: offset + value.length };
}

function applyRowAction(
  table: EditableTable,
  target: TableTarget,
  action: TableAction,
) {
  const rowActions: TableAction[] = [
    "insert-row-above",
    "insert-row-below",
    "move-row-up",
    "move-row-down",
    "delete-row",
  ];
  if (!rowActions.includes(action)) return undefined;
  const column = Math.min(target.columnIndex, table.header.length - 1);
  const empty = Array.from({ length: table.header.length }, () => "");
  if (action === "insert-row-above" || action === "insert-row-below") {
    const bodyIndex =
      target.rowIndex === 0
        ? 0
        : target.rowIndex - 1 + (action === "insert-row-below" ? 1 : 0);
    table.body.splice(bodyIndex, 0, empty);
    return { rowIndex: bodyIndex + 1, columnIndex: column };
  }
  if (target.rowIndex === 0) return null;
  const bodyIndex = target.rowIndex - 1;
  if (action === "delete-row") {
    table.body.splice(bodyIndex, 1);
    if (!table.body.length) return { rowIndex: 0, columnIndex: column };
    return {
      rowIndex: Math.min(bodyIndex, table.body.length - 1) + 1,
      columnIndex: column,
    };
  }
  const delta = action === "move-row-up" ? -1 : 1;
  const next = bodyIndex + delta;
  if (next < 0 || next >= table.body.length) return null;
  [table.body[bodyIndex], table.body[next]] = [
    table.body[next],
    table.body[bodyIndex],
  ];
  return { rowIndex: next + 1, columnIndex: column };
}

function applyColumnAction(
  table: EditableTable,
  target: TableTarget,
  action: TableAction,
) {
  const rows = [table.header, ...table.body];
  const current = target.columnIndex;
  if (action === "insert-column-left" || action === "insert-column-right") {
    const columnIndex = current + (action === "insert-column-right" ? 1 : 0);
    for (const row of rows) row.splice(columnIndex, 0, "");
    table.alignments.splice(columnIndex, 0, null);
    return { rowIndex: target.rowIndex, columnIndex };
  }
  if (action === "delete-column") {
    if (table.header.length <= 1) return null;
    for (const row of rows) row.splice(current, 1);
    table.alignments.splice(current, 1);
    return {
      rowIndex: target.rowIndex,
      columnIndex: Math.min(current, table.header.length - 1),
    };
  }
  if (action !== "move-column-left" && action !== "move-column-right") {
    return undefined;
  }
  const next = current + (action === "move-column-left" ? -1 : 1);
  if (next < 0 || next >= table.header.length) return null;
  for (const row of rows) [row[current], row[next]] = [row[next], row[current]];
  [table.alignments[current], table.alignments[next]] = [
    table.alignments[next],
    table.alignments[current],
  ];
  return { rowIndex: target.rowIndex, columnIndex: next };
}

function applyAlignmentAction(
  table: EditableTable,
  target: TableTarget,
  action: TableAction,
) {
  const alignmentByAction: Partial<Record<TableAction, TableAlignment>> = {
    "align-default": null,
    "align-left": "left",
    "align-center": "center",
    "align-right": "right",
  };
  if (!Object.prototype.hasOwnProperty.call(alignmentByAction, action)) {
    return undefined;
  }
  const alignment = alignmentByAction[action] ?? null;
  if (table.alignments[target.columnIndex] === alignment) return null;
  table.alignments[target.columnIndex] = alignment;
  return {
    rowIndex: target.rowIndex,
    columnIndex: target.columnIndex,
  };
}

export function planTableOperation(
  state: EditorState,
  target: TableTarget,
  action: TableAction,
): TableOperationPlan | null {
  const layout = tableLayoutAt(state, target.tableFrom + 1);
  if (!layout || layout.from !== target.tableFrom) return null;
  const table = editableTable(state, layout);
  const next =
    applyRowAction(table, target, action) ??
    applyColumnAction(table, target, action) ??
    applyAlignmentAction(table, target, action);
  if (!next) return null;
  const insert = serialize(table);
  const selection = cellSelection(
    layout.from,
    table,
    next.rowIndex,
    next.columnIndex,
  );
  return {
    changes: { from: layout.from, to: layout.to, insert },
    selection,
    target: {
      tableFrom: layout.from,
      rowIndex: next.rowIndex,
      columnIndex: next.columnIndex,
      bodyRowCount: table.body.length,
      columnCount: table.header.length,
      alignment: table.alignments[next.columnIndex] || null,
    },
  };
}

function layoutForTable(state: EditorState, tableFrom: number) {
  const position = Math.max(0, Math.min(state.doc.length, tableFrom + 1));
  const layout = tableLayoutAt(state, position);
  return layout && layout.from === tableFrom ? layout : null;
}

/** Move a visible body row directly to another body row index in one edit. */
export function planTableMoveRowTo(
  state: EditorState,
  tableFrom: number,
  fromRowIndex: number,
  toRowIndex: number,
): TableOperationPlan | null {
  const layout = layoutForTable(state, tableFrom);
  if (!layout) return null;
  const table = editableTable(state, layout);
  if (
    fromRowIndex < 1 ||
    toRowIndex < 1 ||
    fromRowIndex > table.body.length ||
    toRowIndex > table.body.length ||
    fromRowIndex === toRowIndex
  ) {
    return null;
  }
  const [moved] = table.body.splice(fromRowIndex - 1, 1);
  table.body.splice(toRowIndex - 1, 0, moved);
  const insert = serialize(table);
  const selection = cellSelection(layout.from, table, toRowIndex, 0);
  return {
    changes: { from: layout.from, to: layout.to, insert },
    selection,
    target: {
      tableFrom: layout.from,
      rowIndex: toRowIndex,
      columnIndex: 0,
      bodyRowCount: table.body.length,
      columnCount: table.header.length,
      alignment: table.alignments[0] || null,
    },
  };
}

/** Move a column directly to another column index in one edit. */
export function planTableMoveColumnTo(
  state: EditorState,
  tableFrom: number,
  fromColumnIndex: number,
  toColumnIndex: number,
): TableOperationPlan | null {
  const layout = layoutForTable(state, tableFrom);
  if (!layout) return null;
  const table = editableTable(state, layout);
  const count = table.header.length;
  if (
    fromColumnIndex < 0 ||
    toColumnIndex < 0 ||
    fromColumnIndex >= count ||
    toColumnIndex >= count ||
    fromColumnIndex === toColumnIndex
  ) {
    return null;
  }
  for (const row of [table.header, ...table.body]) {
    const [moved] = row.splice(fromColumnIndex, 1);
    row.splice(toColumnIndex, 0, moved);
  }
  const [alignment] = table.alignments.splice(fromColumnIndex, 1);
  table.alignments.splice(toColumnIndex, 0, alignment);
  const insert = serialize(table);
  const selection = cellSelection(layout.from, table, 0, toColumnIndex);
  return {
    changes: { from: layout.from, to: layout.to, insert },
    selection,
    target: {
      tableFrom: layout.from,
      rowIndex: 0,
      columnIndex: toColumnIndex,
      bodyRowCount: table.body.length,
      columnCount: table.header.length,
      alignment: table.alignments[toColumnIndex] || null,
    },
  };
}
