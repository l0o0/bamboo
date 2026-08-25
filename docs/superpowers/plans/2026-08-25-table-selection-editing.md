# Markdown Live Table Selection Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Live 模式中加入 Obsidian 风格的整行/整列选择、持续高亮、Delete 删除和核心右键菜单，同时保留现有单元格编辑与拖拽排序。

**Architecture:** 以 `TableSelection` 逻辑状态作为唯一选择源，通过 CodeMirror `StateEffect` 传入 Live Preview widget，避免依赖一次性 DOM class。表格批量操作继续复用现有的 `editableTable`/`serialize`/operation plan，iframe runtime 只负责事件判定、状态编排和菜单调用。

**Tech Stack:** TypeScript、CodeMirror 6 (`@codemirror/state`, `@codemirror/view`)、Lezer Markdown GFM、Node test runner、项目现有主题扩展。

## Global Constraints

- 第一阶段只支持单个整行或整列选择，不实现矩形 cell range 或多选。
- 选择状态只存在于当前 iframe 编辑器，不写入 Markdown、不经过 parent message、不触发保存。
- 选择状态必须使用 `tableFrom + rowIndex/columnIndex` 逻辑身份，不保存 cell 文本 offset。
- 每次表格 operation 只生成一个 CodeMirror change，以保留 undo/redo 原子性。
- 表头行不可通过 row handle 删除，最后一列不可删除；既有边界保护必须继续生效。
- 选中态使用 inset shadow/背景，不得改变 grid 尺寸、列宽或行高。
- light/dark 主题复用现有 accent、selection、table token，不新增外部依赖。
- 现有单元格编辑、Tab 导航、row/column 拖拽排序、Live/Source 切换必须继续可用。

---

## 文件与边界

| 文件 | 责任 |
| --- | --- |
| `src/editor/table-selection.ts` | 选择类型、相等判断、cell 命中、ChangeDesc remap、删除后邻近选择、点击阈值判定 |
| `test/editor-table-selection.test.ts` | 选择模型和边界的纯逻辑测试 |
| `src/editor/table-operations.ts` | 整行/整列清空、删除、批量对齐 operation plan |
| `test/editor-table-operations.test.ts` | 批量 operation 的 Markdown 结果和边界测试 |
| `src/editor/table-menu.ts` | 选择作用域菜单模型、核心 action、现有菜单 DOM 的扩展 |
| `test/editor-table-menu.test.ts` | 选择作用域下的菜单 action/disabled/checked 测试 |
| `src/editor/live-preview/plugin.ts` | 通过 decoration widget 渲染 selected cell 和 selected handle |
| `src/editor/live-preview/index.ts` | 导出 selection effect，保持 bootstrap 的现有导入边界 |
| `src/editor/bootstrap.ts` | runtime selection、点击/拖拽区分、Delete key、context menu action、selection remap |
| `src/editor/theme.ts` | light/dark selection tokens、cell/handle 高亮和 focus 样式 |

---

### Task 1: 建立纯逻辑 TableSelection 模型

**Files:**
- Create: `src/editor/table-selection.ts`
- Create: `test/editor-table-selection.test.ts`
- Read: `src/editor/table.ts` (`TableLayout`, `tableLayoutAt`, visible row/cell 索引)

**Interfaces:**

```ts
import type { ChangeDesc, EditorState } from "@codemirror/state";
import type { TableLayout } from "./table";

export type TableSelection =
  | { kind: "row"; tableFrom: number; rowIndex: number }
  | { kind: "column"; tableFrom: number; columnIndex: number }
  | null;

export function sameTableSelection(
  a: TableSelection,
  b: TableSelection,
): boolean;

export function selectionContainsCell(
  selection: TableSelection,
  rowIndex: number,
  columnIndex: number,
): boolean;

export function remapTableSelection(
  state: EditorState,
  selection: TableSelection,
  changes: ChangeDesc,
): TableSelection;

export function selectionAfterDelete(
  selection: Exclude<TableSelection, null>,
  nextLayout: TableLayout,
  deletedIndex: number,
): TableSelection;

export function isTableHandleClick(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  threshold?: number,
): boolean;
```

- [ ] **Step 1: Write failing tests for selection identity and cell membership.**

Add tests using a table with two body rows and three columns. Assert that:

```ts
assert.equal(
  selectionContainsCell({ kind: "row", tableFrom: 0, rowIndex: 1 }, 1, 2),
  true,
);
assert.equal(
  selectionContainsCell({ kind: "row", tableFrom: 0, rowIndex: 1 }, 2, 2),
  false,
);
assert.equal(
  selectionContainsCell({ kind: "column", tableFrom: 0, columnIndex: 1 }, 0, 1),
  true,
);
assert.equal(
  sameTableSelection(
    { kind: "column", tableFrom: 0, columnIndex: 1 },
    { kind: "column", tableFrom: 0, columnIndex: 1 },
  ),
  true,
);
```

- [ ] **Step 2: Run the focused test and verify it fails.**

Run: `pnpm exec tsx --test test/editor-table-selection.test.ts`

Expected: FAIL because `src/editor/table-selection.ts` does not exist.

- [ ] **Step 3: Implement the selection type and pure helpers.**

Use strict discriminated-union checks. `selectionContainsCell(null, ...)` returns `false`; row selection compares `rowIndex`; column selection compares `columnIndex`; equality compares kind plus table and index fields. `isTableHandleClick` returns `Math.hypot(endX - startX, endY - startY) <= threshold` with a default threshold of `4`.

For `remapTableSelection`, map `selection.tableFrom` with `changes.mapPos(selection.tableFrom, 1)`, call `tableLayoutAt` at the mapped position plus one, and validate the selected row/column against visible rows and `layout.columnCount`. Return `null` when the table no longer exists or the index is out of range.

For `selectionAfterDelete`, choose the next valid index at `Math.min(deletedIndex, count - 1)`; return `null` when the resulting visible row count or column count is zero.

- [ ] **Step 4: Add remap, deletion-neighbor, ragged-table, and pointer-threshold tests.**

Cover:

- content inserted before the table remaps `tableFrom` while preserving row/column index;
- deleting the table returns `null`;
- deleting the final body row returns `null` for row selection;
- deleting the final column is never represented as a valid next selection;
- ragged body rows still use the layout-wide column count;
- movement at `3px` is a click and movement at `5px` is a drag.

- [ ] **Step 5: Run the focused test and commit.**

Run: `pnpm exec tsx --test test/editor-table-selection.test.ts`

Expected: PASS with all selection tests. Commit:

```bash
git add src/editor/table-selection.ts test/editor-table-selection.test.ts
git commit -m "feat: add table selection model"
```

### Task 2: Add bulk row/column operations and menu scope

**Files:**
- Modify: `src/editor/table-operations.ts:4-260`
- Modify: `src/editor/table-menu.ts:1-180`
- Modify: `test/editor-table-operations.test.ts`
- Modify: `test/editor-table-menu.test.ts`
- Read: `src/editor/table-selection.ts` from Task 1

**Interfaces:**

```ts
import type { TableSelection } from "./table-selection";

export type TableSelectionAction =
  | "clear-selection"
  | "delete-selection"
  | "align-selection-default"
  | "align-selection-left"
  | "align-selection-center"
  | "align-selection-right";

export interface TableSelectionOperationPlan extends TableOperationPlan {
  nextTableSelection: TableSelection;
}

export function planTableSelectionOperation(
  state: EditorState,
  selection: Exclude<TableSelection, null>,
  action: TableSelectionAction,
): TableSelectionOperationPlan | null;

export type TableMenuAction = TableAction | TableSelectionAction | "copy" | "cut" | "paste";

export interface TableMenuItem {
  action: TableMenuAction;
  label: string;
  disabled: boolean;
  checked?: boolean;
}

export function tableMenuItems(
  target: TableTarget,
  readOnly: boolean,
  selection?: TableSelection,
): TableMenuGroups;
```

- [ ] **Step 1: Write failing operation tests for clear/delete selection.**

Use the existing `source` and `stateFor` helpers. Add tests that call `planTableSelectionOperation` with:

```ts
{ kind: "row", tableFrom: source.indexOf("| Name"), rowIndex: 1 }
{ kind: "column", tableFrom: source.indexOf("| Name"), columnIndex: 1 }
```

Assert that row deletion removes `| A | **1** |`, column deletion removes `Value` and `**1**`, clear leaves all pipes and alignment delimiters intact, and each plan returns exactly one replacement change from `layout.from` to `layout.to`.

- [ ] **Step 2: Run the focused operation tests and verify they fail.**

Run: `pnpm exec tsx --test test/editor-table-operations.test.ts`

Expected: FAIL because `planTableSelectionOperation` is not exported.

- [ ] **Step 3: Implement selection operation planning.**

Reuse `layoutForTable`, `editableTable`, `serialize`, and `cellSelection` from `table-operations.ts` instead of introducing a second Markdown serializer. For a row selection, operate on `table.body[rowIndex - 1]`; for a column selection, operate on `table.header`, every body row, and `table.alignments`. Return `null` for a header row, an empty body, or a one-column delete. For selection alignment, set all columns for a row selection and only the selected column for a column selection. Use `nextTableSelection` to select the adjacent row/column after delete, or preserve the original selection after clear/alignment.

- [ ] **Step 4: Extend menu descriptors and write menu tests.**

Keep existing row/column/alignment groups for cell targets. When `selection` is a row, include `clear-selection`, `delete-selection`, row movement and row insertion actions; when it is a column, include the column actions and selection alignment actions. Add `copy`, `cut`, and `paste` to the first group with disabled state based on `readOnly` and clipboard support supplied by the caller. Assert that one-column column selection disables `delete-selection`, empty-body row selection disables it, and read-only disables every mutating action.

- [ ] **Step 5: Run operation and menu tests and commit.**

Run: `pnpm exec tsx --test test/editor-table-operations.test.ts test/editor-table-menu.test.ts`

Expected: PASS with existing single-target tests and new selection tests. Commit:

```bash
git add src/editor/table-operations.ts src/editor/table-menu.ts test/editor-table-operations.test.ts test/editor-table-menu.test.ts
git commit -m "feat: add bulk table selection operations"
```

### Task 3: Render persistent selection in Live Preview widgets

**Files:**
- Modify: `src/editor/live-preview/plugin.ts:40-360,450-620,780-900,960-1040`
- Modify: `src/editor/live-preview/index.ts`
- Read: `src/editor/table-selection.ts` and `src/editor/theme.ts`

**Interfaces:**

```ts
export const setLiveTableSelection =
  StateEffect.define<TableSelection>();

function buildDecorations(
  state: EditorState,
  composing: boolean,
  imageAssets: ImageAssetMap,
  activeCell: TableCellEditTarget | null,
  tableSelection: TableSelection,
): DecorationSet;
```

- [ ] **Step 1: Add selection to widget identity and DOM class generation.**

Extend `TableCellWidget` with a `selected` boolean. Include it in `eq`, add `zmd-lp-table-cell-selected` in `applyDomIdentity`/`toDOM`, and remove/re-add the class in `updateDOM` without changing `gridColumn`. Extend `TableEdgeActionsWidget` with `selectedRow`/`selectedColumn` booleans, add `is-selected` and `aria-pressed="true"` to matching handles, and keep non-selected handles on the existing hover opacity path.

- [ ] **Step 2: Thread `TableSelection` through decoration construction.**

Import `selectionContainsCell`, pass the selection into `buildDecorations`, and mark each cell using its logical row/column. For the edge widget, pass `selection?.kind === "row" && selection.rowIndex === tableRow.rowIndex` and the equivalent column state. Add `setLiveTableSelection` handling to `LivePreviewPlugin.update`, mark the effect as `effectChanged`, and rebuild decorations only when the effect, document, or editor selection changes.

- [ ] **Step 3: Export the effect through the existing live-preview barrel.**

Export `setLiveTableSelection` from `src/editor/live-preview/index.ts` alongside `setLiveImageAssets` and `setLiveTableCellEdit`; do not create a second import path from bootstrap.

- [ ] **Step 4: Run the type/lint checks for the widget changes.**

Run: `pnpm lint:check`

Expected: PASS with no unused selection imports and no widget constructor type errors.

- [ ] **Step 5: Commit the rendering layer.**

```bash
git add src/editor/live-preview/plugin.ts src/editor/live-preview/index.ts
git commit -m "feat: render selected table rows and columns"
```

### Task 4: Wire handle clicks, Delete, and scoped context menus in bootstrap

**Files:**
- Modify: `src/editor/bootstrap.ts:110-620,730-900,1020-1070`
- Modify: `src/editor/table-menu.ts:80-180` if submenu/action rendering needs the existing menu DOM adapter
- Read: `src/editor/table-selection.ts`, `src/editor/table-operations.ts`, `src/editor/live-preview/index.ts`

**Interfaces:**

```ts
interface TableHandleSession extends TableDragSession {
  startX: number;
  startY: number;
  moved: boolean;
}

interface EditorRuntime {
  // existing fields...
  tableSelection: TableSelection;
  tableContextSelection: TableSelection;
  tableDragSession: TableHandleSession | null;
}

function setTableSelection(selection: TableSelection): void;
function applyTableSelectionDelete(event: KeyboardEvent): boolean;
function runTableClipboardCommand(command: "copy" | "cut" | "paste"): boolean;
```

- [ ] **Step 1: Add runtime state and a single selection setter.**

Initialize `runtime.tableSelection` to `null`. `setTableSelection` must compare with `sameTableSelection`, update runtime, dispatch `setLiveTableSelection.of(selection)`, clear `activeTableCell`, close the context menu when the selection changes, and focus `runtime.view` when a handle selected the table.

- [ ] **Step 2: Convert handle pointer handling to click-vs-drag.**

Update `startTableDrag` to create a session with `startX`, `startY`, and `moved: false`; do not call `applyTableDragHighlight` until pointer movement exceeds `isTableHandleClick` threshold. On a sub-threshold pointerup call `setTableSelection(kind === "row" ? { kind: "row", tableFrom, rowIndex: fromIndex } : { kind: "column", tableFrom, columnIndex: fromIndex })`. On a drag pointerup preserve current `planTableMoveRowTo`/`planTableMoveColumnTo`, then remap or keep the selected source kind according to the moved target. Always remove pointer listeners and clear temporary drag classes on end/cancel.

- [ ] **Step 3: Clear selection on editor pointerdown outside handles.**

Extend the existing `onPointerDown` in `bindTableCellEditing`: ignore events inside row/column handles, cells, edge action buttons, or the context menu; otherwise call `setTableSelection(null)`. A cell click must clear the row/column selection before activating the cell.

- [ ] **Step 4: Add the high-priority Delete key handler.**

Add a `Prec.highest` key binding before the active cell handler. When the editor is editable and `runtime.tableSelection` is non-null, call `planTableSelectionOperation(view.state, selection, "delete-selection")`; if the plan is null, return `true` to prevent browser deletion. Dispatch the plan change, `setLiveTableSelection.of(plan.nextTableSelection)`, `setLiveTableCellEdit.of(null)`, and `scrollIntoView: true`. When no row/column selection exists, return `false` so normal cell Delete behavior remains unchanged.

- [ ] **Step 5: Make contextmenu resolve the current selection scope.**

In the existing `contextmenu` handler, resolve the clicked cell position as today. If the clicked cell is inside `runtime.tableSelection`, pass that selection to `tableMenuItems`; otherwise pass `null` and keep the current one-cell target menu. Store both `tableContextPosition` and `tableContextSelection` so a document change cannot accidentally apply an old selection.

- [ ] **Step 6: Execute table and clipboard menu actions.**

For `TableAction`, preserve the current `planTableOperation` path when there is no selection; with a selection, call `planTableSelectionOperation` for selection actions and convert row/column insert/move actions to the selected row/column target. For `clear-selection`, `delete-selection`, and selection alignment, dispatch the returned single change and next selection. For `copy`, `cut`, and `paste`, focus the editor and call `document.execCommand(command)`; report `false` and leave the menu item disabled when `document.queryCommandSupported?.(command) === false`.

- [ ] **Step 7: Run focused unit tests and static checks.**

Run:

```bash
pnpm exec tsx --test test/editor-table-selection.test.ts test/editor-table-operations.test.ts test/editor-table-menu.test.ts
pnpm lint:check
```

Expected: all focused tests PASS and lint reports no bootstrap type errors.

- [ ] **Step 8: Commit the runtime interaction layer.**

```bash
git add src/editor/bootstrap.ts src/editor/table-menu.ts
git commit -m "feat: support table selection interactions"
```

### Task 5: Add selection styling and complete verification

**Files:**
- Modify: `src/editor/theme.ts:145-280,500-640`
- Modify: `test/editor-table-selection.test.ts` if token-independent class/priority helpers are extracted
- Read: `docs/superpowers/specs/2026-08-25-table-selection-editing-design.md`

- [ ] **Step 1: Add light/dark selection tokens.**

Define `--zmd-table-selection-bg` and `--zmd-table-selection-line` in both theme branches using existing accent/selection tokens. Do not hard-code a new purple-only palette.

- [ ] **Step 2: Add stable selected cell and handle styles.**

Add:

```ts
".zmd-lp-table-cell.zmd-lp-table-cell-selected": {
  backgroundColor: "var(--zmd-table-selection-bg)",
  boxShadow: "inset 0 0 0 2px var(--zmd-table-selection-line)",
},
".zmd-lp-table-row-handle.is-selected, .zmd-lp-table-column-handle.is-selected": {
  opacity: "1",
  backgroundColor: "var(--zmd-table-selection-bg)",
  borderColor: "var(--zmd-table-selection-line)",
  color: "var(--zmd-table-selection-line)",
},
```

Place selected styles after normal active-cell styles and before drag source/drop target overrides so dragging can temporarily show source/drop feedback and then restore selection.

- [ ] **Step 3: Run the full automated verification.**

Run:

```bash
pnpm lint:check
pnpm test:unit
NODE_ENV=production pnpm build
git diff --check
```

Expected: lint passes, all unit tests pass, production build emits the Bamboo XPI, and `git diff --check` emits no whitespace errors.

- [ ] **Step 4: Perform manual Live-mode acceptance in light and dark themes.**

Use a three-column table with at least two body rows and verify:

1. Clicking a body row handle highlights every cell in that row and keeps the handle visible.
2. Clicking a column handle highlights the column across header and body rows.
3. Clicking a cell or paragraph clears the highlight and enters normal cell editing when applicable.
4. A small pointer movement selects; a larger movement reorders the row/column.
5. Delete removes only the selected row/column and selects the adjacent one.
6. Right-click inside the selection keeps the highlight and applies clear/delete/alignment to that selection.
7. Right-click outside the selection shows the existing cell-target menu.
8. Undo/redo, Live/Source switching, and tab/sidebar document synchronization do not leave stale handles or highlights.

- [ ] **Step 5: Commit styling and verification-ready changes.**

```bash
git add src/editor/theme.ts test/editor-table-selection.test.ts
git commit -m "feat: style selected table rows and columns"
```

## Plan self-review

- **Spec coverage:** selection state/remap is Task 1; bulk Markdown operations and menu scope are Task 2; widget rendering is Task 3; click-vs-drag, Delete, context menu and clipboard entry points are Task 4; light/dark styling and acceptance are Task 5.
- **Type consistency:** `TableSelection` is created in Task 1, consumed by operation/menu APIs in Task 2, passed through the `setLiveTableSelection` effect in Task 3, and stored as `runtime.tableSelection` in Task 4.
- **Boundary coverage:** header row, final column, empty body, ragged rows, invalid remap, read-only state, menu target invalidation, and editor destruction are explicitly tested or handled.
- **Completeness scan:** every task has concrete file paths, exported interfaces, test commands, expected results, and a commit boundary; no step depends on an unnamed helper.
