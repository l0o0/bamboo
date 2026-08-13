# Markdown Images Implementation Plan

**Goal:** Store pasted or selected images beside a stored Markdown attachment,
insert portable `assets/...` references, and render them in Live and Preview.

**Architecture:** Pure helpers own MIME, size, path and Markdown-reference
validation. A Zotero-facing service owns storage IO and data URL resolution. The
parent tab coordinates insertion and the required main-document save, while the
iframe only reports clipboard image bytes and renders resolved data URLs.

## Tasks

1. Add pure image-model tests for supported MIME types, the 15 MB limit,
   generated safe names, reference parsing, traversal rejection and data URLs.
2. Implement `MarkdownImageService` for stored text attachments, writing to the
   attachment storage directory and resolving existing assets for display.
3. Extend the iframe protocol for pasted image bytes and parent-provided display
   assets; connect the toolbar file picker and force the Markdown save after an
   asset reference is inserted.
4. Hydrate Preview `<img>` elements from parent-side IO and add Live image
   widgets that reveal source on the active line and show a missing placeholder.
5. Add UI styling, update design documentation, run unit tests/build, and record
   the Zotero/WebDAV two-client probe as required manual verification.

## Fixed Decisions

- New references use `assets/<generated-name>` relative paths.
- Supported formats: PNG, JPEG, GIF and WebP. SVG is rejected in this phase.
- Maximum size is 15 MB per image.
- Orphan cleanup is manual/future work; deleting Markdown text does not delete
  an asset automatically.
- Linked-file Markdown attachments cannot import local images.
