# Markdown Sidebar Focus Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a directly selected Markdown attachment fill the Zotero item pane like the native Note editor, without patching Zotero's private deck implementation.

**Architecture:** Keep `Zotero.ItemPaneManager.registerSection()` as the lifecycle owner. Add a reversible focus-mode controller that scopes layout changes to the current `item-details` scroll container, lets the Markdown section fill the available height, and restores normal section behavior for non-Markdown selections.

**Tech Stack:** TypeScript, Zotero ItemPaneManager, DOM/CSS, Node test runner.

## Global Constraints

- Do not patch `item-pane` prototypes or add a private deck mode.
- Enter focus mode only for a directly selected Markdown attachment.
- Preserve the existing parent-item attachment-list section behavior.
- The iframe remains the only editor scroll container.
- Remove the sidebar-only New, Live/Source, and Trash toolbar.

---

### Task 1: Focus State Planning

**Files:**

- Modify: `src/modules/markdown/sidebar-state.ts`
- Test: `test/markdown-sidebar.test.ts`

**Interfaces:**

- Produces: `shouldUseSidebarFocusMode(itemIsMarkdownAttachment: boolean): boolean`

- [ ] Add failing tests for direct Markdown attachments and ordinary parent items.
- [ ] Run `pnpm exec tsx --test test/markdown-sidebar.test.ts` and confirm the new test fails.
- [ ] Implement the minimal focus-state helper.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Reversible Focus Layout

**Files:**

- Modify: `src/modules/markdown/sidebar.ts`
- Modify: `src/modules/markdown/styles.ts`
- Test: `test/markdown-sidebar.test.ts`

**Interfaces:**

- Consumes: `shouldUseSidebarFocusMode(...)`
- Produces: scoped `zmd-sidebar-focus-mode` state on Zotero's item-details scroll container.

- [ ] Add failing source-contract tests for toolbar removal and fill-height focus CSS.
- [ ] Run the focused test and confirm the failures identify the old toolbar and clamped height.
- [ ] Remove the sidebar toolbar and its event handlers.
- [ ] Enter focus mode for direct Markdown attachments, expand the item pane, reset outer scrolling, and restore normal mode otherwise.
- [ ] Add scoped CSS that hides sibling sections, disables outer scrolling, and makes the section, body, root, host, wrapper, and iframe fill the pane.
- [ ] Re-run the focused test and confirm it passes.

### Task 3: Verification

**Files:**

- Verify: all modified files

- [ ] Run unit tests, build, ESLint, Prettier, and `git diff --check`.
- [ ] Run Zotero and inspect direct Markdown attachment selection, non-Markdown restoration, pane expansion, and editor scrolling.
