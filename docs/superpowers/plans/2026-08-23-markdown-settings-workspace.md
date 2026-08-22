# Markdown Settings Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the compact settings form with a responsive four-page settings workspace and make the editor's Settings menu item a direct command without a chevron.

**Architecture:** The existing modal controller retains lifecycle and persistence ownership. A small settings-page model defines stable page IDs and labels; the settings renderer keeps one pending `SettingsModalData` value while switching page DOM. Document-info and rename modals continue to use their compact geometry.

**Tech Stack:** TypeScript, Zotero DOM APIs, existing Markdown modal CSS tokens, Node test runner.

## Global Constraints

- The settings pages are exactly General, Editor, Shortcuts, and About.
- The desktop layout uses a left navigation rail and right content region.
- Below 560px, navigation becomes a horizontal row.
- Page switches preserve pending values and do not save.
- Done saves once and closes; close, backdrop, and Escape discard pending values.
- Shortcut storage remains Toolkit-compatible and current recording behavior is preserved.
- The Settings more-menu item is a direct command with no submenu indicator.
- Document information and rename dialogs retain compact geometry.
- No runtime dependency is added.

---

### Task 1: Settings Menu Semantics

**Files:**

- Modify: `src/modules/markdown/more-menu.ts`
- Modify: `test/more-menu.test.ts`

**Interfaces:**

- Consumes: `MORE_MENU_SECTIONS`
- Produces: a `settings` item with `submenu` omitted

- [ ] **Step 1: Write a failing test**

Add an assertion that the settings item exists and `settings?.submenu` is not true.

- [ ] **Step 2: Verify the test fails**

Run: `pnpm exec tsx --test test/more-menu.test.ts`

Expected: FAIL because Settings currently has `submenu: true`.

- [ ] **Step 3: Remove the submenu flag**

Change the Settings menu declaration to `{ action: "settings", label: "设置" }` while retaining Mode as the only submenu item.

- [ ] **Step 4: Verify the test passes**

Run: `pnpm exec tsx --test test/more-menu.test.ts`

Expected: all more-menu tests PASS.

### Task 2: Four-Page Settings Model

**Files:**

- Create: `src/modules/markdown/settings-pages.ts`
- Create: `test/markdown-settings-pages.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `SettingsPageID = "general" | "editor" | "shortcuts" | "about"`
- Produces: `SETTINGS_PAGES: readonly SettingsPage[]`
- Produces: `nextSettingsPage(current, direction): SettingsPageID`

- [ ] **Step 1: Write failing model tests**

Test exact page order, Chinese labels, and wrapping previous/next keyboard navigation.

- [ ] **Step 2: Verify missing-module failure**

Run: `pnpm exec tsx --test test/markdown-settings-pages.test.ts`

Expected: FAIL because `settings-pages.ts` does not exist.

- [ ] **Step 3: Implement the immutable page model**

Define the four page records and a navigation helper that wraps at either end without DOM dependencies.

- [ ] **Step 4: Register and run the test**

Add the test file to `test:unit`, then run `pnpm exec tsx --test test/markdown-settings-pages.test.ts`.

Expected: all page-model tests PASS.

### Task 3: Workspace Modal Structure

**Files:**

- Modify: `src/modules/markdown/modal.ts`
- Modify: `test/markdown-modal.test.ts`

**Interfaces:**

- Consumes: `SETTINGS_PAGES`, `nextSettingsPage`
- Extends: `SettingsModalData` rendering without changing its persistence shape
- Consumes optional about metadata passed through `MarkdownModalOptions`

- [ ] **Step 1: Write failing source-contract tests**

Assert that settings uses a dedicated workspace class, renders all four page buttons, uses `aria-selected`, includes a Done button, and no longer renders the inline Clear and Restore Default shortcut buttons.

- [ ] **Step 2: Verify the modal test fails**

Run: `pnpm exec tsx --test test/markdown-modal.test.ts`

Expected: FAIL on missing workspace navigation and obsolete shortcut actions.

- [ ] **Step 3: Implement shared pending state and page navigation**

Create one settings shell per open, render navigation and content regions, update the pending settings object on control changes, and switch pages without replacing pending values. Implement ArrowUp/ArrowDown and ArrowLeft/ArrowRight navigation with selected-state synchronization.

- [ ] **Step 4: Implement the four page renderers**

General renders both checkboxes; Editor renders the font-size row; Shortcuts reuses keycap recording and moves Clear/Restore Default into a compact overflow menu; About renders plugin name, version, and build time from modal options.

- [ ] **Step 5: Preserve close and save semantics**

Done passes the complete pending object once through `onSettings`; other close paths never invoke it. Move focus to the active page heading after a navigation action.

- [ ] **Step 6: Run focused tests and type checking**

Run: `pnpm exec tsx --test test/markdown-modal.test.ts test/markdown-settings-pages.test.ts && pnpm exec tsc --noEmit`

Expected: tests and TypeScript PASS.

### Task 4: Workspace Visual System

**Files:**

- Modify: `src/modules/markdown/styles.ts`
- Modify: `test/markdown-modal.test.ts`

**Interfaces:**

- Produces desktop rail selectors under `.zotero-markdown-modal.is-settings`
- Produces narrow-layout rules at `@media (max-width: 560px)`

- [ ] **Step 1: Add failing CSS contract tests**

Assert the settings modal has a wider bounded width, a 188px navigation rail, flexible content, active navigation styling, footer anchoring, shortcut overflow styling, and the 560px responsive rule.

- [ ] **Step 2: Verify CSS tests fail**

Run: `pnpm exec tsx --test test/markdown-modal.test.ts`

Expected: FAIL on the missing workspace selectors.

- [ ] **Step 3: Implement desktop and dark-theme-compatible styles**

Use existing surface and border tokens, 8px modal radius, stable row heights, restrained active navigation, and a bottom-aligned footer. Keep document-info and rename widths unchanged by scoping width changes to `.is-settings`.

- [ ] **Step 4: Implement narrow layout**

At 560px and below, change the workspace to one column, make navigation horizontal and scrollable, reduce content insets to 16px, and allow setting rows to wrap without overlap.

- [ ] **Step 5: Run modal tests**

Run: `pnpm exec tsx --test test/markdown-modal.test.ts`

Expected: all modal tests PASS.

### Task 5: Metadata and Full Verification

**Files:**

- Modify: `src/modules/markdown/settings.ts`
- Modify: `src/modules/markdown/tab.ts`
- Modify: `test/markdown-settings-entry.test.ts`

**Interfaces:**

- Supplies: `about: { name: string; version: string; buildTime: string }`
- Preserves: `saveMarkdownSettings(settings): Promise<void>`

- [ ] **Step 1: Write failing metadata wiring tests**

Assert that both the temporary settings opener and tab modal pass add-on name, version, and build-time values into the modal options.

- [ ] **Step 2: Verify the focused test fails**

Run: `pnpm exec tsx --test test/markdown-settings-entry.test.ts`

Expected: FAIL because modal options do not yet include about metadata.

- [ ] **Step 3: Wire metadata into both settings entry points**

Read values from `addon.data.config` and pass them through `MarkdownModalOptions`. Do not add network access or update checks.

- [ ] **Step 4: Run complete verification**

```bash
pnpm test:unit
pnpm exec tsc --noEmit
pnpm build
pnpm exec eslint .
pnpm exec prettier --check src/modules/markdown/more-menu.ts src/modules/markdown/settings-pages.ts src/modules/markdown/modal.ts src/modules/markdown/styles.ts src/modules/markdown/settings.ts src/modules/markdown/tab.ts test/more-menu.test.ts test/markdown-settings-pages.test.ts test/markdown-modal.test.ts test/markdown-settings-entry.test.ts package.json
git diff --check
```

Expected: zero failures and a successful production build.

- [ ] **Step 5: Commit the implementation**

```bash
git add src/modules/markdown/more-menu.ts src/modules/markdown/settings-pages.ts src/modules/markdown/modal.ts src/modules/markdown/styles.ts src/modules/markdown/settings.ts src/modules/markdown/tab.ts test/more-menu.test.ts test/markdown-settings-pages.test.ts test/markdown-modal.test.ts test/markdown-settings-entry.test.ts package.json
git commit -m "feat(markdown): redesign settings workspace"
```
