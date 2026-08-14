# Editor Width Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Live text, rendered table borders, and toolbar controls to the same `48rem` reading column with `34px` left and `30px` right insets.

**Architecture:** Keep CodeMirror's centered `48rem` outer column unchanged. Move table geometry inside the existing line insets, and expose the toolbar alignment CSS through a small testable helper so the Zotero parent toolbar follows the same responsive boundaries.

**Tech Stack:** TypeScript, CodeMirror 6 themes, injected CSS, Node test runner.

## Global Constraints

- Live outer reading column remains `48rem`.
- Shared horizontal insets remain `34px` left and `30px` right.
- Toolbar usable track is `44rem`, centered within the asymmetric outer insets.
- Narrow panes shrink without horizontal overflow.
- Source mode geometry is unchanged.

---

### Task 1: Align Live table and toolbar geometry

**Files:**

- Modify: `src/editor/theme.ts`
- Modify: `src/modules/markdown/styles.ts`
- Modify: `test/editor-theme.test.ts`
- Modify: `test/markdown-toolbar.test.ts`
- Modify: `DESIGN.md`

**Interfaces:**

- Produces: `toolbarWidthAlignmentCSS(): string` for the injected Zotero toolbar stylesheet.
- Extends: `liveEditorGeometry()` with stable table margin and padding values.

- [x] **Step 1: Add failing geometry tests**

Update `test/editor-theme.test.ts` to expect:

```ts
assert.deepEqual(liveEditorGeometry(), {
  contentPadding: "20px 0 40px",
  linePadding: "0 30px 0 34px",
  tableMargin: "0 30px 0 34px",
  tablePadding: "0",
});
```

Update `test/markdown-toolbar.test.ts` to import `toolbarWidthAlignmentCSS` and assert:

```ts
const css = toolbarWidthAlignmentCSS();
assert.match(css, /padding: 4px 30px 4px 34px/);
assert.match(css, /max-width: 44rem/);
```

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm exec tsx --test test/editor-theme.test.ts test/markdown-toolbar.test.ts
```

Expected: the theme object lacks table geometry and `toolbarWidthAlignmentCSS` is not exported.

- [x] **Step 3: Implement aligned table geometry**

Extend `liveEditorGeometry()` in `src/editor/theme.ts`:

```ts
export function liveEditorGeometry() {
  return {
    contentPadding: "20px 0 40px",
    linePadding: "0 30px 0 34px",
    tableMargin: "0 30px 0 34px",
    tablePadding: "0",
  } as const;
}
```

Consume these values in `.cm-line.zmd-lp-table-row`:

```ts
margin: liveGeometry.tableMargin,
padding: liveGeometry.tablePadding,
boxSizing: "border-box",
```

This overrides the general Live line padding only for table rows and uses horizontal margins to keep CodeMirror line height and vertical hit testing unchanged.

- [x] **Step 4: Implement aligned toolbar geometry**

Add to `src/modules/markdown/styles.ts`:

```ts
export function toolbarWidthAlignmentCSS(): string {
  return `
.zotero-markdown-toolbar {
  padding: 4px 30px 4px 34px;
}

.zotero-markdown-toolbar-inner {
  max-width: 44rem;
}`;
}
```

Interpolate `toolbarWidthAlignmentCSS()` after the base toolbar rules so it replaces the previous `4px 28px` and `64rem` values without changing toolbar controls or responsive icon sizing.

- [x] **Step 5: Update the persistent design rule**

In `DESIGN.md`, replace the previous toolbar `64rem` exception with the shared rule:

```md
The toolbar follows the Live Preview text boundaries: a `44rem` usable track inside the centered `48rem` reading column, with `34px` left and `30px` right insets.
```

- [x] **Step 6: Verify implementation**

Run:

```bash
pnpm exec prettier --check src/editor/theme.ts src/modules/markdown/styles.ts test/editor-theme.test.ts test/markdown-toolbar.test.ts DESIGN.md
pnpm exec eslint src/editor/theme.ts src/modules/markdown/styles.ts test/editor-theme.test.ts test/markdown-toolbar.test.ts
pnpm test:unit
pnpm build
git diff --check
```

Expected: all checks pass, all unit tests pass, and the production plugin build completes.

- [x] **Step 7: Commit**

```bash
git add src/editor/theme.ts src/modules/markdown/styles.ts test/editor-theme.test.ts test/markdown-toolbar.test.ts DESIGN.md docs/superpowers/plans/2026-08-15-editor-width-alignment.md
git commit -m "fix(markdown): align editor content widths"
```
