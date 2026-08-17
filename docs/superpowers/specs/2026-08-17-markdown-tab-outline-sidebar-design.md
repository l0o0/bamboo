# Markdown Tab Outline Sidebar Design

**Date:** 2026-08-17  
**Status:** Approved

## Goal

Add a collapsible document outline to the left side of each Markdown tab. The
outline must stay synchronized with the current document, navigate accurately
to headings, and look like a native Zotero sidebar rather than a separate card
or embedded tool.

## Current State

The Markdown tab shell contains a top toolbar, one full-width editor or preview
surface, and a bottom status bar. The editor runs CodeMirror 6 inside an iframe,
while the toolbar and tab shell run in the Zotero parent document. There is no
outline container or protocol message for heading structure and document
navigation.

The item-pane Markdown editor is a separate feature and is not changed by this
design. The outline belongs only to full Markdown tabs.

## Chosen Architecture

CodeMirror is the source of truth for the outline. The iframe extracts headings
from its Lezer Markdown syntax tree and sends a compact outline model to the tab
shell. The shell renders the native-style sidebar and sends a reveal command
back to the iframe when the user selects an entry.

This avoids reparsing the same source with a second Markdown parser in the
parent document and gives every heading an exact document position. It also
prevents frontmatter, fenced code, and other non-heading uses of `#` from
appearing in the outline.

The protocol model contains, for each heading:

- a stable identifier derived from its document position and level;
- heading level from `1` through `6`;
- plain display text with Markdown markers removed;
- the heading's start position in the CodeMirror document.

Outline updates are emitted after initialization, document replacement, and
document edits. Edit-driven updates use an approximately `100ms` debounce so
normal typing does not rebuild the parent DOM for every keystroke.

## Tab Layout

The tab body becomes a horizontal layout with two siblings:

1. a left outline sidebar;
2. the existing editor or preview workspace.

The expanded sidebar uses a default width of approximately `240px`, a practical
minimum around `200px`, and a maximum around `280px`. It has a `1px` trailing
separator and uses the same neutral surface, border, text, muted-text, hover,
and selection tokens as the existing Zotero Markdown shell.

The sidebar is an unframed page region. It must not use a card, rounded outer
container, drop shadow, gradient, or decorative background.

When collapsed, the sidebar is removed from layout completely. No narrow rail
remains, and the editor or preview surface immediately expands to the full tab
width.

## Toolbar And Sidebar Controls

Add an outline toggle button at the far left of the existing top toolbar. It
uses a familiar panel or list-tree icon, an accessible label, a tooltip, and
`aria-expanded` reflecting the current state.

When the sidebar is expanded, its header is approximately the same height as
Zotero's compact toolbar rows. The header contains the localized title
`Contents` / `目录` and a collapse icon button aligned to the trailing edge.
Both the toolbar toggle and header button operate on the same per-session
state.

Each Markdown tab owns its own outline data and expanded state. Opening,
editing, or collapsing one tab must not affect any other open Markdown tab.
The first release defaults new tabs to an expanded outline and does not add a
global preference.

## Outline Presentation

Render headings as one vertically scrollable tree-like list:

- include ATX and Setext headings from levels `H1` through `H6`;
- preserve document order;
- indent deeper levels using a compact fixed step;
- cap visual indentation so deeply nested headings still leave room for text;
- show one line per item with ellipsis for long headings;
- use slightly stronger weight for top-level entries;
- use native-style hover and selected states;
- expose the full heading text in a tooltip;
- render the localized empty state `No headings` / `无目录` when appropriate.

Missing intermediate levels do not create artificial parent rows. For example,
an `H3` following an `H1` is simply shown at the `H3` indentation level.

The selected entry follows the editor selection's containing or nearest
preceding heading. Selection updates should be lightweight and must not rebuild
the whole outline when only the active heading changes.

## Navigation Behavior

In Live and Source modes, selecting an outline entry sends its document
position to CodeMirror. CodeMirror moves the primary selection to the heading,
scrolls it into view near the top of the viewport, and restores editor focus.
The reveal transaction must not change document text or enter the undo history.

In Preview mode, headings rendered by the existing `markdown-it` path receive
deterministic anchors matched by outline order. Selecting an outline entry
scrolls the corresponding rendered heading into view without switching modes.

If an outline entry becomes stale between rendering and clicking, the receiver
clamps or rejects the position safely and waits for the next outline update. A
stale entry must never throw, edit text, or navigate another tab.

## Responsive Behavior

The expanded sidebar remains fixed within its bounded width while the workspace
takes the remaining space. At narrow tab widths where the workspace would
become impractical, the sidebar automatically collapses visually for that
layout without overwriting the user's explicit expanded preference. The
toolbar toggle remains available to reopen it when space permits.

No viewport-width-based font scaling is introduced. Text sizes and control
sizes continue to follow Zotero and the existing editor theme.

## Accessibility

- The sidebar uses a navigation landmark with a localized accessible name.
- The outline is represented as a tree or list with the current item exposed
  through `aria-current`.
- Toggle buttons expose `aria-label`, tooltip text, and `aria-expanded`.
- Every action is keyboard reachable and has a visible focus state.
- Enter or Space activates the focused outline entry.
- Collapsing the sidebar from its header returns focus to the toolbar toggle.

## Error Handling

- If syntax-tree extraction fails, retain the last valid outline and log one
  scoped diagnostic rather than disrupting the editor.
- If there are no headings, show the empty state and keep navigation inert.
- Ignore outline and reveal messages whose channel does not match the current
  tab session.
- Destroy pending debounce timers and listeners when the editor or tab closes.
- A failure in outline UI mounting must not block editing or saving.

## Testing

Add focused tests for:

- extraction of ATX and Setext `H1-H6` headings in document order;
- exclusion of frontmatter, fenced-code content, and non-heading `#` text;
- plain display text and exact document positions;
- debounced updates after edits and immediate updates after initialization;
- channel isolation across multiple open Markdown tabs;
- reveal commands moving selection without changing document content;
- stale or out-of-range reveal positions;
- expanded and completely collapsed layout states;
- independent collapse state per session;
- hierarchy indentation, long-title truncation, empty state, and active item;
- Preview anchors and scrolling behavior;
- light and dark theme tokens and narrow-width behavior;
- successful unit tests, production build, lint, and formatting checks.

## Out Of Scope

- Resizing the sidebar by dragging;
- searching or filtering the outline;
- moving, renaming, deleting, or creating headings from the outline;
- persisting outline width or expanded state as a global preference;
- displaying frontmatter keys, paragraphs, tables, figures, or code symbols;
- changing the item-pane Markdown sidebar;
- replacing CodeMirror or the existing Preview renderer.

## Acceptance Criteria

1. Every Markdown tab opens with a native-style outline on the left and an
   outline toggle at the far left of the toolbar.
2. Collapsing the outline removes it completely and restores the full editor
   width; the toolbar button can reopen it.
3. Valid `H1-H6` headings update during editing without false entries from
   frontmatter or code blocks.
4. Clicking an entry navigates accurately in Live, Source, and Preview modes
   without changing Markdown content.
5. Outline data, selection, and collapse state remain isolated between open
   tabs.
6. The UI remains readable and consistent with Zotero in light, dark, and
   narrow layouts.
7. Existing editing, saving, image, table, export, sidebar, and multi-tab
   behavior continues to pass its tests.
