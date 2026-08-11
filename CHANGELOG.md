# Changelog

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
