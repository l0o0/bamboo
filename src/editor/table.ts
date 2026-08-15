import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

export type TableAlignment = "left" | "center" | "right" | null;

export interface TableCellRange {
  from: number;
  to: number;
  outerFrom: number;
  outerTo: number;
  rowIndex?: number;
  columnIndex?: number;
}

export interface TableRowLayout {
  kind: "header" | "delimiter" | "body";
  from: number;
  to: number;
  cells: TableCellRange[];
}

export interface TableLayout {
  from: number;
  to: number;
  columnCount: number;
  alignments: TableAlignment[];
  rows: TableRowLayout[];
}

export interface TableTabPlan {
  anchor: number;
  head: number;
  changes?: { from: number; to: number; insert: string };
}

export interface LiveTableRow extends TableRowLayout {
  tableFrom: number;
  line: number;
  columnCount: number;
  alignments: TableAlignment[];
  isLast: boolean;
  visibleRowCount: number;
}

function ancestor(node: SyntaxNode | null, name: string) {
  for (let current = node; current; current = current.parent) {
    if (current.name === name) return current;
  }
  return null;
}

function trimCell(state: EditorState, from: number, to: number) {
  const value = state.doc.sliceString(from, to);
  const leading = value.match(/^\s*/)?.[0].length || 0;
  const trailing = value.match(/\s*$/)?.[0].length || 0;
  const start = from + leading;
  return {
    from: start,
    to: Math.max(start, to - trailing),
    outerFrom: from,
    outerTo: to,
  };
}

function rowCells(state: EditorState, node: SyntaxNode) {
  const pipes: Array<{ from: number; to: number }> = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (
      child.name === "TableDelimiter" &&
      state.doc.sliceString(child.from, child.to) === "|"
    ) {
      pipes.push({ from: child.from, to: child.to });
    }
  }

  const cells: TableCellRange[] = [];
  let cursor = node.from;
  for (const pipe of pipes) {
    if (pipe.from > cursor) cells.push(trimCell(state, cursor, pipe.from));
    cursor = pipe.to;
  }
  if (cursor < node.to) cells.push(trimCell(state, cursor, node.to));
  return cells;
}

function delimiterCells(state: EditorState, node: SyntaxNode) {
  const value = state.doc.sliceString(node.from, node.to);
  const cells: TableCellRange[] = [];
  let start = value.startsWith("|") ? 1 : 0;
  for (let index = start; index <= value.length; index++) {
    if (index !== value.length && value[index] !== "|") continue;
    if (index === value.length && value.endsWith("|")) break;
    cells.push(trimCell(state, node.from + start, node.from + index));
    start = index + 1;
  }
  return cells;
}

function alignmentFor(value: string): TableAlignment {
  const trimmed = value.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

export function tableLayoutAt(
  state: EditorState,
  position: number,
): TableLayout | null {
  const resolved = syntaxTree(state).resolveInner(
    Math.max(0, Math.min(position, state.doc.length)),
    -1,
  );
  const table = ancestor(resolved, "Table");
  if (!table) return null;

  const rows: TableRowLayout[] = [];
  let alignments: TableAlignment[] = [];
  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableHeader") {
      rows.push({
        kind: "header",
        from: child.from,
        to: child.to,
        cells: rowCells(state, child),
      });
    } else if (child.name === "TableRow") {
      rows.push({
        kind: "body",
        from: child.from,
        to: child.to,
        cells: rowCells(state, child),
      });
    } else if (child.name === "TableDelimiter") {
      const cells = delimiterCells(state, child);
      rows.push({
        kind: "delimiter",
        from: child.from,
        to: child.to,
        cells,
      });
      alignments = cells.map((cell) =>
        alignmentFor(state.doc.sliceString(cell.from, cell.to)),
      );
    }
  }

  const columnCount = Math.max(
    0,
    ...rows
      .filter((row) => row.kind !== "delimiter")
      .map((row) => row.cells.length),
  );
  while (alignments.length < columnCount) alignments.push(null);
  return {
    from: table.from,
    to: table.to,
    columnCount,
    alignments: alignments.slice(0, columnCount),
    rows,
  };
}

export interface TableCellIdentity {
  tableFrom: number;
  rowIndex: number;
  columnIndex: number;
}

/** Widgets must only reuse DOM when they represent the same logical cell. */
export function sameTableCellIdentity(
  a: TableCellIdentity,
  b: TableCellIdentity,
): boolean {
  return (
    a.tableFrom === b.tableFrom &&
    a.rowIndex === b.rowIndex &&
    a.columnIndex === b.columnIndex
  );
}

/** Document range the Live cell widget should own, including padding. */
export function cellWidgetRange(cell: TableCellRange): {
  from: number;
  to: number;
  point: boolean;
} {
  if (cell.outerFrom < cell.outerTo) {
    return { from: cell.outerFrom, to: cell.outerTo, point: false };
  }
  if (cell.from < cell.to)
    return { from: cell.from, to: cell.to, point: false };
  return { from: cell.from, to: cell.to, point: true };
}

export function liveTableRows(state: EditorState): LiveTableRow[] {
  const positions: number[] = [];
  const cursor = syntaxTree(state).cursor();
  do {
    if (cursor.name === "Table") positions.push(cursor.from);
  } while (cursor.next());

  return positions.flatMap((position) => {
    const table = tableLayoutAt(
      state,
      Math.min(state.doc.length, position + 1),
    );
    if (!table) return [];
    const visibleRows = table.rows.filter((row) => row.kind !== "delimiter");
    return visibleRows.map((row, index) => ({
      ...row,
      tableFrom: table.from,
      cells: row.cells.map((cell, columnIndex) => ({
        ...cell,
        rowIndex: index,
        columnIndex,
      })),
      line: state.doc.lineAt(row.from).number,
      columnCount: table.columnCount,
      alignments: table.alignments,
      isLast: index === visibleRows.length - 1,
      visibleRowCount: visibleRows.length,
    }));
  });
}

export function planTableTab(
  state: EditorState,
  backwards: boolean,
): TableTabPlan | null {
  const head = state.selection.main.head;
  const table = tableLayoutAt(state, head);
  if (!table) return null;
  const cells = table.rows
    .filter((row) => row.kind !== "delimiter")
    .flatMap((row) => row.cells);
  if (!cells.length) return null;

  let index = cells.findIndex((cell) => head >= cell.from && head <= cell.to);
  if (index < 0) {
    index = cells.findIndex((cell) => head < cell.from);
    if (index < 0) index = cells.length - 1;
  }

  const next = index + (backwards ? -1 : 1);
  if (next >= 0 && next < cells.length) {
    return { anchor: cells[next].from, head: cells[next].to };
  }
  if (backwards) return null;

  const line = state.doc.lineAt(table.to);
  const insertAt = line.to < state.doc.length ? line.to + 1 : line.to;
  const prefix = insertAt === line.to ? "\n" : "";
  const row = `|${Array.from({ length: table.columnCount }, () => "  ").join("|")}|\n`;
  return {
    changes: { from: insertAt, to: insertAt, insert: prefix + row },
    anchor: insertAt + prefix.length + 2,
    head: insertAt + prefix.length + 2,
  };
}

function moveTableCell(backwards: boolean): KeyBinding["run"] {
  return (view) => {
    const plan = planTableTab(view.state, backwards);
    if (!plan) return false;
    view.dispatch({
      changes: plan.changes,
      selection: { anchor: plan.anchor, head: plan.head },
      scrollIntoView: true,
    });
    return true;
  };
}

export const tableKeymap: readonly KeyBinding[] = [
  { key: "Tab", run: moveTableCell(false) },
  { key: "Shift-Tab", run: moveTableCell(true) },
];
