# Markdown Table Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared Live/Source table context menu for safe row, column, and alignment operations.

**Architecture:** `table.ts` resolves GFM table targets, while a new pure `table-operations.ts` module parses, transforms, serializes, and returns replacement/selection plans. A focused iframe `table-menu.ts` module owns menu DOM and enablement; `bootstrap.ts` resolves context events and applies one CodeMirror transaction.

**Tech Stack:** TypeScript, CodeMirror 6, Lezer Markdown GFM, Node test runner, Zotero chrome iframe DOM.

## Global Constraints

- Header rows cannot be deleted or moved.
- Tables retain at least one column and the header/delimiter structure.
- Live and Source modes use the same operations and menu.
- Each successful operation uses one CodeMirror transaction.
- Cell Markdown content is preserved while structural pipes and spacing are normalized.

---

### Task 1: Editable table model and transformations

**Files:**

- Create: `src/editor/table-operations.ts`
- Create: `test/editor-table-operations.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `TableLayout`, `TableAlignment`, and `tableLayoutAt(state, position)` from `src/editor/table.ts`.
- Produces: `TableAction`, `TableTarget`, `TableOperationPlan`, `tableTargetAt(state, position)`, and `planTableOperation(state, target, action)`.

- [x] **Step 1: Write failing tests for row transforms**

Cover insert above/below, fixed header, delete, boundary moves, empty body, and resulting selection.

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec tsx --test test/editor-table-operations.test.ts`

Expected: module/export-not-found failures.

- [x] **Step 3: Implement the minimal row model and serializer**

Parse cell content from `TableLayout`, normalize every row to the recognized column count, serialize delimiter alignments as `---`, `:---`, `:---:`, or `---:`, and return one full-table replacement.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec tsx --test test/editor-table-operations.test.ts`

Expected: all row tests pass.

- [x] **Step 5: Add failing tests for column and alignment transforms**

Cover left/right insertion, movement, deletion guard, all alignment values, inline Markdown, empty cells, and selection restoration.

- [x] **Step 6: Implement column and alignment transforms**

Apply column operations to header, body, and alignment arrays together. Return `null` for disabled/out-of-range operations and for alignment no-ops.

- [x] **Step 7: Run focused and existing table tests**

Run: `pnpm exec tsx --test test/editor-table.test.ts test/editor-table-operations.test.ts`

Expected: all tests pass.

### Task 2: Context target and menu state

**Files:**

- Modify: `src/editor/table.ts`
- Create: `src/editor/table-menu.ts`
- Create: `test/editor-table-menu.test.ts`

**Interfaces:**

- Consumes: `TableTarget` and `TableAction` from `table-operations.ts`.
- Produces: `tableMenuItems(target, readOnly)` and `createTableContextMenu(options)`.

- [x] **Step 1: Write failing tests for header/body and boundary enablement**

Assert header row mutations are disabled, first/last body move boundaries are disabled, one-column deletion is disabled, and current alignment is checked.

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm exec tsx --test test/editor-table-menu.test.ts`

Expected: module/export-not-found failures.

- [x] **Step 3: Implement pure menu item planning**

Return stable row/column/alignment groups with `disabled` and `checked` flags. For read-only state, disable every mutation.

- [x] **Step 4: Implement the iframe menu DOM**

Create one fixed-position menu, clamp it to viewport edges, render separators/check marks, and close on action, Escape, outside pointer-down, or destroy.

- [x] **Step 5: Run menu and type tests**

Run: `pnpm exec tsx --test test/editor-table-menu.test.ts && pnpm exec tsc --noEmit`

Expected: tests and type check pass.

### Task 3: CodeMirror event and transaction integration

**Files:**

- Modify: `src/editor/bootstrap.ts`
- Modify: `src/editor/live-preview/plugin.ts`
- Modify: `src/editor/theme.ts`

**Interfaces:**

- Live widget attributes: `data-zmd-table-cell-from` and `data-zmd-table-cell-to`.
- Context event: widget range first, otherwise `view.posAtCoords({x, y})`.
- Action callback: re-resolve target, call `planTableOperation`, dispatch one `{changes, selection}` transaction.

- [x] **Step 1: Add exact table ranges to Live widgets**

Reuse the existing widget range attributes and resolve both Live and Source pointer positions through `tableTargetAt`.

- [x] **Step 2: Wire `contextmenu` and one-transaction actions**

Prevent the native menu only for valid table cells. On action, re-resolve the captured position, apply a plan once, focus the editor, and close the menu.

- [x] **Step 3: Add light/dark context-menu styles**

Use editor theme variables, 8px radius, one-pixel borders, compact 32px rows, visible disabled state, and viewport-safe fixed positioning.

- [x] **Step 4: Run focused tests and build**

Run: `pnpm test:unit && pnpm build`

Expected: all tests pass and plugin build completes.

### Task 4: Documentation and final verification

**Files:**

- Modify: `DESIGN.md`

- [x] **Step 1: Record table menu and structural rules**

Document shared Live/Source behavior, fixed headers, minimum structure, menu groups, and disabled-state behavior.

- [ ] **Step 2: Run final formatting, lint, tests, and build**

Run targeted Prettier and ESLint on changed files, `pnpm test:unit`, `pnpm build`, and `git diff --check`.

- [ ] **Step 3: Manual Zotero checklist**

Verify Live and Source menus, placement near viewport edges, light/dark contrast, outside/Escape dismissal, native fallback outside tables, undo, selection restoration, and Live re-rendering.
