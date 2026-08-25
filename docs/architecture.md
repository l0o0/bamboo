# Architecture

Bamboo is a Zotero chrome plugin with a `chrome://bamboo` CodeMirror iframe. The document authority is always the iframe editor; Zotero-side code owns sessions, files, and chrome UI.

```
Main window shell (toolbar / status / preview)
  └─ SessionView (typed DOM refs)
SessionRegistry (window → itemID → Session)
  └─ SaveCoordinator (revision + single write queue)
     ├─ persistSession (Zotero.File + title + image cleanup)
     └─ Image asset helpers
EditorHandle (postMessage client, cached value)
  ║ postMessage
  ▼
iframe CM6 (decorations, widgets, commands)
```

## Boundaries

- `editor-protocol.ts` and Markdown parse helpers stay pure: no Zotero or chrome DOM.
- `src/editor/` talks only to DOM + CodeMirror. It must not call Zotero APIs.
- File writes go through `SaveCoordinator`. UI code requests a save; it does not call `Zotero.File.putContentsAsync` directly.
- Sessions are isolated per window. Closing a window flushes only that window's editors.

## Save model

Each session has `currentRev` / `savedRev`. Typing increments `currentRev`. Autosave, Ctrl+S, and tab close enqueue a write. The writer snapshots the latest editor value; if a newer rev appears during I/O, another write follows. `flush()` waits until the queue is empty.

## Protocol

High-frequency `change` messages carry `{ rev, changes }` instead of the full document. The parent applies those ranges to its shadow copy. Save/flush calls `requestSnapshot` so the written file is the latest iframe document. Image widgets request a single `resolveAsset`; the parent answers with a cached data URL.

## Follow-ups

Preview is a read-only HTML document page, not an editor mode. The same `buildStandaloneDocument()` renderer feeds the in-app preview, HTML export, and print-to-PDF. Parser unification (Live decorations vs markdown-it export) remains open.
