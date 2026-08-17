# Sidebar Editor Lifecycle Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Markdown sidebar usable across Zotero item-pane refreshes and give its iframe editor a stable, visible height.

**Architecture:** Add a pure visibility planner that maps the sidebar body state and parent-list context to DOM visibility. Make `SidebarController` apply that plan whenever it reuses, creates, or replaces an editor, and extract sidebar geometry CSS into a testable helper with a clamped block size.

**Tech Stack:** TypeScript, Zotero `ItemPaneManager`, DOM APIs, CodeMirror iframe bridge, Node `node:test`, Prettier, ESLint.

## Global Constraints

- Preserve the current uncommitted sidebar, API, editor, release, and documentation work in the shared worktree.
- Do not destroy and recreate an iframe when the requested Markdown attachment is already active.
- Keep the attachment list visible beside `editor` and `hint` states only when the selected Zotero item is a regular parent item with Markdown attachments.
- Keep Live and Source modes only; do not add Preview mode.
- Use a responsive editor-host block size clamped between `320px` and `600px`.
- Do not automatically commit implementation files because several target files already contain overlapping uncommitted work.

---

### Task 1: Pure Sidebar Visibility Planning

**Files:**

- Create: `src/modules/markdown/sidebar-state.ts`
- Create: `test/markdown-sidebar.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `SidebarBodyState = "editor" | "hint" | "empty"`.
- Produces: `planSidebarVisibility(state, hasAttachmentList)` returning `{ list, editor, hint, empty }` booleans.
- Produces: `canReuseSidebarEditor(hasEditor, currentItemID, targetItemID)` returning a boolean.

- [ ] **Step 1: Write failing visibility and reuse tests**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canReuseSidebarEditor,
  planSidebarVisibility,
} from "../src/modules/markdown/sidebar-state.ts";

describe("Markdown sidebar state", () => {
  it("keeps a parent attachment list beside the editor", () => {
    assert.deepEqual(planSidebarVisibility("editor", true), {
      list: true,
      editor: true,
      hint: false,
      empty: false,
    });
  });

  it("shows only the editor for a directly selected attachment", () => {
    assert.deepEqual(planSidebarVisibility("editor", false), {
      list: false,
      editor: true,
      hint: false,
      empty: false,
    });
  });

  it("preserves a parent attachment list beside a tab-conflict hint", () => {
    assert.deepEqual(planSidebarVisibility("hint", true), {
      list: true,
      editor: false,
      hint: true,
      empty: false,
    });
  });

  it("shows only the empty state", () => {
    assert.deepEqual(planSidebarVisibility("empty", true), {
      list: false,
      editor: false,
      hint: false,
      empty: true,
    });
  });

  it("reuses only the editor for the same attachment", () => {
    assert.equal(canReuseSidebarEditor(true, 42, 42), true);
    assert.equal(canReuseSidebarEditor(true, 42, 43), false);
    assert.equal(canReuseSidebarEditor(false, 42, 42), false);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm exec tsx --test test/markdown-sidebar.test.ts`

Expected: FAIL because `src/modules/markdown/sidebar-state.ts` does not exist.

- [ ] **Step 3: Implement the pure planner**

```ts
export type SidebarBodyState = "editor" | "hint" | "empty";

export interface SidebarVisibility {
  list: boolean;
  editor: boolean;
  hint: boolean;
  empty: boolean;
}

export function planSidebarVisibility(
  state: SidebarBodyState,
  hasAttachmentList: boolean,
): SidebarVisibility {
  return {
    list: hasAttachmentList && state !== "empty",
    editor: state === "editor",
    hint: state === "hint",
    empty: state === "empty",
  };
}

export function canReuseSidebarEditor(
  hasEditor: boolean,
  currentItemID: number | null,
  targetItemID: number,
): boolean {
  return hasEditor && currentItemID === targetItemID;
}
```

- [ ] **Step 4: Add the test to the full unit-test script**

Add `test/markdown-sidebar.test.ts` to the existing `test:unit` command in `package.json` without removing the current `test/api-frontmatter-patch.test.ts` entry or any other test.

- [ ] **Step 5: Run the focused test and confirm GREEN**

Run: `pnpm exec tsx --test test/markdown-sidebar.test.ts`

Expected: 5 tests pass.

### Task 2: Idempotent Sidebar Controller Lifecycle

**Files:**

- Modify: `src/modules/markdown/sidebar.ts`
- Test: `test/markdown-sidebar.test.ts`

**Interfaces:**

- Consumes: `SidebarBodyState`, `planSidebarVisibility`, and `canReuseSidebarEditor` from Task 1.
- Produces: one `applyBodyState(state)` path for editor, hint, and empty visibility.

- [ ] **Step 1: Import the state planner**

```ts
import {
  canReuseSidebarEditor,
  planSidebarVisibility,
  type SidebarBodyState,
} from "./sidebar-state";
```

- [ ] **Step 2: Replace blanket visibility changes with one state applier**

Add these controller methods:

```ts
private hasParentAttachmentList(): boolean {
  return !!this.item && !isMarkdownAttachment(this.item) && this.attachmentIDs.length > 0;
}

private applyBodyState(state: SidebarBodyState): void {
  const visibility = planSidebarVisibility(
    state,
    this.hasParentAttachmentList(),
  );
  this.listEl.hidden = !visibility.list;
  this.editorHost.hidden = !visibility.editor;
  this.hintEl.hidden = !visibility.hint;
  this.emptyEl.hidden = !visibility.empty;
}

private showEditor(): void {
  this.applyBodyState("editor");
}
```

Make `showEmpty()` call `applyBodyState("empty")` after setting its message. Make `showHint()` call `applyBodyState("hint")` after recording the attachment item ID. Remove `hideAll()` once no callers remain.

- [ ] **Step 3: Restore the view when reusing the same editor**

Replace the current early return in `openEditor()` with:

```ts
if (canReuseSidebarEditor(!!this.editor, this.itemID, item.id)) {
  this.editor?.setReadOnly?.(!this.editable);
  this.showEditor();
  this.updateSummary();
  return;
}
```

After a new editor is loaded, replace `hideAll()` plus direct `editorHost.hidden` mutation with `showEditor()`.

- [ ] **Step 4: Preserve the list during asynchronous loading**

Keep `renderList()` responsible for building the current list and making it visible while the selected attachment is loading. The final `showEditor()` or `showHint()` call must preserve that list through `planSidebarVisibility()`.

- [ ] **Step 5: Run focused tests and TypeScript validation**

Run:

```bash
pnpm exec tsx --test test/markdown-sidebar.test.ts
pnpm exec tsc --noEmit
```

Expected: sidebar tests pass and TypeScript exits with code 0.

### Task 3: Stable Item-Pane Editor Geometry

**Files:**

- Modify: `src/modules/markdown/styles.ts`
- Modify: `test/markdown-sidebar.test.ts`

**Interfaces:**

- Produces: `sidebarEditorGeometryCSS(): string` used by `injectMarkdownStyles()` and the unit test.

- [ ] **Step 1: Write a failing geometry test**

Add:

```ts
import { sidebarEditorGeometryCSS } from "../src/modules/markdown/styles.ts";

it("gives the item-pane editor a stable responsive height", () => {
  const css = sidebarEditorGeometryCSS();
  assert.match(css, /height: auto/);
  assert.match(css, /block-size: clamp\(320px, 50vh, 600px\)/);
  assert.match(css, /min-block-size: 320px/);
  assert.doesNotMatch(css, /\.zmd-sidebar\s*\{[^}]*height: 100%/s);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm exec tsx --test test/markdown-sidebar.test.ts`

Expected: FAIL because `sidebarEditorGeometryCSS` is not exported.

- [ ] **Step 3: Extract and apply the geometry CSS**

Add near the existing toolbar CSS helpers:

```ts
export function sidebarEditorGeometryCSS(): string {
  return `
.zmd-sidebar {
  height: auto;
}

.zmd-sidebar-editor-host {
  flex: 0 0 auto;
  block-size: clamp(320px, 50vh, 600px);
  min-block-size: 320px;
  max-block-size: 600px;
}`;
}
```

Interpolate `${sidebarEditorGeometryCSS()}` in the sidebar section of the injected stylesheet. Remove the conflicting `height: 100%` from the existing `.zmd-sidebar` rule and the conflicting `flex: 1 1 auto` / `min-height: 0` declarations from `.zmd-sidebar-editor-host`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `pnpm exec tsx --test test/markdown-sidebar.test.ts`

Expected: 6 tests pass.

### Task 4: Full Verification

**Files:**

- Verify only; do not modify unrelated existing files.

**Interfaces:**

- Consumes all implementation from Tasks 1-3.
- Produces a verified worktree ready for in-Zotero testing.

- [ ] **Step 1: Format only changed sidebar files**

Run:

```bash
pnpm exec prettier --write src/modules/markdown/sidebar-state.ts src/modules/markdown/sidebar.ts src/modules/markdown/styles.ts test/markdown-sidebar.test.ts package.json
```

- [ ] **Step 2: Run the full unit suite**

Run: `pnpm test:unit`

Expected: all tests pass, including `Markdown sidebar state`.

- [ ] **Step 3: Run production build and type checking**

Run: `pnpm build`

Expected: plugin bundle builds and `tsc --noEmit` exits with code 0.

- [ ] **Step 4: Run scoped lint and repository whitespace validation**

Run:

```bash
pnpm exec eslint src/modules/markdown/sidebar-state.ts src/modules/markdown/sidebar.ts src/modules/markdown/styles.ts test/markdown-sidebar.test.ts
pnpm exec prettier --check src/modules/markdown/sidebar-state.ts src/modules/markdown/sidebar.ts src/modules/markdown/styles.ts test/markdown-sidebar.test.ts package.json
git diff --check
```

Expected: all commands exit with code 0.

- [ ] **Step 5: Report the runtime verification boundary**

State explicitly that automated verification is complete, but the currently running Zotero profile has an old disabled `0.0.1` XPI and is not loading this workspace build. Do not claim in-Zotero interaction verification until the workspace plugin is launched in an isolated development profile.
