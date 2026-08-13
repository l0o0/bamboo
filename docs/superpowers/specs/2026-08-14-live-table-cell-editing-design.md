# Live Table Cell Editing Design

**Date:** 2026-08-14  
**Status:** Approved interaction direction, pending written-spec review

## Problem

The first Live table implementation exposes two problems:

1. Hidden pipe/whitespace decorations become CSS Grid items, so cells drift diagonally instead of sharing stable columns.
2. Clicking a table row activates the general Live Preview source-line behavior, exposing the complete Markdown row.

The desired result is an Obsidian-like table: the table remains a clean rendered grid while the user edits only the selected cell.

## Goals

- Keep every table row aligned to the same columns in light and dark themes.
- Single-click a cell to enter cell editing without exposing the row or table Markdown.
- Keep the current cell's Markdown source local to that cell while editing.
- Keep all other cells rendered while one cell is being edited.
- Preserve CodeMirror as the single document authority.
- Preserve undo, autosave, IME composition, Tab navigation, and the existing table context menu.

## Non-goals

- Spreadsheet-style multi-cell selection.
- Rich-text editing inside the cell widget.
- Drag-resizing columns.
- Independent nested editor state per cell.
- Showing raw Markdown for the complete table in Live mode.

## Root Cause and Layout Rule

The existing implementation uses replacement decorations to hide pipes and source whitespace. In a CSS Grid line, replacement decorations can still participate in layout even when their visual content is empty; each hidden range therefore consumes a grid item position and pushes later cells diagonally.

The table renderer will stop using source-hiding decorations as Grid children. Each rendered table row will contain only one widget per logical cell, with a stable `grid-column` assigned from the cell index. Source delimiters and whitespace will not be rendered as grid items.

Every table row uses:

```css
grid-template-columns: repeat(var(--zmd-table-columns), minmax(4.5rem, 1fr));
```

Each cell widget receives `grid-column: <index>` and owns its border, padding, overflow, and alignment. Empty cells still render a widget with a minimum height, so they cannot collapse or change column geometry.

## Interaction Model

### Rendered state

- Header and body cells render as a consistent grid.
- Markdown markers are hidden; bold, emphasis, links, code, and strike syntax use the existing Live inline presentation rules.
- Clicking a cell immediately enters editing for that cell.
- The selected cell receives a subtle theme-aware focus background, not an input border.
- Right-click continues to open the existing table context menu for that cell.

### Editing state

- Only the selected cell switches from rendered content to a `contenteditable` cell widget.
- The widget displays the cell's raw Markdown source, including markers such as `**`, `[ ](url)`, backticks, and tildes.
- The table row, delimiter row, and every other cell remain rendered.
- The editing widget receives focus and places the caret at the mapped click offset when possible; otherwise it selects the cell source.
- IME composition remains inside the widget and is committed as one logical document update.
- Typing, paste, delete, and composition update the original CodeMirror document range rather than maintaining a second document.
- Clicking outside the table commits the current cell and exits editing.
- `Escape` commits the current cell and exits editing without reverting content.
- `Tab` and `Shift+Tab` commit the current cell, then move to the next/previous logical cell. Tab at the final cell preserves the existing automatic-row behavior.

### Source mode

Source mode remains a normal CodeMirror Markdown editor. The context menu and structural operations are unchanged. The cell widget is only enabled by Live mode.

## Data Flow

1. `tableLayoutAt` resolves logical cells, including empty cells and outer whitespace ranges.
2. Live decoration planning creates a cell widget with the exact document `from`, `to`, `outerFrom`, `outerTo`, row, column, and alignment.
3. The editor event handler identifies the widget and dispatches a cell-edit effect containing the target range and click offset.
4. The Live plugin rebuilds the selected cell as an editing widget and all other cells as rendered widgets.
5. The editing widget emits `input`/composition changes to the plugin callback.
6. The callback dispatches a CodeMirror transaction replacing only the cell content range. CodeMirror remains the source of truth.
7. A transaction update remaps the cell range; the plugin keeps editing if the same logical cell still exists and otherwise commits/exits safely.

## Widget Contract

The rendered widget exposes:

- `data-zmd-table-cell-from`
- `data-zmd-table-cell-to`
- `data-zmd-table-cell-row`
- `data-zmd-table-cell-column`

The editing widget:

- uses `contenteditable="true"` only when the editor is not read-only;
- sets `role="textbox"` and `aria-multiline="false"`;
- does not use `innerHTML` for source content;
- prevents browser-level line breaks so Enter commits the cell rather than creating an embedded paragraph;
- allows normal text selection, paste, and IME composition.

## Selection and Commit Rules

- Cell content replacement uses the exact trimmed content range, preserving structural spaces and pipes outside the cell.
- A cell with empty content has a valid zero-width replacement range and still receives a visible editing caret.
- A click offset is clamped to the current source length after every transaction.
- Structural table operations commit/close cell editing before applying their full-table replacement.
- If a structural operation deletes or moves the active cell, the returned operation plan becomes the new active target.
- If a cell is no longer found after an external document change, editing exits without reverting that external change.

## Error and Read-only Handling

- Read-only editors never create an editable widget; clicking only updates the visual selected-cell state.
- A failed or stale range update closes editing and leaves the current CodeMirror document intact.
- Browser `beforeinput` events that would insert a newline are prevented.
- Composition events are tracked so intermediate IME text is not committed as separate semantic edits.
- Destroying or resetting the editor removes editing widgets and all associated listeners.

## Testing

Pure tests cover:

- Stable row/cell plans with no hidden Grid children.
- Correct column assignment for empty and non-empty cells.
- Click offset to source offset mapping.
- Cell-only replacement preserving surrounding Markdown.
- Escape, outside click, Tab, and Shift+Tab transitions.
- IME composition update sequencing.

Integration tests cover:

- Live table cells remain aligned after selection changes.
- Clicking one cell does not expose the complete source row.
- Editing inline Markdown updates preview after commit.
- Structural context-menu operations while a cell is active commit/close first.
- Source mode behavior remains unchanged.

Manual Zotero verification covers alignment with 1-8 columns, empty cells, long text, dark mode, click-to-edit caret placement, paste/IME input, undo, autosave, and context-menu use during editing.
