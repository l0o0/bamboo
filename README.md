# Zotero Markdown

[![zotero target version](https://img.shields.io/badge/Zotero-7%2F8-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)](https://github.com/l0o0/zotero-markdown)
[![license](https://img.shields.io/badge/license-AGPL--3.0-orange?style=flat-square)](./LICENSE)

**Native Markdown for Zotero.** Treat `.md` files as first-class attachments — open, edit, preview, and create them inside Zotero.

[English](README.md) | [简体中文](doc/README-zhCN.md)

---

## Why

Zotero is excellent for collecting and organizing research. In the AI era, **plain Markdown files** are the common currency of knowledge tools (Obsidian, LLMs, static sites, git).

[Better Notes](https://github.com/windingwind/zotero-better-notes) greatly improves Zotero’s built-in **Notes**, but those notes are still Zotero notes — not native `.md` files on disk.

**Zotero Markdown** fills that gap:

| | Better Notes | **Zotero Markdown** |
|--|--|--|
| Primary surface | Zotero Note (rich text) | Real **`.md` attachment files** |
| File on disk | Optional sync/export | The file *is* the note |
| Obsidian / AI | Bridge / export | Drop-in plain text |
| Relationship | — | **Complementary** — we don’t touch Notes |

> Make Zotero great again for knowledge management — one native Markdown file at a time.

---

## Features (v0.1)

- **Open** `.md` / `.markdown` attachments in a main-window **tab** (not the system app)
- **Edit** with [CodeMirror 6](https://codemirror.net/) (syntax highlight, line wrap, undo, search)
- **Preview** rendered Markdown (toggle Edit / Preview)
- **Autosave** (debounced) + **Ctrl/Cmd+S**
- **New Markdown…** from the item context menu (stored attachment by default)
- Supports **stored** and **linked** attachments
- Preference to enable/disable intercepting open

### Planned (not in v0.1)

- Wiki-links `[[...]]` and in-library jump
- YAML frontmatter ↔ Zotero fields
- Export PDF annotations / highlights → `.md`
- Auto-reload when a linked file changes externally
- Session restore for Markdown tabs

---

## Install

### From XPI (release)

1. Download the latest `.xpi` from [Releases](https://github.com/l0o0/zotero-markdown/releases)
2. In Zotero: **Tools → Plugins → gear → Install Plugin From File…**
3. Restart Zotero if prompted

### Development build

```bash
pnpm install
pnpm run build
# XPI: .scaffold/build/zotero-markdown.xpi
```

---

## Usage

1. Select a library item → right-click → **New Markdown…**  
   A stored `.md` attachment is created and opened.
2. Edit in the tab. Changes autosave; use **Ctrl/Cmd+S** to save immediately.
3. Click **Preview** to render; **Edit** to return to source.
4. Double-click any `.md` attachment later to reopen the editor.
5. Or right-click a `.md` attachment → **Open with Markdown Editor**.

Drag existing `.md` files into Zotero (or attach linked files) — double-click still opens them here.

---

## Requirements

- Zotero **7** or **8** (including beta)
- Desktop app (not Zotero Web)

---

## Development

Uses [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) and [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit). Package manager: **pnpm**.

### Setup

```bash
# Copy env and point at your Zotero binary / profile / data dir
cp .env.example .env

pnpm install
pnpm start          # build + launch Zotero with hot reload
```

China mainland users: project `.npmrc` already uses [npmmirror](https://npmmirror.com/).

### Scripts

| Command | Description |
|---------|-------------|
| `pnpm start` | Dev server + hot reload |
| `pnpm run build` | Production build + typecheck |
| `pnpm test` | Plugin tests |
| `pnpm run lint:check` | Prettier + ESLint |
| `pnpm run lint:fix` | Auto-fix lint |

### Layout

```
src/
  hooks.ts                 # lifecycle
  modules/markdown/
    detect.ts              # is this a markdown attachment?
    create.ts              # new stored .md
    open.ts                # FileHandlers interceptor
    tab.ts                 # tab UI, autosave
    editor.ts              # CodeMirror 6
    preview.ts             # markdown-it render
    menu.ts                # context menus
    styles.ts              # injected CSS
addon/                     # bootstrap, locale, prefs, icons
```

### `.env` (dev only)

See [`.env.example`](./.env.example). Typical keys:

- `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` — Zotero binary
- `ZOTERO_PLUGIN_PROFILE_PATH` — dev profile
- `ZOTERO_PLUGIN_DATA_DIR` — optional data directory

---

## Configuration

**Edit → Settings → Zotero Markdown**

- **Enable Markdown editor for .md attachments** — when off, Zotero opens `.md` with the system handler again

---

## FAQ

**Does this replace Better Notes?**  
No. Better Notes improves Zotero Notes. This plugin only handles **real Markdown files** as attachments. Install both if you want.

**Where are files stored?**  
- *New Markdown…* creates a **stored** attachment under Zotero’s storage.  
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
- [CodeMirror](https://codemirror.net/), [markdown-it](https://github.com/markdown-it/markdown-it)
- Inspired by the knowledge workflows of Obsidian and the Zotero community

---

## License

[AGPL-3.0-or-later](./LICENSE)
