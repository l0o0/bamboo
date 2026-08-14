# Live Table Edge Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hover-revealed right and bottom buttons that append a final table column or body row in Live mode.

**Architecture:** A small pure planner resolves an edge action against the current CodeMirror table state and reuses existing structural table operations. The Live Preview plugin renders real edge buttons as an absolutely positioned row widget, while `bootstrap.ts` validates and applies their custom events in one transaction.

**Tech Stack:** TypeScript, CodeMirror 6 widgets/decorations, DOM custom events, Node test runner.

## Global Constraints

- Right edge appends exactly one final column.
- Bottom edge appends exactly one final body row.
- Edge buttons exist only in writable Live mode.
- Edge buttons do not alter table Grid tracks or activate cell editing.
- Every append remains one CodeMirror transaction and one undo step.
- Source mode and the existing table context menu remain unchanged.

---

### Task 1: Pure edge-action planning

**Files:**

- Create: `src/editor/table-edge-actions.ts`
- Create: `test/editor-table-edge-actions.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `TableEdgeAction = "append-column" | "append-row"`.
- Produces: `planTableEdgeAction(state: EditorState, position: number, action: TableEdgeAction): TableOperationPlan | null`.
- Produces: `TABLE_EDGE_ACTION_EVENT` and `TableEdgeActionDetail` for the Live widget bridge.
- Consumes: `tableTargetAt` and `planTableOperation` from `src/editor/table-operations.ts`.

- [x] **Step 1: Add failing planner tests**

Create `test/editor-table-edge-actions.test.ts` with a GFM-enabled editor state and assertions that:

```ts
const appendColumn = planTableEdgeAction(
  editor,
  source.indexOf("B"),
  "append-column",
);
assert.ok(appendColumn);
assert.equal(
  editor.update({ changes: appendColumn.changes }).state.doc.toString(),
  "| A | B |  |\n| --- | --- | --- |\n| 1 | 2 |  |",
);

const appendRow = planTableEdgeAction(
  editor,
  source.indexOf("1"),
  "append-row",
);
assert.ok(appendRow);
assert.equal(
  editor.update({ changes: appendRow.changes }).state.doc.toString(),
  "| A | B |\n| --- | --- |\n| 1 | 2 |\n|  |  |",
);
```

Also assert a position outside any table returns `null`.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec tsx --test test/editor-table-edge-actions.test.ts
```

Expected: module/export-not-found failure.

- [x] **Step 3: Implement the minimal planner**

Create `src/editor/table-edge-actions.ts`:

```ts
import type { EditorState } from "@codemirror/state";
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
  return planTableOperation(
    state,
    {
      ...target,
      columnIndex:
        action === "append-column"
          ? Math.max(0, target.columnCount - 1)
          : target.columnIndex,
      rowIndex: action === "append-row" ? target.bodyRowCount : target.rowIndex,
    },
    action === "append-column" ? "insert-column-right" : "insert-row-below",
  );
}
```

- [x] **Step 4: Register and run planner tests**

Add `test/editor-table-edge-actions.test.ts` to `test:unit` in `package.json`, then run:

```bash
pnpm exec tsx --test test/editor-table-edge-actions.test.ts test/editor-table-operations.test.ts
```

Expected: all edge-action and existing operation tests pass.

---

### Task 2: Live edge widgets and event bridge

**Files:**

- Modify: `src/editor/live-preview/plugin.ts`
- Modify: `src/editor/bootstrap.ts`
- Modify: `src/editor/theme.ts`
- Modify: `test/editor-theme.test.ts`
- Modify: `DESIGN.md`

**Interfaces:**

- Consumes: `TABLE_EDGE_ACTION_EVENT`, `TableEdgeActionDetail`, and `planTableEdgeAction` from Task 1.
- Produces: one `TableEdgeActionsWidget` per visible table row, with a right button and an optional bottom button on the final row.

- [x] **Step 1: Extend the theme geometry test**

Update `test/editor-theme.test.ts` to require the stable bottom gutter:

```ts
assert.deepEqual(liveEditorGeometry(), {
  contentPadding: "20px 0 40px",
  linePadding: "0 30px 0 34px",
  tableMargin: "0 30px 0 34px",
  tablePadding: "0",
  tableEdgeSize: "30px",
});
```

- [x] **Step 2: Add the edge action widget**

In `src/editor/live-preview/plugin.ts`, create a `TableEdgeActionsWidget` that:

- receives `position`, `finalRow`, and `readOnly`;
- returns an empty non-editable wrapper when read-only;
- creates right and optional bottom `<button type="button">` elements;
- sets `title` and `aria-label` to `在右侧新增列` or `在下方新增行`;
- stops `pointerdown`, `mousedown`, and `click` propagation;
- dispatches `TABLE_EDGE_ACTION_EVENT` with `{ position, action }` on click;
- returns `true` from `ignoreEvent()`.

Add the widget at `line.to` after the row's cell decorations:

```ts
ranges.push(
  Decoration.widget({
    widget: new TableEdgeActionsWidget(
      tableRow.cells.at(-1)?.from ?? line.from,
      tableRow.isLast,
      state.readOnly,
    ),
    side: 1,
  }).range(line.to),
);
```

The bottom action uses a valid position from the final row; the pure planner normalizes it to the final body row.

- [x] **Step 3: Bridge the custom event to CodeMirror**

In `src/editor/bootstrap.ts`, extend the existing table listener lifecycle:

```ts
const onEdgeAction = (event: Event) => {
  if (!view || view.state.readOnly) return;
  const detail = (event as CustomEvent<TableEdgeActionDetail>).detail;
  const plan = planTableEdgeAction(view.state, detail.position, detail.action);
  if (!plan) return;
  const nextState = view.state.update({ changes: plan.changes }).state;
  const nextActive = remapActiveCell(nextState, plan.target);
  activeTableCell = nextActive;
  view.dispatch({
    changes: plan.changes,
    selection: plan.selection,
    effects: setLiveTableCellEdit.of(nextActive),
    scrollIntoView: true,
  });
};
```

Register and remove `TABLE_EDGE_ACTION_EVENT` together with the existing table-cell custom event listeners.

- [x] **Step 4: Add stable edge-action styles**

In `src/editor/theme.ts`:

- add `tableEdgeSize: "30px"` to `liveEditorGeometry()`;
- give `.cm-line.zmd-lp-table-last-row` a stable `marginBottom` of `30px`;
- position `.zmd-lp-table-edge-actions` absolutely over the row with `pointer-events: none`;
- position the right button at `left: 100%`, with `width: 30px` and `height: 100%`;
- position the bottom button at `top: 100%`, spanning `left: 0; right: 0; height: 30px`;
- set buttons to `opacity: 0` by default and reveal them on row hover or `:focus-visible`;
- use existing table border, active background, and text tokens without changing table column geometry.

- [x] **Step 5: Document the interaction**

Add to `DESIGN.md` under Table Editing:

```md
Writable Live tables expose transient edge actions: hover the right gutter to append a final column, or the bottom gutter to append a final row. The controls are real focusable buttons, remain outside table Grid tracks, and never activate cell editing.
```

- [x] **Step 6: Run complete verification**

Run:

```bash
pnpm exec prettier --check src/editor/table-edge-actions.ts src/editor/live-preview/plugin.ts src/editor/bootstrap.ts src/editor/theme.ts test/editor-table-edge-actions.test.ts test/editor-theme.test.ts DESIGN.md
pnpm exec eslint src/editor/table-edge-actions.ts src/editor/live-preview/plugin.ts src/editor/bootstrap.ts src/editor/theme.ts test/editor-table-edge-actions.test.ts test/editor-theme.test.ts
pnpm test:unit
pnpm build
git diff --check
```

Expected: formatting and lint pass, all unit tests pass, and the production plugin build completes.

- [x] **Step 7: Commit**

```bash
git add package.json src/editor/table-edge-actions.ts src/editor/live-preview/plugin.ts src/editor/bootstrap.ts src/editor/theme.ts test/editor-table-edge-actions.test.ts test/editor-theme.test.ts DESIGN.md docs/superpowers/plans/2026-08-15-live-table-edge-actions.md
git commit -m "feat(markdown): add live table edge actions"
```
