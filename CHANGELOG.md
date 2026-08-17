# Changelog

## 0.1.3 - 2026-08-17

### Features

- Add a Zotero-native Markdown sidebar editor with compact formatting controls and tab handoff
- Add a collapsible document outline for Markdown tabs
- Add editable live-preview tables with row and column edge actions
- Add fenced-code syntax highlighting across editor and preview modes
- Add local image attachment handling, asset cleanup, and live-preview image editing
- Add a public Markdown API and Zotero 9/10 pane compatibility layer

### Fixes

- Isolate editor sessions so multiple Markdown tabs no longer share titles or content
- Improve live-preview rendering for lists, tables, images, code blocks, and strikethrough
- Repair sidebar lifecycle, focus, sizing, and switching behavior
- Ensure release version bumps include `package.json`

### Documentation

- Update English and Chinese usage documentation and add implementation plans for the editor, sidebar, images, tables, and compatibility layer

## 0.1.0 - 2026-08-11

### Features

- Replace the plain textarea editor with **CodeMirror 6** hosted in a `chrome://` iframe for a stable Web document under Zotero
- Markdown syntax highlighting, line numbers, fold gutters, search keybindings, and history in the source editor
- Live light/dark theme sync when Zotero or the OS color scheme changes (open tabs update without reopening)
- Dual esbuild entry: plugin bootstrap + iframe editor bundle

### Fixes

- Avoid marking sessions dirty on editor init
- Fix `preview.ts` null `defaultView` type error during build

### Documentation

- Add `docs/editor/codemirror-iframe-plan.md` describing architecture, protocol, and rollout
