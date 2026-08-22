# Markdown Tab Modal Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable centered modal dialogs to Markdown tabs for document information, renaming, file reveal, and plugin settings.

**Architecture:** Add a focused `modal.ts` module for modal DOM, view models, focus/close behavior, and settings mapping. Keep Zotero item operations and session dispatch in `tab.ts`; add CSS tokens and modal surface rules to `styles.ts`. Unit tests cover pure formatting, preference mapping, filename normalization, and menu routing.

**Tech Stack:** TypeScript, DOM APIs, Zotero item/file APIs, Node test runner with `tsx`, existing theme tokens and icon helpers.

## Global Constraints

- Keep the modal inside the existing Markdown tab document; do not create a second Zotero window.
- Preserve `.md` when renaming and do not rewrite frontmatter title.
- Reuse existing preference keys: `enable`, `frontmatter`, `fontSize`, `shortcutNewStandaloneMd`.
- Use existing light/dark theme tokens and icon system.
- All modal actions must have keyboard and Escape-close behavior.

### Task 1: Modal view models and pure helpers

**Files:**
- Create: `src/modules/markdown/modal.ts`
- Create: `test/markdown-modal.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produce `ModalKind`, `DocumentModalData`, `SettingsModalData`, `normalizeMarkdownFilename`, `formatModalBytes`, `formatModalDate`, and `settingsFromPrefs`/`prefsFromSettings`.
- Produce `createMarkdownModalController(document, options)` with `open(kind, payload)`, `close()`, and `destroy()`.

- [ ] Write failing tests for filename normalization, byte/date formatting, settings mapping, and modal kind title selection.
- [ ] Run `pnpm exec tsx --test test/markdown-modal.test.ts`; expect missing-export failures.
- [ ] Implement pure helpers and a typed modal controller with dialog semantics, close callbacks, and focus restoration.
- [ ] Run the focused test; expect all new tests to pass.
- [ ] Commit `feat(markdown): add reusable tab modal controller`.

### Task 2: Modal presentation and settings form

**Files:**
- Modify: `src/modules/markdown/modal.ts`
- Modify: `src/modules/markdown/styles.ts`
- Modify: `test/markdown-modal.test.ts`

**Interfaces:**
- Modal controller renders document info rows, rename input/form, reveal action, and settings controls.
- Settings submit returns the four existing preference values through a callback; native preferences action is a separate callback.

- [ ] Add failing DOM assertions for `role="dialog"`, document metadata rows, rename input, settings controls, backdrop/Escape close, and focus restoration.
- [ ] Run focused modal tests and verify the new assertions fail before implementation.
- [ ] Implement the modal DOM and CSS, including compact centered surface, backdrop, responsive width, error message, and button states.
- [ ] Run focused modal tests and verify they pass.
- [ ] Commit `feat(markdown): render modal action surfaces`.

### Task 3: Session actions and menu integration

**Files:**
- Modify: `src/modules/markdown/tab.ts`
- Modify: `src/modules/markdown/session-registry.ts`
- Modify: `src/hooks.ts`
- Modify: `test/more-menu.test.ts`
- Modify: `test/markdown-modal.test.ts`

**Interfaces:**
- `tab.ts` builds document metadata from the current attachment and source, handles rename/reveal/settings callbacks, and opens the modal for `document-info`, `rename`, and `settings`.
- Reveal prefers Zotero file helpers and uses the directory URL fallback.
- Native preference registration exposes the same settings entry point without duplicating the settings UI.

- [ ] Add failing routing tests for the three modal actions and settings preference persistence.
- [ ] Run focused tests and confirm failures.
- [ ] Implement session modal mounting, action callbacks, item rename/tab title sync, reveal behavior, and native preference button wiring.
- [ ] Run focused tests and confirm pass.
- [ ] Commit `feat(markdown): connect tab menu modal actions`.

### Task 4: Full verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `doc/README-zhCN.md`

- [ ] Document the kebab menu modal actions and external-image import behavior in English and Chinese.
- [ ] Run `pnpm test:unit` and confirm all tests pass.
- [ ] Run `pnpm build` and confirm XPI generation succeeds.
- [ ] Run targeted Prettier and ESLint checks plus `git diff --check`.
- [ ] Commit `docs(markdown): document tab modal actions`.
