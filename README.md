# Bamboo 竹子

[![Zotero compatibility](https://img.shields.io/badge/Zotero-9%2F10-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![version](https://img.shields.io/badge/version-0.1.7-blue?style=flat-square)](https://github.com/l0o0/bamboo/releases)
[![license](https://img.shields.io/badge/license-AGPL--3.0-orange?style=flat-square)](./LICENSE)

**Bamboo 竹子 brings native Markdown to Zotero.** Treat `.md` files as first-class attachments — open, edit, preview, and create them inside Zotero.

[English](README.md) | [简体中文](doc/README-zhCN.md)

---

## Why

Zotero is excellent for collecting and organizing research. In the AI era, **plain Markdown files** are the common currency of knowledge tools (Obsidian, LLMs, static sites, git).

[Better Notes](https://github.com/windingwind/zotero-better-notes) greatly improves Zotero's built-in **Notes**, but those notes are still Zotero notes — not native `.md` files on disk. **Bamboo 竹子** fills that gap: it complements Better Notes without touching Notes, and its Markdown files are drop-in plain text for Obsidian and AI workflows.

---

## Features

- **Open** `.md` / `.markdown` attachments in a main-window **tab** (not the system app)
- **Edit** in a fast built-in editor — line numbers, Tab indentation, word/char counts, and toolbar shortcuts for common Markdown syntax (bold, italic, headings, links)
- **Preview** rendered Markdown (toggle Edit / Preview)
- **Autosave** (debounced) + **Ctrl/Cmd+S**
- **New Markdown…** from the item context menu (stored attachment by default)
- Supports **stored** and **linked** attachments
- Preference to enable/disable intercepting open
- Kebab menu with document info, safe renaming, folder reveal, and plugin settings
- Import remote Markdown images into the note's local `assets/` directory for offline use

### Planned

- Wiki-links `[[...]]` and in-library jump
- YAML frontmatter ↔ Zotero fields
- Export PDF annotations / highlights → `.md`
- Auto-reload when a linked file changes externally
- Session restore for Markdown tabs

---

## Install

Download the latest `bamboo-v{version}.xpi` from [Releases](https://github.com/l0o0/bamboo/releases), then in Zotero: **Tools → Plugins → gear → Install Plugin From File…** and restart if prompted.

### Development build

```bash
pnpm install
pnpm run build
# XPI: .scaffold/build/bamboo-v{version}.xpi
```

---

## Usage

1. Select a library item → right-click → **New Markdown…**  
   A stored `.md` attachment is created and opened.
2. Edit in the tab. Changes autosave; use **Ctrl/Cmd+S** to save immediately.
3. Click **Preview** to render; **Edit** to return to source.
4. Double-click any `.md` attachment later to reopen the editor.
5. Or right-click a `.md` attachment → **Open with Markdown Editor**.

Use the tab's kebab menu for document metadata, renaming, opening the containing
folder, and Markdown-specific settings. **Import external images** downloads
`http(s)` image references into the attachment's `assets/` directory and
rewrites the Markdown links to local paths, so the document remains usable
offline.

Drag existing `.md` files into Zotero (or attach linked files) — double-click still opens them here.

---

## Requirements

- Zotero **9** or **10**
- Desktop app (not Zotero Web)

---

## Development

Uses [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) and [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit). Package manager: **pnpm**.

### Setup

```bash
# Copy env and point at your Zotero binary / profile / data dir (see .env.example)
cp .env.example .env

pnpm install
pnpm start          # build + launch Zotero with hot reload
```

China mainland users: project `.npmrc` already uses [npmmirror](https://npmmirror.com/).

### Scripts

| Command               | Description                  |
| --------------------- | ---------------------------- |
| `pnpm start`          | Dev server + hot reload      |
| `pnpm run build`      | Production build + typecheck |
| `pnpm test`           | Plugin tests                 |
| `pnpm run lint:check` | Prettier + ESLint            |
| `pnpm run lint:fix`   | Auto-fix lint                |

---

## Configuration

**Edit → Settings → Bamboo 竹子**

- **Enable Markdown editor for .md attachments** — when off, Zotero opens `.md` with the system handler again

---

## API for other plugins

Bamboo 竹子 exposes its in-process API at `Zotero.Bamboo.api.markdown`
for other plugins / MCP bridges to create and edit `.md` documents inside Zotero.
All methods are async, JSON-friendly, and reject with `MarkdownApiError`
(`error.code` is stable).

```js
const md = Zotero.Bamboo.api.markdown;

// List markdown attachments in the user library
const docs = await md.list({ q: "note" });

// Read one
const { content } = await md.read(docs[0].itemID);

// Create under a literature item, then edit
const created = await md.create({
  parentItemID: 123,
  initialContent: "# Title",
});
await md.update(created.itemID, { content: "# New\n\nupdated" });

// Patch frontmatter only
await md.patchFrontmatter(created.itemID, {
  set: { tags: ["ai", "draft"] },
  delete: ["old-key"],
});

// Open / flush / close editor tabs
await md.openTab(created.itemID);
await md.flush(created.itemID);
await md.closeTab(tabID);
```

Methods: `list`, `stat`, `read`, `create`, `createLinked`, `update`,
`patchFrontmatter`, `rename`, `trash`, `openTab`, `closeTab`, `sessions`,
`flush`, `toHtml`, `render`, `documentTitle`.

Error codes: `ITEM_NOT_FOUND`, `NOT_MARKDOWN`, `WRITE_CONFLICT`,
`WRITE_FAILED`, `INVALID_ARGUMENT`, `NOT_OPEN`.

Notes:

- All writes go through the same persistence path as the editor (file write,
  image-asset cleanup, item-title sync, Zotero file-sync marking).
- `update` rejects with `WRITE_CONFLICT` when an open editor tab has unsaved
  changes — pass `force: true` to overwrite.
- `rename` renames the underlying file; for linked attachments this renames
  the file on disk.
- API version: `Zotero.Bamboo.api.version` (currently `2`).

---

## FAQ

**Does this replace Better Notes?**  
No. Better Notes improves Zotero Notes. This plugin only handles **real Markdown files** as attachments. Install both if you want.

**Where are files stored?**

- _New Markdown…_ creates a **stored** attachment under Zotero's storage.
- You can also attach **linked** files pointing at an Obsidian vault or any folder.

**Will Zotero sync my `.md` files?**  
Stored attachments follow Zotero file sync (if enabled). Linked files do not upload with Zotero file sync.

**Which extensions are recognized?**  
`.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, plus `text/markdown` content type.

---

## Contributing

Issues and PRs welcome. For larger features, open an issue first so we can align on scope.

---

## Acknowledgments

- Built on [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
- [markdown-it](https://github.com/markdown-it/markdown-it)
- Inspired by the knowledge workflows of Obsidian and the Zotero community

---

## License

[AGPL-3.0-or-later](./LICENSE)
