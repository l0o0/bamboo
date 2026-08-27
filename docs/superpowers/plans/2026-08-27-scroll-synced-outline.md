# Scroll-Synced Markdown Outline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Markdown outline follow the top visible section while scrolling in Live, Source, and Preview modes.

**Architecture:** Keep outline extraction unchanged and derive the active heading from a mode-specific scroll position. CodeMirror publishes the heading for `view.viewport.from`; Preview derives it from rendered heading geometry; the existing session and outline sidebar consume the same active ID.

**Tech Stack:** TypeScript 6, CodeMirror 6, DOM APIs, Node test runner via `tsx`, pnpm.

## Global Constraints

- Scroll position, not selection position, owns the active outline item.
- Pure scrolling must not reparse the Markdown syntax tree.
- Scroll work is coalesced with `requestAnimationFrame` and messages are sent only when the active ID changes.
- The first heading is active before the scroll baseline crosses it; a document without headings has no active item.
- Live, Source, and Preview use the same session outline state in tabs and standalone windows.
- Hidden or collapsed outlines update state without scrolling their own list.

---

### Task 1: Pure Scroll-to-Heading Calculations

**Files:**

- Modify: `src/editor/outline.ts`
- Modify: `src/modules/markdown/preview.ts`
- Test: `test/editor-outline.test.ts`
- Test: `test/preview-document.test.ts`

**Interfaces:**

- Produces: `activeOutlineID(items, position, { firstBeforeStart?: boolean }): string | null`
- Produces: `activePreviewOutlineID(headings, baselineTop): string | null`

- [ ] **Step 1: Write failing tests**

Add cases proving that a position before the first heading selects the first heading when scroll semantics are requested, positions between headings select the preceding heading, no headings return `null`, and Preview geometry selects the last heading at or above the baseline with a first-heading fallback.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec tsx --test test/editor-outline.test.ts test/preview-document.test.ts`

Expected: FAIL because the scroll option and Preview geometry helper do not exist.

- [ ] **Step 3: Implement the pure helpers**

Extend `activeOutlineID()` without changing its existing default behavior, and add a Preview helper that accepts lightweight `{ id, top }` values so it is testable without a browser DOM.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec tsx --test test/editor-outline.test.ts test/preview-document.test.ts`

Expected: PASS.

### Task 2: CodeMirror Viewport-Driven Active Outline

**Files:**

- Modify: `src/editor/bootstrap.ts`
- Test: `test/editor-outline-bridge.test.ts`

**Interfaces:**

- Consumes: `activeOutlineID(items, view.viewport.from, { firstBeforeStart: true })`
- Produces: one channel-scoped `outlineActive` message when the viewport crosses a heading.

- [ ] **Step 1: Write a failing bridge test**

Assert the update listener responds to `viewportChanged`, schedules work with `requestAnimationFrame`, reads `view.viewport.from`, and does not use `selection.main.head` for active-outline publication.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec tsx --test test/editor-outline-bridge.test.ts`

Expected: FAIL because active publication is selection-driven.

- [ ] **Step 3: Implement viewport scheduling**

Add one runtime animation-frame handle, schedule viewport publication on `viewportChanged`, recompute after `publishOutline()`, and cancel the frame during editor teardown. Preserve the existing active-ID equality guard.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec tsx --test test/editor-outline-bridge.test.ts test/editor-outline.test.ts`

Expected: PASS.

### Task 3: Preview Scroll Tracking and Outline Visibility

**Files:**

- Modify: `src/modules/markdown/session-registry.ts`
- Modify: `src/modules/markdown/tab.ts`
- Modify: `src/modules/markdown/outline-sidebar.ts`
- Test: `test/preview-document.test.ts`
- Test: `test/markdown-outline-sidebar.test.ts`

**Interfaces:**

- Consumes: `activePreviewOutlineID()` and rendered `[data-zmd-outline-id]` headings.
- Produces: session-owned Preview scroll cleanup and animation-frame cleanup.
- Produces: `OutlineSidebarHandle.setActive()` that keeps a newly active visible item in view with `block: "nearest"` only when the outline itself is visible.

- [ ] **Step 1: Write failing Preview and sidebar tests**

Assert that Preview mounts a scroll listener, coalesces updates with `requestAnimationFrame`, updates `outlineActiveID`, cleans listeners/frames, and that the sidebar calls `scrollIntoView({ block: "nearest" })` only for a visible outline.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec tsx --test test/preview-document.test.ts test/markdown-outline-sidebar.test.ts`

Expected: FAIL because Preview does not track scroll and the sidebar does not reveal the active item.

- [ ] **Step 3: Implement Preview lifecycle tracking**

Bind tracking after Preview HTML is mounted, calculate heading tops relative to the Preview scroll container, update only on ID change, and store one cleanup callback on `OpenSession`. Clear it before rerender, mode exit, and session destruction.

- [ ] **Step 4: Implement minimal sidebar reveal behavior**

After syncing active classes, reveal the active button only when expanded, not auto-hidden, connected, and outside the list viewport. Use `scrollIntoView({ block: "nearest" })`.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm exec tsx --test test/preview-document.test.ts test/markdown-outline-sidebar.test.ts test/editor-outline-bridge.test.ts`

Expected: PASS.

### Task 4: Integration Verification

**Files:**

- Modify: `package.json` only if a newly created test file must be added to `test:unit`.

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test:unit`

Expected: all tests pass.

- [ ] **Step 2: Run build and static checks**

Run: `pnpm build && pnpm lint:check && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Review the diff against the design**

Confirm all three modes are covered, tab and standalone window share the path, pure scrolling does not extract the outline, inactive sessions are cleaned up, and pre-existing standalone-window changes remain intact.
