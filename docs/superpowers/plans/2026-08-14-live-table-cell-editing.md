# Live Table Cell Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Live tables visually rendered and aligned while editing only the clicked cell's Markdown source.

**Architecture:** A new pure cell-edit state module plans activation, content replacement, commit, and Tab transitions. The Live Preview plugin renders stable column-addressed widgets and swaps only the active cell for a `contenteditable` widget. `bootstrap.ts` owns document transactions and editor-level click/context lifecycle while CodeMirror remains the only document authority.

**Tech Stack:** TypeScript, CodeMirror 6, Lezer Markdown GFM, DOM `contenteditable`, Node test runner.

## Global Constraints

- Live mode never exposes the complete table row or table Markdown on cell click.
- Only the active cell displays raw Markdown; every other cell stays rendered.
- Source mode remains unchanged.
- Cell updates replace only the exact content range and preserve pipes/spacing.
- IME composition does not emit intermediate semantic commits.
- Existing context-menu operations and final-cell Tab row insertion remain supported.

---

### Task 1: Stable Live row planning

**Files:**

- Modify: `src/editor/table.ts`
- Modify: `src/editor/live-preview/plugin.ts`
- Modify: `src/editor/theme.ts`
- Test: `test/editor-table.test.ts`

**Interfaces:**

- Produces: Live cell plans with `rowIndex`, `columnIndex`, exact content range, outer range, and alignment.
- Consumes: existing GFM `TableLayout` and `liveTableRows(state)`.

- [x] **Step 1: Add failing tests for stable cell column metadata**

Assert each header/body row exposes one logical cell plan per recognized column, including empty cells, with zero-based row/column indices and no delimiter/hide item contract.

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec tsx --test test/editor-table.test.ts`

Expected: missing row/column metadata assertions fail.

- [x] **Step 3: Implement cell metadata and column-addressed widgets**

Render each cell widget with `grid-column: columnIndex + 1`; ensure source replacement elements cannot consume grid tracks. Never apply `.zmd-lp-table-source` merely because a table line is active.

- [x] **Step 4: Run focused tests and type check**

Run: `pnpm exec tsx --test test/editor-table.test.ts && pnpm exec tsc --noEmit`

Expected: tests and type check pass.

### Task 2: Cell edit state and document updates

**Files:**

- Create: `src/editor/table-cell-edit.ts`
- Create: `test/editor-table-cell-edit.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `TableCellEditTarget`, `activateTableCell`, `planCellInput`, `planCellNavigation`, and `remapActiveCell`.
- Consumes: `tableTargetAt`, `tableLayoutAt`, and existing `planTableTab` behavior.

- [x] **Step 1: Write failing tests for activation and cell-only replacement**

Cover non-empty/empty cells, click-offset clamping, preservation of surrounding pipes, stale targets, and read-only activation.

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec tsx --test test/editor-table-cell-edit.test.ts`

Expected: module/export-not-found failures.

- [x] **Step 3: Implement minimal activation/input/remapping functions**

Return CodeMirror change specs for the exact trimmed cell content range and remap the logical row/column after each update.

- [x] **Step 4: Add failing tests for Tab/Shift-Tab and final-cell append**

Assert navigation commits current content, targets adjacent cells, and appends a row from the final cell using the existing table navigation contract.

- [x] **Step 5: Implement navigation planning and verify GREEN**

Run: `pnpm exec tsx --test test/editor-table-cell-edit.test.ts test/editor-table.test.ts`

Expected: all cell-edit and table tests pass.

### Task 3: Contenteditable widget lifecycle

**Files:**

- Modify: `src/editor/live-preview/plugin.ts`
- Modify: `src/editor/bootstrap.ts`
- Modify: `src/editor/theme.ts`
- Test: `test/editor-table-cell-edit.test.ts`

**Interfaces:**

- Live plugin effect: active cell target or `null`.
- Editing widget callbacks: activate, input, composition start/end, commit, and navigate.
- Bootstrap transaction callback: apply a single cell change and re-dispatch the remapped active target.

- [x] **Step 1: Add active-cell state effect to Live plugin**

Store the active logical cell independently of CodeMirror line selection. Render that cell with `contenteditable="true"`, `role="textbox"`, and raw source text; render all other cells normally.

- [x] **Step 2: Wire click, input, composition, Escape, Enter, and outside click**

Single-click activates/focuses the cell. Prevent newline insertion. Commit on outside click/Escape/Enter. Defer semantic document updates during IME composition and commit composition as one change.

- [x] **Step 3: Wire Tab and structural context-menu coordination**

Tab/Shift-Tab commit then navigate. Context-menu actions close active editing before applying their full-table transaction and use the returned operation target for selection.

- [x] **Step 4: Add active-cell styles**

Use subtle theme-aware focus background, no input border, stable minimum height, visible caret, pre-wrapped source, and `grid-column` positioning.

- [x] **Step 5: Run unit tests and build**

Run: `pnpm test:unit && pnpm build`

Expected: all tests pass and plugin build completes.

### Task 4: Documentation and verification

**Files:**

- Modify: `DESIGN.md`

- [x] **Step 1: Update table editing rules**

Document rendered-table persistence, cell-local Markdown source, single-click activation, outside/Escape commit, and Tab behavior.

- [x] **Step 2: Run final automated verification**

Run targeted Prettier and ESLint, `pnpm test:unit`, `pnpm build`, and `git diff --check`.

- [ ] **Step 3: Manual Zotero verification**

Verify 1-8 column alignment, empty/long cells, light/dark themes, caret placement, paste, Chinese IME, undo, autosave, Tab append, right-click operations, and unchanged Source mode.
