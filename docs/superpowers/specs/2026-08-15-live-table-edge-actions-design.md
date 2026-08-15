# Live Table Edge Actions Design

**Date:** 2026-08-15  
**Status:** Approved interaction direction

## Goal

Provide Obsidian-style edge actions for quickly appending a column or row to a rendered Live table.

## Interaction

- Moving the pointer into the right edge hit area of any rendered table row reveals one continuous table-height action rail, with a centered `+` at the pointer's row.
- Activating the right button appends one column to the table's right edge.
- Moving the pointer into the bottom edge hit area of the final rendered row reveals a horizontal `+` button.
- Activating the bottom button appends one body row to the table's bottom edge.
- The buttons remain hidden outside their hit areas and do not shift table geometry when shown.
- Hover tooltips read `在右侧新增列` and `在下方新增行`.
- The controls are available only in Live mode when the editor is writable.

## Widget Architecture

- Extend the rendered table-cell widget with a right-edge action only for the final logical cell in each row.
- Add one bottom-edge action to the final visible row.
- Use real `<button type="button">` elements with `aria-label`, rather than pseudo-elements, so pointer and keyboard activation share one path.
- Keep the controls inside the existing table row DOM. Position the column action in the reserved right gutter and measure the bottom action as final-row padding so it does not become a CSS Grid track, alter column widths, or introduce vertical line margins.
- Button pointer and click events stop propagation so they never activate cell editing or move the CodeMirror selection first.

## Operations

- The right action targets the row's final logical cell and invokes the existing `insert-column-right` table operation.
- The bottom action targets the final row's first logical cell and invokes the existing `insert-row-below` table operation.
- Each action remains one CodeMirror transaction, preserving the current undo and autosave behavior.
- After insertion, the newly created column or row target becomes the active Live cell, consistent with existing structural table operations.

## Layout and States

- Reserve stable pointer space without changing the visible table width or using vertical margins on CodeMirror lines.
- Default state: transparent hit area and hidden plus glyph. The final-row padding that reserves the bottom hit area has no table background or border while idle.
- Right-edge row segments synchronize their hover state so they read as one continuous column without requiring cross-line layout measurement.
- Hover/focus-visible state: muted surface, visible plus glyph, and existing tooltip treatment.
- Dark and light themes use the current table border, muted surface, text, and focus tokens.
- Read-only mode renders no edge action buttons.

## Event Safety

- `pointerdown`, `mousedown`, and `click` on an edge button stop propagation.
- Button activation dispatches a dedicated table-edge custom event containing the exact table position and append action.
- The iframe bootstrap validates the table target against current editor state before planning the operation.
- A stale or deleted table makes the action a no-op without modifying the document.

## Verification

- Right-edge actions append exactly one final column from header or body rows.
- Bottom-edge action appends exactly one final body row.
- Clicking an action does not enter cell editing.
- Undo restores the previous table in one step.
- Buttons are absent in read-only and Source modes.
- One-to-eight-column tables retain aligned geometry in light and dark themes.
