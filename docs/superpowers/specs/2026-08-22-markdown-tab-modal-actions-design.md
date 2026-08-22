# Markdown Tab Modal Actions Design

## Goal

Add a reusable, centered modal layer to the Markdown tab so the kebab menu can
provide document information, attachment renaming, file-manager reveal, and
plugin settings without leaving the editor.

## Scope

- `文档信息` shows the current attachment path, file size, referenced local
  image count, creation time, modification time, and storage type.
- `重命名` edits the attachment filename while preserving the `.md` extension,
  updates the Zotero item title and current tab title, and does not rewrite
  Markdown frontmatter.
- `在文件夹中显示` reveals the containing directory through Zotero's file
  API, with a platform URL fallback when the API is unavailable.
- `设置` is a plugin-owned modal for the current preferences: Markdown open
  interception, frontmatter generation, editor font size, and standalone-note
  shortcut. Values persist through `Zotero.Prefs`; a button opens Zotero's
  native preferences as a secondary path.
- Existing `导入外链图片` remains a separate action. It downloads remote image
  references into the note's `assets/` directory and rewrites them to local
  relative references for offline use.

## Architecture

Create `src/modules/markdown/modal.ts` with a small controller that mounts one
modal root per tab document, renders a typed view model, traps close behavior,
and exposes callbacks for the four actions. `tab.ts` owns session-specific
data, Zotero item operations, and menu dispatch; it does not own modal markup.
Modal CSS is added to `styles.ts` and uses existing theme tokens so light/dark
mode follows the editor.

The controller closes on Escape, backdrop click, close button, and successful
submit. It focuses the first control on open and returns focus to the kebab
button on close. All actions show an inline error state in the modal rather
than silently failing.

## Data and platform behavior

- File metadata is read from the current `Zotero.Item`, its attachment path,
  and `IOUtils.stat`/available Zotero file helpers. Dates are formatted with
  the main window locale; unavailable values render as `—`.
- Rename uses the attachment's supported rename method when available and
  falls back to `Zotero.Attachments.renameAttachmentFile`. The extension is
  never removed or duplicated.
- Reveal prefers Zotero's file reveal helper. A `file://` URL to the parent
  directory is the fallback only when no helper exists.
- Settings use the existing preference keys and defaults; no new preference
  keys are introduced by this feature.

## Accessibility and visual behavior

- Modal uses `role="dialog"`, `aria-modal="true"`, a visible title, and
  labelled inputs.
- The dialog is centered with a constrained width, a dimmed backdrop, and
  compact rows matching the existing Zotero Markdown surfaces.
- Buttons use the existing icon system and support keyboard focus states.

## Testing

- Unit-test modal view-model formatting and rename filename normalization.
- Unit-test settings read/write mapping and menu actions opening the correct
  modal kind.
- Run the existing full unit suite, build, Prettier, and ESLint checks.
