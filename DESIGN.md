---
name: Zotero Markdown
description: A focused Markdown editor that feels native to Zotero and readable at writing speed.
colors:
  canvas: "#fbfbfc"
  surface: "#ffffff"
  surface-muted: "#f3f4f6"
  border: "#e5e7eb"
  text: "#111827"
  text-muted: "#6b7280"
  accent: "#2563eb"
  success: "#059669"
  warning: "#d97706"
  danger: "#dc2626"
  dark-canvas: "#12141a"
  dark-surface: "#1a1d24"
  dark-surface-muted: "#22262f"
  dark-text: "#e8eaed"
  dark-text-muted: "#9aa3b2"
  dark-accent: "#60a5fa"
  dark-success: "#34d399"
typography:
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1
rounded:
  button: "7px"
  sm: "6px"
  md: "8px"
spacing:
  toolbar-inline-start: "34px"
  toolbar-inline-end: "30px"
  content-inline: "28px"
  toolbar-block: "4px"
  control: "36px"
components:
  toolbar-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.button}"
    size: "{spacing.control}"
  toolbar-button-hover:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text}"
    rounded: "{rounded.button}"
    size: "{spacing.control}"
---

# Design System: Zotero Markdown

## Overview

**Creative North Star: "The Quiet Research Desk"**

Zotero Markdown is a compact, native-feeling writing surface for researchers working inside Zotero. Its interface should recede while the document remains legible, using a restrained neutral palette, thin structural borders, and one consistent icon vocabulary.

The editor is document-first, not an IDE or a dashboard. Live Preview uses a centered reading column; the toolbar and status bar align to the same horizontal rhythm. The UI should feel deliberate and calm, never like a collection of floating controls.

- Dense enough for frequent writing actions.
- System typography with strong Chinese and Latin fallback coverage.
- Light and dark themes use equivalent hierarchy, not merely inverted colors.

## Colors

The palette uses cool neutral surfaces and one blue accent reserved for links, focus, and primary context. Green, amber, and red communicate save success, pending changes, and errors only.

### Primary

- **Research Blue** (`#2563eb`, dark `#60a5fa`): links, focus, and accent state. Do not use it as a decorative background across the editor.

### Neutral

- **Paper Canvas** (`#fbfbfc`): outer editor canvas in light mode.
- **Document Surface** (`#ffffff`): primary light writing surface.
- **Utility Surface** (`#f3f4f6`): toolbar hover and status-bar surface.
- **Graphite Text** (`#111827`): primary light-mode text.
- **Night Canvas** (`#12141a`) and **Night Surface** (`#1a1d24`): dark-mode background layers.

### Status

- **Saved Green** (`#059669`, dark `#34d399`): only for successfully saved state.
- **Pending Amber** (`#d97706`): only for unsaved or saving state.
- **Error Red** (`#dc2626`): only for save failure or destructive feedback.

## Typography

**Body Font:** `system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`

**Label Font:** The body stack, at 12px and medium weight for toolbar controls and status details.

**Character:** Reading-oriented system sans typography. Live Preview uses 1.7 line height and a centered 48rem maximum text column. Source mode may use a monospace stack without changing the surrounding shell.

### Hierarchy

- **Document body** (14px, 400, 1.7): primary writing and reading content.
- **Toolbar label** (12px, 500, 1): tooltip and control label context only; buttons themselves are icon-first.
- **Status detail** (11px, 500): word and line counts, save status, and time. Use tabular numbers where time or counts appear.

## Elevation

Depth is primarily structural: separated surfaces use a one-pixel border and tonal contrast. The toolbar gets only a subtle `0 1px 2px rgba(16, 24, 40, 0.04)` shadow in light mode, with a darker equivalent in dark mode. Do not add floating cards or decorative shadows to the writing canvas.

## Components

### Toolbar

The toolbar is a single, centered icon toolbelt. It follows the Live Preview text boundaries: a `44rem` usable track inside the centered `48rem` reading column, with `34px` left and `30px` right insets. Use 4px block padding on the outer toolbar and keep functional groups separated by a one-pixel divider.

### Toolbar Buttons

- **Shape:** Responsive 36/40/44px square hit target, 7px radius, no resting border. Default to 40px.
- **Default:** transparent background with muted text color.
- **Hover:** `surface-muted` background with primary text color.
- **Icons:** Lucide-style 16/18/20px stroke icons that follow toolbar container width. Default to 18px; never scale directly from `devicePixelRatio`.
- **Ordering:** save, history, text structure, list/task controls, inline/content insertion, then a right-aligned horizontal more menu.

### More Menu

- **Surface:** a compact `max-content` menu (12–16rem) whose right edge aligns with the more button, with an 8px radius, one-pixel border, and restrained shadow.
- **Grouping:** do not render category headings; separate document, editing, export, and other actions with one-pixel dividers.
- **Submenus:** Mode expands an indented inline list with a check on the current mode. Settings remains a reserved submenu entry.
- **Unavailable actions:** every planned-but-unimplemented action gives immediate lightweight feedback instead of silently doing nothing.

### Editor Column

- **Live Preview:** 48rem maximum width, centered, with 28px inline and 20px top padding.
- **Source:** unconstrained document width and monospace text, while retaining the same surrounding shell.
- **List markers:** use an explicit high-contrast marker treatment in dark mode; do not rely on muted syntax opacity for list labels.

### Status Bar

- **Layout:** left-aligned `words · lines`; right-aligned save state and time.
- **Padding:** 5px block and 28px inline, matching toolbar and document edges.
- **Saved state:** green check, local `HH:mm` time, and the text `自动保存已开启`.

## Do's and Don'ts

### Do:

- **Do** align the toolbar and rendered tables to the Live text boundaries inside the centered 48rem reading column.
- **Do** use icon-first controls with 36px targets and visible tooltips.
- **Do** keep interaction states restrained: a muted surface hover is enough for ordinary toolbar actions.
- **Do** preserve a clear, semantic save state in the status bar.
- **Do** verify dark mode contrast for small UI marks, especially list labels and status icons.

### Don't:

- **Don't** reintroduce branding, mode pills, or text status pills into the toolbar.
- **Don't** use blue filled buttons for routine editor controls; the accent is for focus and semantic emphasis.
- **Don't** put controls in rounded group containers or use decorative glass effects.
- **Don't** add floating cards, oversized shadows, gradients, or marketing-style composition to the editor shell.
- **Don't** let status-bar content sit closer to the window edge than the toolbar or Live Preview content.

## Table Editing

The toolbar table control opens an anchored `8 x 8` grid. Hovering previews a contiguous rectangle and reports `columns x rows`; clicking inserts a valid GFM table with the first header cell selected. Row count describes visible table rows and excludes the Markdown delimiter line.

In Live mode, GFM tables remain a restrained rendered grid with shared column widths, a tinted header, one-pixel borders, and Markdown alignment markers respected. Clicking a cell activates only that cell: it receives a subtle focus background and shows its local Markdown source in place, while the row and all other cells remain rendered. The delimiter line stays collapsed throughout Live mode. CodeMirror remains the only document authority; cell input replaces only the exact cell content range.

Table borders use the same `34px` left and `30px` right insets as Live prose instead of extending to the outer reading-column edges.

The active table cell uses single-click activation with no input border. `Enter`, `Escape`, or a click outside the table commits and exits cell editing. `Tab` and `Shift+Tab` commit and move between logical cells; Tab from the final cell appends a body row. Right-click keeps the structural table menu available, and Source mode continues to expose normal Markdown without Live cell widgets.

Writable Live tables expose transient edge actions: hovering any right-gutter segment reveals one continuous table-height rail for appending a final column, while hovering the visually transparent bottom gutter reveals the action for appending a final row. The controls are real focusable buttons, remain outside table Grid tracks, and never activate cell editing. Rendered cells carry stable table, row, and column identity so newly appended empty cells receive input without falling back to an adjacent source position.

- `Tab` moves to the next logical cell.
- `Shift+Tab` moves to the previous logical cell.
- `Tab` in the final cell appends a new empty row and moves into its first cell.
- Light and dark themes use the same geometry and differ only in semantic surface and border tokens.

The table context menu is shared by Live and Source modes. It appears only when the pointer resolves to a logical GFM table cell; otherwise the native Zotero context menu remains available. Keep row, column, and alignment commands in stable groups separated by one-pixel dividers, without visible group headings.

- The header is fixed and cannot be deleted or moved.
- A table retains at least one column and its header/delimiter structure.
- Boundary moves and deletion of the final column remain visible but disabled.
- The current column alignment is marked with a restrained accent check.
- Every successful structural command replaces the table in one CodeMirror transaction so one undo restores the previous table.
- Context menus use compact 32px rows, an 8px radius, theme-aware surfaces, and viewport-clamped fixed positioning.
