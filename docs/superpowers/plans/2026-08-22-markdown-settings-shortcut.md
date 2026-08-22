# Markdown Settings and Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the custom Markdown modal the only settings editor and replace raw shortcut strings with a cross-platform shortcut recorder and keycap display.

**Architecture:** A pure `shortcut.ts` module translates between Toolkit strings, keyboard events, and display keycaps. The existing modal owns recording state, while a shared settings opener allows both Markdown tabs and the Zotero preference pane to open the same UI. Saving preferences refreshes the existing `ztoolkit.Keyboard` callback immediately.

**Tech Stack:** TypeScript, Zotero Plugin Toolkit KeyboardManager, Zotero preference panes, DOM/CSS, Node test runner.

## Global Constraints

- The stored shortcut format remains Toolkit-compatible, such as `accel,shift,M`.
- The raw stored string is hidden during normal use.
- Empty shortcuts disable the global binding.
- Modifier-only key presses do not finish recording.
- `Escape` cancels recording; `Backspace` and `Delete` clear the shortcut.
- The default shortcut is exactly `accel,shift,M`.
- The custom modal is the only editable settings surface.
- The Zotero preference pane contains only the title, settings-entry button, and build information.
- No new runtime dependency is introduced.

---

### Task 1: Shortcut Serialization and Display

**Files:**

- Create: `src/modules/markdown/shortcut.ts`
- Create: `test/markdown-shortcut.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `DEFAULT_NEW_MARKDOWN_SHORTCUT: string`
- Produces: `shortcutKeycaps(raw: string, platform?: string): string[]`
- Produces: `shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, ...>, platform?: string): string | null`
- Produces: `isShortcutModifierKey(key: string): boolean`

- [ ] **Step 1: Write failing tests for platform keycaps and event serialization**

Cover `accel,shift,M` as `⌘ ⇧ M` on macOS and `Ctrl Shift M` elsewhere, an empty value as no keycaps, modifier-only events as `null`, and `Ctrl+Shift+N` serialization as `accel,shift,N`.

- [ ] **Step 2: Run the focused test and verify missing-module failure**

Run: `pnpm exec tsx --test test/markdown-shortcut.test.ts`

Expected: FAIL because `shortcut.ts` does not exist.

- [ ] **Step 3: Implement normalized parsing and keyboard serialization**

Use a token map for `accel`, `shift`, `alt`, `control`, and `meta`. Normalize the final key to uppercase, ignore bare modifier keys, and map the platform accelerator to `metaKey` on macOS or `ctrlKey` elsewhere.

- [ ] **Step 4: Add the focused test to `test:unit` and verify it passes**

Run: `pnpm exec tsx --test test/markdown-shortcut.test.ts`

Expected: all shortcut tests PASS.

- [ ] **Step 5: Commit the pure shortcut module**

```bash
git add src/modules/markdown/shortcut.ts test/markdown-shortcut.test.ts package.json
git commit -m "feat(markdown): add shortcut recording model"
```

### Task 2: Keycap Recorder in the Custom Modal

**Files:**

- Modify: `src/modules/markdown/modal.ts`
- Modify: `src/modules/markdown/styles.ts`
- Modify: `test/markdown-modal.test.ts`

**Interfaces:**

- Consumes: `DEFAULT_NEW_MARKDOWN_SHORTCUT`, `shortcutKeycaps`, `shortcutFromKeyboardEvent`
- Produces: `SettingsModalData.shortcutNewStandaloneMd` with the pending recorded value

- [ ] **Step 1: Write failing modal structure and CSS tests**

Assert that the modal has a shortcut recording control, keycap elements, Edit, Clear, and Restore Default actions, and no `native-settings` action or `打开 Zotero 设置` text.

- [ ] **Step 2: Run the modal test and verify failure**

Run: `pnpm exec tsx --test test/markdown-modal.test.ts`

Expected: FAIL on the missing recorder controls and obsolete native-settings action.

- [ ] **Step 3: Implement recording state and keyboard behavior**

Render keycaps from the pending value. Edit focuses a recording surface; a valid combination updates pending state; Escape restores the pre-recording value; Delete or Backspace clears it; Restore Default uses `DEFAULT_NEW_MARKDOWN_SHORTCUT`. Saving reads pending state instead of a raw text input.

- [ ] **Step 4: Implement restrained keycap and recorder styling**

Use existing modal tokens, one-pixel keycap borders, 4px radii, compact system text, existing focus blue, and dark-mode-compatible surfaces. Keep font size in an inline row with the number input on the right.

- [ ] **Step 5: Run focused modal and shortcut tests**

Run: `pnpm exec tsx --test test/markdown-modal.test.ts test/markdown-shortcut.test.ts`

Expected: all tests PASS.

- [ ] **Step 6: Commit the recorder UI**

```bash
git add src/modules/markdown/modal.ts src/modules/markdown/styles.ts test/markdown-modal.test.ts
git commit -m "feat(markdown): add shortcut recorder settings"
```

### Task 3: Shared Settings Opener and Preference Entry

**Files:**

- Create: `src/modules/markdown/settings.ts`
- Modify: `src/modules/markdown/tab.ts`
- Modify: `src/hooks.ts`
- Modify: `addon/content/preferences.xhtml`
- Modify: `addon/locale/en-US/preferences.ftl`
- Modify: `addon/locale/zh-CN/preferences.ftl`
- Create: `test/markdown-settings-entry.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `openMarkdownSettings(win?: _ZoteroTypes.MainWindow): void`
- Produces: `bindMarkdownSettingsPreferencePane(doc: Document): () => void`
- Consumes: existing modal controller and `applySettings`

- [ ] **Step 1: Write failing tests for the preference pane contract**

Assert that `preferences.xhtml` contains a single open-settings button and no preference-bound checkbox, font-size input, or shortcut input. Assert that the custom modal source no longer opens Zotero preferences.

- [ ] **Step 2: Run the focused entry test and verify failure**

Run: `pnpm exec tsx --test test/markdown-settings-entry.test.ts`

Expected: FAIL because the preference pane still duplicates all controls.

- [ ] **Step 3: Extract a shared settings opener**

Create a controller mounted in the active main window's document, open the settings modal, apply settings on Save, refresh shortcuts, and destroy the temporary controller when closed. Reuse this opener from the tab's Settings menu action where practical without changing document-specific modals.

- [ ] **Step 4: Reduce the Zotero preference pane to one entry button**

Keep `Zotero Markdown`, add localized `Open Markdown Settings`, retain build information, and bind the button in `onPrefsEvent("load")` to the shared opener using the active Zotero main window.

- [ ] **Step 5: Verify focused settings-entry tests**

Run: `pnpm exec tsx --test test/markdown-settings-entry.test.ts test/markdown-modal.test.ts`

Expected: all tests PASS.

- [ ] **Step 6: Commit the unified settings entry**

```bash
git add src/modules/markdown/settings.ts src/modules/markdown/tab.ts src/hooks.ts addon/content/preferences.xhtml addon/locale/en-US/preferences.ftl addon/locale/zh-CN/preferences.ftl test/markdown-settings-entry.test.ts package.json
git commit -m "feat(markdown): unify settings entry points"
```

### Task 4: Shortcut Binding and Full Verification

**Files:**

- Modify: `src/modules/markdown/menu.ts`
- Modify: `test/markdown-shortcut.test.ts`

**Interfaces:**

- Consumes: `DEFAULT_NEW_MARKDOWN_SHORTCUT`
- Behavior: empty preference values register a callback that never matches; non-empty values rebind immediately after Save

- [ ] **Step 1: Add failing coverage for empty and default bindings**

Assert that the shortcut matching helper rejects an empty shortcut and that the menu uses `DEFAULT_NEW_MARKDOWN_SHORTCUT` only when the preference is absent, not when the user deliberately clears it.

- [ ] **Step 2: Run shortcut tests and verify failure**

Run: `pnpm exec tsx --test test/markdown-shortcut.test.ts`

Expected: FAIL because the current `||` fallback replaces an intentionally empty value.

- [ ] **Step 3: Preserve explicit empty preferences in keyboard registration**

Use nullish fallback semantics and skip equality checks when the configured value is empty. Keep `registerShortcuts()` idempotent by unregistering the previous callback before registering the replacement.

- [ ] **Step 4: Run all verification commands**

```bash
pnpm test:unit
pnpm exec tsc --noEmit
pnpm build
pnpm exec prettier --check src/modules/markdown/shortcut.ts src/modules/markdown/modal.ts src/modules/markdown/styles.ts src/modules/markdown/settings.ts src/modules/markdown/tab.ts src/modules/markdown/menu.ts src/hooks.ts test/markdown-shortcut.test.ts test/markdown-modal.test.ts test/markdown-settings-entry.test.ts
git diff --check
```

Expected: 0 failures and a successful production build.

- [ ] **Step 5: Commit the binding fix and verification updates**

```bash
git add src/modules/markdown/menu.ts test/markdown-shortcut.test.ts
git commit -m "fix(markdown): honor cleared global shortcut"
```
