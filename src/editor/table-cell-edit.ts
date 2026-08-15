import type { EditorState } from "@codemirror/state";
import { planTableTab, tableLayoutAt } from "./table";
import { tableTargetAt, type TableTarget } from "./table-operations";

export const TABLE_CELL_INPUT_EVENT = "zmd-table-cell-input";
export const TABLE_CELL_COMMIT_EVENT = "zmd-table-cell-commit";
export const TABLE_CELL_NAVIGATE_EVENT = "zmd-table-cell-navigate";

export interface TableCellInputDetail {
  value: string;
  caretOffset: number;
}

export interface TableCellNavigateDetail {
  backwards: boolean;
}

export interface TableCellEditTarget extends TableTarget {
  from: number;
  to: number;
  value: string;
  caretOffset: number;
}

export interface CellEditPlan {
  changes?: { from: number; to: number; insert: string };
  active: TableCellEditTarget;
}

function cellAtTarget(state: EditorState, target: TableTarget) {
  const layout = tableLayoutAt(state, target.tableFrom + 1);
  if (!layout || layout.from !== target.tableFrom) return null;
  const rows = layout.rows.filter((row) => row.kind !== "delimiter");
  const row = rows[target.rowIndex];
  const cell = row?.cells[target.columnIndex];
  if (!cell) return null;
  return { layout, cell };
}

export function activateTableCell(
  state: EditorState,
  position: number,
  caretOffset = 0,
): TableCellEditTarget | null {
  const target = tableTargetAt(state, position);
  if (!target) return null;
  const located = cellAtTarget(state, target);
  if (!located) return null;
  const value = state.doc.sliceString(located.cell.from, located.cell.to);
  return {
    ...target,
    from: located.cell.from,
    to: located.cell.to,
    value,
    caretOffset: Math.max(0, Math.min(value.length, caretOffset)),
  };
}

export function activateTableCellByIndex(
  state: EditorState,
  tableFrom: number,
  rowIndex: number,
  columnIndex: number,
  caretOffset = 0,
): TableCellEditTarget | null {
  const layout = tableLayoutAt(state, tableFrom + 1);
  if (!layout || layout.from !== tableFrom) return null;
  const target: TableTarget = {
    tableFrom,
    rowIndex,
    columnIndex,
    bodyRowCount: layout.rows.filter((row) => row.kind === "body").length,
    columnCount: layout.columnCount,
    alignment: layout.alignments[columnIndex] || null,
  };
  const active = activateTargetByIndex(state, target);
  if (!active) return null;
  active.caretOffset = Math.max(0, Math.min(active.value.length, caretOffset));
  return active;
}

export function remapActiveCell(
  state: EditorState,
  active: TableTarget,
  tableFrom = active.tableFrom,
): TableCellEditTarget | null {
  const remapped = activateTargetByIndex(state, { ...active, tableFrom });
  if (remapped && "caretOffset" in active) {
    remapped.caretOffset = Math.min(
      remapped.value.length,
      Number(active.caretOffset) || 0,
    );
  }
  return remapped;
}

function activateTargetByIndex(
  state: EditorState,
  target: TableTarget,
): TableCellEditTarget | null {
  const located = cellAtTarget(state, target);
  if (!located) return null;
  const value = state.doc.sliceString(located.cell.from, located.cell.to);
  return {
    ...target,
    bodyRowCount: located.layout.rows.filter((row) => row.kind === "body")
      .length,
    columnCount: located.layout.columnCount,
    alignment: located.layout.alignments[target.columnIndex] || null,
    from: located.cell.from,
    to: located.cell.to,
    value,
    caretOffset: Math.min(value.length, target.columnIndex),
  };
}

export function planCellInput(
  state: EditorState,
  active: TableCellEditTarget,
  value: string,
  caretOffset = value.length,
): CellEditPlan | null {
  const current = remapActiveCell(state, active);
  if (!current) return null;
  const changes = { from: current.from, to: current.to, insert: value };
  const nextState = state.update({ changes }).state;
  const next = activateTargetByIndex(nextState, current);
  if (!next) return null;
  next.caretOffset = Math.max(0, Math.min(value.length, caretOffset));
  return { changes, active: next };
}

export function planCellNavigation(
  state: EditorState,
  active: TableCellEditTarget,
  backwards: boolean,
): CellEditPlan | null {
  const current = remapActiveCell(state, active);
  if (!current) return null;
  const navigationState = state.update({
    selection: { anchor: current.from, head: current.to },
  }).state;
  const plan = planTableTab(navigationState, backwards);
  if (!plan) return null;
  if (!plan.changes) {
    const target = tableTargetAt(navigationState, plan.anchor);
    const next = target ? activateTargetByIndex(navigationState, target) : null;
    return next ? { active: next } : null;
  }
  const nextState = state.update({ changes: plan.changes }).state;
  const target = tableTargetAt(nextState, plan.anchor);
  if (!target) return null;
  return {
    changes: plan.changes,
    active: activateTargetByIndex(nextState, target)!,
  };
}
