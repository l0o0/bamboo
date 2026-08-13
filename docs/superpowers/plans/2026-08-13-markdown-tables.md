# Markdown Table Phase 1 Implementation Plan

**Goal:** Add a practical first version of table editing: an 8x8 toolbar picker, GFM-aware parsing, Live mode table presentation, and keyboard cell navigation.

**Architecture:** CodeMirror owns the document and uses the official Lezer GFM extension as the source of table structure. Parent toolbar UI only chooses dimensions and inserts serialized Markdown. Live Preview decorates recognized table rows without introducing a second editable document.

**Tech Stack:** TypeScript, CodeMirror 6, Lezer Markdown GFM, Node test runner.

### Task 1: Table model and insertion contract

- Extend `tableInsertTemplate(rows, columns)` with bounded dimensions.
- Add tests for defaults, custom dimensions, and selection placement.

### Task 2: GFM syntax and keyboard navigation

- Configure CodeMirror Markdown with `GFM`.
- Derive table/cell ranges from the syntax tree.
- Add `Tab` and `Shift-Tab` navigation; append a row at the final cell.
- Test AST recognition and navigation transactions.

### Task 3: Toolbar table picker

- Add an anchored 8x8 grid below the table icon.
- Highlight the hovered rectangle and show `columns x rows`.
- Insert the selected template and close on outside click/Escape.
- Add responsive light/dark styles consistent with the toolbar.

### Task 4: Live Preview table presentation

- Plan decorations from GFM table rows/cells.
- Present inactive rows as a consistent grid with header, borders, and alignment.
- Keep the active row editable as Markdown source.
- Add focused tests for decoration planning.

### Task 5: Documentation and verification

- Record the table interaction rules in `DESIGN.md`.
- Run focused tests, full unit tests, formatting/type/build checks.
