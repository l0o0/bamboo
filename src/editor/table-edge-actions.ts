import type { EditorState } from "@codemirror/state";
import { tableLayoutAt } from "./table";
import {
  planTableOperation,
  tableTargetAt,
  type TableOperationPlan,
} from "./table-operations";

export const TABLE_EDGE_ACTION_EVENT = "zmd-table-edge-action";

export type TableEdgeAction = "append-column" | "append-row";

export interface TableEdgeActionDetail {
  position: number;
  action: TableEdgeAction;
}

export function planTableEdgeAction(
  state: EditorState,
  position: number,
  action: TableEdgeAction,
): TableOperationPlan | null {
  const target = tableTargetAt(state, position);
  if (!target) return null;
  const layout = tableLayoutAt(state, target.tableFrom + 1);
  if (!layout || layout.from !== target.tableFrom) return null;
  const widestColumnCount = Math.max(
    1,
    ...layout.rows
      .filter((row) => row.kind !== "delimiter")
      .map((row) => row.cells.length),
  );
  return planTableOperation(
    state,
    {
      ...target,
      columnIndex:
        action === "append-column" ? widestColumnCount - 1 : target.columnIndex,
      rowIndex: action === "append-row" ? target.bodyRowCount : target.rowIndex,
    },
    action === "append-column" ? "insert-column-right" : "insert-row-below",
  );
}
