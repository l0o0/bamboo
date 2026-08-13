# Markdown Table Operations Design

**Date:** 2026-08-14  
**Status:** Approved design, pending written-spec review

## Goal

Extend the first table-editing phase with a shared context menu for Live and Source modes. Users can insert, delete, and move body rows; insert, delete, and move columns; and set column alignment without manually rewriting Markdown table syntax.

## Scope

This phase includes:

- A table context menu in both Live and Source modes.
- Row insertion above or below the current row.
- Body-row deletion and movement.
- Column insertion, deletion, and movement.
- Default, left, center, and right column alignment.
- Single-transaction document updates so each operation can be undone once.

This phase does not include:

- Drag-and-drop row or column reordering.
- Column sorting.
- Multi-cell selection.
- Spreadsheet-style clipboard operations.
- Column-width persistence or manual resizing.

## Structural Rules

- The header row is fixed and cannot be deleted or moved.
- A table always retains at least its header and delimiter rows.
- A table always retains at least one column.
- Body rows may be inserted, deleted, or moved.
- Inserting a row while the header is targeted creates a body row immediately below the delimiter. The "insert above" and "insert below" labels still describe placement relative to the first body-row boundary; neither operation creates a second header.
- Operations that would violate these rules are disabled rather than silently changed.
- Moving the first body row upward or the last body row downward is disabled.
- Deleting the only column is disabled.

## Context Resolution

The iframe handles the native `contextmenu` event before Zotero's application menu opens.

1. In Live mode, rendered cell widgets expose their exact document `from` and `to` positions.
2. In Source mode, CodeMirror resolves the pointer coordinates to a document position.
3. The GFM syntax tree resolves that position to a `Table`, logical row, and logical column.
4. If the position is not inside a GFM table cell, the plugin does not intercept the event and the normal Zotero context menu remains available.

Empty cells are resolved from table delimiters, not only `TableCell` nodes, because Lezer does not emit `TableCell` nodes for empty values.

## Menu Structure

The menu uses the existing restrained toolbar/menu visual language. It has no visible group headings and separates groups with one-pixel dividers.

Row group:

- Insert row above
- Insert row below
- Move row up
- Move row down
- Delete row

Column group:

- Insert column left
- Insert column right
- Move column left
- Move column right
- Delete column

Alignment group:

- Default
- Align left
- Align center
- Align right

The current alignment is marked with a check. Disabled actions remain visible so the menu does not shift as the pointer moves between cells. The menu closes after an action, on Escape, on pointer-down outside, or when the editor loses its table context.

For a header target, row deletion and movement are disabled. Row insertion remains enabled and creates a body row at the start of the body section.

## Transformation Model

Table operations are pure transformations over a parsed table model:

```ts
interface EditableTable {
  header: string[];
  alignments: Array<"default" | "left" | "center" | "right">;
  body: string[][];
}
```

The model preserves the raw Markdown content inside each logical cell. Structural whitespace and pipes are normalized when the table is serialized.

Canonical serialization uses:

<!-- prettier-ignore -->
```md
| Header | Header |
| --- | :---: |
| Cell | Cell |
```

Alignment delimiters are serialized as:

- Default: `---`
- Left: `:---`
- Center: `:---:`
- Right: `---:`

Cells missing from a short source row are padded with empty strings. Extra cells beyond the header column count are preserved only if the GFM parser recognizes them as table cells; the resulting model expands all rows to the recognized maximum before applying the requested operation.

Each command returns the full replacement range, serialized Markdown, and the target cell in the transformed table. CodeMirror applies that result through one transaction and restores selection to the corresponding cell.

## Row Operations

- Insert operations create an empty row with the current column count.
- Delete removes only a body row.
- Move swaps the selected body row with its adjacent body row.
- When a table has no body rows, either header insertion command creates the first body row.
- After insertion, selection moves to the new row's cell in the original column.
- After deletion, selection moves to the same column in the next row, or the previous row when the deleted row was last.
- After movement, selection follows the moved row.

## Column Operations

- Insert adds an empty cell to the header and every body row, plus a default alignment entry.
- Delete removes the selected column from every row and its alignment entry.
- Move swaps the selected column across the header, every body row, and alignment entries.
- After insertion, selection moves to the inserted header or body cell matching the original row.
- After deletion, selection moves to the column now occupying the deleted index, or the new last column.
- After movement, selection follows the moved column.

## Alignment Operations

Alignment applies to the complete selected column through the delimiter row. It does not modify cell contents. Selecting the already-active alignment is allowed and produces no document change; the menu still closes.

## Error Handling

- If the syntax tree no longer matches the captured table position when an action is chosen, the action is cancelled and the menu closes.
- Invalid or out-of-bounds transformations return no change.
- Read-only editors show the table menu with all mutation actions disabled.
- A failed transformation must never partially modify the document.

## Testing

Pure transformation tests cover:

- Insert, delete, and move body rows.
- Fixed-header and row-boundary behavior.
- Insert, delete, and move columns.
- One-column deletion protection.
- All four alignment encodings.
- Empty cells, short rows, inline Markdown, and escaped pipes.
- Selection placement after each operation.

Integration-level tests cover:

- GFM position resolution in header, delimiter, body, and empty cells.
- Context-menu enablement for header/body and boundary positions.
- Live and Source contexts producing the same table target.
- One CodeMirror transaction per successful operation.

Manual Zotero verification covers menu placement, light/dark contrast, outside-click and Escape dismissal, native-menu fallback outside tables, undo behavior, and Live re-rendering after each operation.
