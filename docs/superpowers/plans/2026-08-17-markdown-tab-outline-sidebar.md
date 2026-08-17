# Markdown Tab Outline Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native-style, completely collapsible H1-H6 outline to every full Markdown tab, with live updates and accurate navigation in Live, Source, and Preview modes.

**Architecture:** CodeMirror extracts headings from its Lezer Markdown syntax tree and sends channel-scoped outline messages to the Zotero parent shell. A focused parent component renders the outline and sends reveal commands back to the iframe; Preview headings receive deterministic DOM anchors. Each `OpenSession` owns its outline and expanded state so tabs remain isolated.

**Tech Stack:** TypeScript 6, CodeMirror 6, Lezer Markdown/GFM, Zotero plugin toolkit DOM APIs, Fluent localization, Node test runner, pnpm.

## Global Constraints

- Work directly on the existing `main` branch as requested; do not create a worktree.
- Preserve unrelated dirty-worktree changes and stage only files belonging to this feature.
- Apply the feature only to full Markdown tabs, not the item-pane Markdown sidebar.
- Include ATX and Setext `H1-H6`; exclude frontmatter, fenced code, and ordinary `#` text.
- Default each new tab to an expanded outline; do not add a global preference.
- Collapsing removes the sidebar completely and restores full workspace width.
- Use existing theme tokens and compact Zotero geometry; no cards, shadows, gradients, or decorative surfaces.
- Add no runtime dependency and keep every message channel-scoped.

---

## File Structure

- Create `src/editor/outline.ts` for syntax-tree extraction and navigation helpers.
- Create `src/modules/markdown/outline-sidebar.ts` for parent-side sidebar DOM and state.
- Create `test/editor-outline.test.ts`, `test/editor-outline-bridge.test.ts`, and `test/markdown-outline-sidebar.test.ts`.
- Modify `src/modules/markdown/editor-protocol.ts`, `src/editor/bootstrap.ts`, and `src/modules/markdown/editor.ts` for the iframe bridge.
- Modify `src/modules/markdown/session-registry.ts`, `src/modules/markdown/tab.ts`, `src/modules/markdown/styles.ts`, and `src/modules/markdown/icons.ts` for the Tab UI.
- Modify `src/modules/markdown/preview.ts` for Preview anchors.
- Modify both locale files and `typings/i10n.d.ts` for accessible localized copy.
- Modify `package.json` to register the focused tests.

---

### Task 1: Extract A Correct Outline From CodeMirror State

**Files:**

- Create: `src/editor/outline.ts`
- Create: `test/editor-outline.test.ts`
- Modify: `src/modules/markdown/editor-protocol.ts:15-48`
- Modify: `package.json:31`

**Interfaces:**

- Produces: `EditorOutlineItem` with `{ id, level, text, from }`.
- Produces: `extractEditorOutline(state: EditorState): EditorOutlineItem[]`.
- Produces: `activeOutlineID(items, position): string | null`.
- Produces: `clampOutlinePosition(position, docLength): number | null`.

- [ ] **Step 1: Add the shared type and write failing extraction tests**

Add to `editor-protocol.ts`:

```ts
export type EditorHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface EditorOutlineItem {
  id: string;
  level: EditorHeadingLevel;
  text: string;
  from: number;
}
```

Create `test/editor-outline.test.ts` with CodeMirror states configured using `markdown({ extensions: GFM })` and these assertions:

```ts
const source = [
  "# One",
  "Two",
  "---",
  "### **Three** and [link](https://example.com)",
  "###### Six #",
].join("\n");
assert.deepEqual(extractEditorOutline(markdownState(source)), [
  { id: "h1:0", level: 1, text: "One", from: 0 },
  {
    id: `h2:${source.indexOf("Two")}`,
    level: 2,
    text: "Two",
    from: source.indexOf("Two"),
  },
  {
    id: `h3:${source.indexOf("###")}`,
    level: 3,
    text: "Three and link",
    from: source.indexOf("###"),
  },
  {
    id: `h6:${source.indexOf("######")}`,
    level: 6,
    text: "Six",
    from: source.indexOf("######"),
  },
]);
```

Add a second document containing a frontmatter `# hidden`, fenced `# hidden`, ordinary `#` text, and one `## Visible`; assert that only `Visible` is returned. Add assertions that the nearest preceding heading is active and invalid/stale positions are clamped safely.

- [ ] **Step 2: Register and run the focused test to verify it fails**

Append `test/editor-outline.test.ts` to `test:unit`.

```bash
pnpm exec tsx --test test/editor-outline.test.ts
```

Expected: FAIL because `src/editor/outline.ts` does not exist.

- [ ] **Step 3: Implement syntax-tree extraction**

Create `src/editor/outline.ts` with this node map and frontmatter boundary:

```ts
const HEADING_LEVELS: Record<string, EditorHeadingLevel> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2,
};

function frontmatterEnd(doc: string): number {
  if (!doc.startsWith("---\n") && !doc.startsWith("---\r\n")) return 0;
  const match = /\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(doc.slice(3));
  return match ? 3 + match.index + match[0].length : 0;
}
```

Traverse `syntaxTree(state).cursor()`, accept only mapped nodes after the frontmatter boundary, and produce IDs as `h${level}:${cursor.from}`. Strip ATX/Setext markers, closing hashes, emphasis markers, and link destinations from display text. Implement `activeOutlineID()` as the last item whose `from <= position` and clamp reveal positions to `0..docLength`.

- [ ] **Step 4: Run the focused test and commit**

```bash
pnpm exec tsx --test test/editor-outline.test.ts
git add package.json src/modules/markdown/editor-protocol.ts src/editor/outline.ts test/editor-outline.test.ts
git commit -m "feat(editor): extract markdown document outline"
```

Expected: PASS and one scoped commit. If the installed grammar reports a different Setext node name, inspect `syntaxTree(state).toString()` and update only the node map.

---

### Task 2: Bridge Outline Updates And Reveal Commands

**Files:**

- Create: `test/editor-outline-bridge.test.ts`
- Modify: `src/modules/markdown/editor-protocol.ts:50-169`
- Modify: `src/editor/bootstrap.ts:80-120, 630-790, 970-1160`
- Modify: `src/modules/markdown/editor.ts:24-52, 91-390`
- Modify: `package.json:31`

**Interfaces:**

- Produces iframe messages `outline` and `outlineActive`.
- Produces parent command `revealPosition`.
- Produces callbacks `onOutline()` and `onOutlineActive()`.
- Produces `MarkdownEditorHandle.revealPosition(position)`.

- [ ] **Step 1: Write failing bridge tests**

Create `test/editor-outline-bridge.test.ts`. Verify an `outline` message is accepted only for its matching channel. Read `bootstrap.ts` and assert it contains `scheduleOutlineUpdate`, `case "revealPosition"`, `EditorView.scrollIntoView`, and `outlineTimer`. Read `editor.ts` and assert it contains both callbacks, `case "outline"`, and `revealPosition:`.

```bash
pnpm exec tsx --test test/editor-outline-bridge.test.ts
```

Expected: FAIL before the bridge exists.

- [ ] **Step 2: Extend the channel-scoped protocol**

Add to `ParentToEditorMessage`:

```ts
| {
    source: typeof EDITOR_MESSAGE_SOURCE;
    type: "revealPosition";
    payload: { position: number };
  }
```

Add to `EditorToParentMessage`:

```ts
| {
    source: typeof EDITOR_MESSAGE_SOURCE;
    type: "outline";
    payload: { items: EditorOutlineItem[]; activeID: string | null };
  }
| {
    source: typeof EDITOR_MESSAGE_SOURCE;
    type: "outlineActive";
    payload: { activeID: string | null };
  }
```

Register `revealPosition` in `PendingCommand` and `PARENT_TO_EDITOR_TYPES`.

- [ ] **Step 3: Publish debounced outline and active-heading updates**

Extend `EditorRuntime` with `outlineItems`, `outlineTimer`, and `activeOutlineID`. Add:

```ts
function publishOutline(view: EditorView) {
  runtime.outlineTimer = null;
  const items = extractEditorOutline(view.state);
  const activeID = activeOutlineID(items, view.state.selection.main.head);
  runtime.outlineItems = items;
  runtime.activeOutlineID = activeID;
  postToParent({ type: "outline", payload: { items, activeID } });
}

function scheduleOutlineUpdate(view: EditorView, immediate = false) {
  if (runtime.outlineTimer != null) window.clearTimeout(runtime.outlineTimer);
  if (immediate) return publishOutline(view);
  runtime.outlineTimer = window.setTimeout(() => publishOutline(view), 100);
}
```

Schedule immediately after editor initialization and after every document change, including parent `setValue`. On `selectionSet`, calculate the active ID from cached items and send only `outlineActive` when it changes. Clear the timer on destroy.

- [ ] **Step 4: Implement safe reveal navigation**

Add this message branch:

```ts
case "revealPosition": {
  if (!runtime.view) return;
  const position = clampOutlinePosition(
    data.payload.position,
    runtime.view.state.doc.length,
  );
  if (position == null) return;
  runtime.view.dispatch({
    selection: { anchor: position },
    effects: EditorView.scrollIntoView(position, { y: "start", yMargin: 24 }),
  });
  runtime.view.focus();
  break;
}
```

The transaction contains no document changes and must not affect undo history.

- [ ] **Step 5: Expose callbacks and navigation in `editor.ts`**

Add options:

```ts
onOutline?: (items: readonly EditorOutlineItem[], activeID: string | null) => void;
onOutlineActive?: (activeID: string | null) => void;
```

Handle `outline` and `outlineActive` in `onMessage`, and expose:

```ts
revealPosition: (position: number) => {
  sendOrQueue({
    source: EDITOR_MESSAGE_SOURCE,
    type: "revealPosition",
    payload: { position },
  });
},
```

- [ ] **Step 6: Run focused tests and commit**

```bash
pnpm exec tsx --test test/editor-outline.test.ts test/editor-outline-bridge.test.ts test/editor-channel.test.ts
git add package.json src/modules/markdown/editor-protocol.ts src/editor/bootstrap.ts src/modules/markdown/editor.ts test/editor-outline-bridge.test.ts
git commit -m "feat(editor): bridge markdown outline navigation"
```

Expected: all focused tests PASS.

---

### Task 3: Build The Native Tab Outline Sidebar

**Files:**

- Create: `src/modules/markdown/outline-sidebar.ts`
- Create: `test/markdown-outline-sidebar.test.ts`
- Modify: `src/modules/markdown/session-registry.ts:6-37`
- Modify: `src/modules/markdown/tab.ts:1-60, 267-744, 1501-1532`
- Modify: `src/modules/markdown/styles.ts:203-529`
- Modify: `src/modules/markdown/icons.ts:1-180`
- Modify: `addon/locale/en-US/mainWindow.ftl`
- Modify: `addon/locale/zh-CN/mainWindow.ftl`
- Modify: `typings/i10n.d.ts`
- Modify: `package.json:31`

**Interfaces:**

- Produces `mountOutlineSidebar(options): OutlineSidebarHandle`.
- Produces per-session items, active ID, expanded state, and cleanup handle.
- Consumes editor callbacks and `revealPosition()` from Task 2.

- [ ] **Step 1: Write failing sidebar tests**

Create `test/markdown-outline-sidebar.test.ts` and assert:

```ts
assert.equal(outlineIndentPx(1), 8);
assert.equal(outlineIndentPx(3), 32);
assert.equal(outlineIndentPx(6), 44);
assert.equal(outlineVisibleAtWidth(true, 900), true);
assert.equal(outlineVisibleAtWidth(true, 620), false);
assert.equal(outlineVisibleAtWidth(false, 900), false);
```

Also assert `outlineSidebarCSS()` contains `inline-size: clamp(200px, 18vw, 280px)`, a `1px` logical end border, complete `display: none` collapse, and ellipsis, but no shadow. Read `tab.ts` and assert it contains `outline-toggle`, the sidebar class, `onOutline`, and `revealPosition`.

- [ ] **Step 2: Add localized labels and icons**

Add these messages and matching IDs in `typings/i10n.d.ts`:

```ftl
markdown-outline-title = Contents
markdown-outline-toggle = Toggle contents
markdown-outline-collapse = Hide contents
markdown-outline-empty = No headings
```

```ftl
markdown-outline-title = 目录
markdown-outline-toggle = 切换目录
markdown-outline-collapse = 收起目录
markdown-outline-empty = 无目录
```

Add `iconPanelLeft()` and `iconPanelLeftClose()` using the existing Lucide-style `svg()` helper.

- [ ] **Step 3: Implement the sidebar component**

Create `outline-sidebar.ts` with:

```ts
export const OUTLINE_AUTO_HIDE_WIDTH = 680;

export function outlineIndentPx(level: number) {
  return Math.min(44, 8 + (Math.max(1, level) - 1) * 12);
}

export function outlineVisibleAtWidth(expanded: boolean, width: number) {
  return expanded && width >= OUTLINE_AUTO_HIDE_WIDTH;
}

export interface OutlineSidebarHandle {
  update(items: readonly EditorOutlineItem[], activeID: string | null): void;
  setActive(activeID: string | null): void;
  setExpanded(expanded: boolean): void;
  isVisible(): boolean;
  destroy(): void;
}
```

`mountOutlineSidebar()` receives existing DOM nodes plus `onNavigate` and `onExpandedChange`. Render native buttons with `role="treeitem"`, `title`, one-line ellipsis, capped indentation, and `aria-current="location"`. Delegate click, Enter, and Space. Use `ResizeObserver` to apply `is-outline-auto-hidden` below `680px` without overwriting explicit state. Remove listeners and observer in `destroy()`.

- [ ] **Step 4: Mount sidebar plus workspace in `tab.ts`**

Change the body structure to:

```text
.zotero-markdown-body
  nav.zotero-markdown-outline-sidebar
    .zotero-markdown-outline-header
    .zotero-markdown-outline-list[role="tree"]
  .zotero-markdown-workspace
    .zotero-markdown-editor-host
    .zotero-markdown-preview-host
```

Add the toggle before Save. Extend `SessionView` with sidebar, list, toggle, and workspace elements. Extend `OpenSession` with:

```ts
outlineItems?: EditorOutlineItem[];
outlineActiveID?: string | null;
outlineExpanded?: boolean;
outlineSidebar?: OutlineSidebarHandle;
```

Initialize `outlineExpanded: true`. Wire both controls through one `setOutlineExpanded()` helper. Wire the callbacks:

```ts
onOutline: (items, activeID) => {
  session.outlineItems = [...items];
  session.outlineActiveID = activeID;
  session.outlineSidebar?.update(items, activeID);
},
onOutlineActive: (activeID) => {
  session.outlineActiveID = activeID;
  session.outlineSidebar?.setActive(activeID);
},
```

Live/Source navigation calls `session.editor?.revealPosition(item.from)`. Destroy the sidebar before the editor in `closeSession()`.

- [ ] **Step 5: Add native sidebar CSS**

Export and interpolate `outlineSidebarCSS()`:

```css
.zotero-markdown-body {
  flex-direction: row;
}
.zotero-markdown-outline-sidebar {
  flex: 0 0 auto;
  inline-size: clamp(200px, 18vw, 280px);
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
  background: var(--zmd-surface-2);
  border-inline-end: 1px solid var(--zmd-border);
}
.zotero-markdown-root.is-outline-collapsed .zotero-markdown-outline-sidebar,
.zotero-markdown-root.is-outline-auto-hidden .zotero-markdown-outline-sidebar {
  display: none;
}
.zotero-markdown-workspace {
  position: relative;
  flex: 1 1 auto;
  min-inline-size: 0;
  min-block-size: 0;
  overflow: hidden;
}
```

Use compact 30-32px rows, existing foreground/muted/accent tokens, and visible `:focus-visible`; use no outer radius or shadow. Position editor and preview hosts relative to the workspace.

- [ ] **Step 6: Run UI tests and commit**

```bash
pnpm exec tsx --test test/markdown-outline-sidebar.test.ts test/markdown-toolbar.test.ts test/session-registry.test.ts test/editor-theme.test.ts
git add package.json src/modules/markdown/outline-sidebar.ts src/modules/markdown/session-registry.ts src/modules/markdown/tab.ts src/modules/markdown/styles.ts src/modules/markdown/icons.ts addon/locale/en-US/mainWindow.ftl addon/locale/zh-CN/mainWindow.ftl typings/i10n.d.ts test/markdown-outline-sidebar.test.ts
git commit -m "feat(markdown): add native tab outline sidebar"
```

Expected: all focused UI tests PASS and unrelated dirty files remain unstaged.

---

### Task 4: Navigate Preview Headings Without Switching Modes

**Files:**

- Modify: `src/modules/markdown/preview.ts:18-44, 271-318`
- Modify: `src/modules/markdown/tab.ts:1123-1160`
- Modify: `test/preview-document.test.ts`

**Interfaces:**

- Produces `previewOutlineAnchors(items, headingCount)`.
- Produces `scrollPreviewToOutline(host, outlineID)`.
- Extends `mountPreviewHtml(host, source, outlineItems?)`.

- [ ] **Step 1: Write the failing anchor test**

```ts
const items = [
  { id: "h1:0", level: 1 as const, text: "One", from: 0 },
  { id: "h2:12", level: 2 as const, text: "Two", from: 12 },
];
assert.deepEqual(previewOutlineAnchors(items, 3), ["h1:0", "h2:12", null]);
assert.deepEqual(previewOutlineAnchors(items, 1), ["h1:0"]);
```

Run `pnpm exec tsx --test test/preview-document.test.ts`; expect FAIL.

- [ ] **Step 2: Add deterministic Preview anchors**

Add:

```ts
export function previewOutlineAnchors(
  items: readonly EditorOutlineItem[],
  headingCount: number,
): Array<string | null> {
  return Array.from(
    { length: headingCount },
    (_, index) => items[index]?.id ?? null,
  );
}
```

Let `mountPreviewHtml()` accept `outlineItems = []`. After mounting the article, enumerate `h1, h2, h3, h4, h5, h6` and assign matching `data-zmd-outline-id`. Add:

```ts
export function scrollPreviewToOutline(host: HTMLElement, outlineID: string) {
  const heading = Array.from(
    host.querySelectorAll<HTMLElement>("[data-zmd-outline-id]"),
  ).find((element) => element.dataset.zmdOutlineId === outlineID);
  if (!heading) return false;
  heading.scrollIntoView({ block: "start", behavior: "smooth" });
  return true;
}
```

- [ ] **Step 3: Route navigation based on session mode**

Pass `session.outlineItems || []` into `mountPreviewHtml()`. Use:

```ts
if (session.mode === "preview" && session.view?.previewEl) {
  scrollPreviewToOutline(session.view.previewEl, item.id);
  return;
}
session.editor?.revealPosition(item.from);
```

Do not switch mode or regenerate Preview on click.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm exec tsx --test test/preview-document.test.ts test/editor-outline.test.ts test/markdown-outline-sidebar.test.ts
git add src/modules/markdown/preview.ts src/modules/markdown/tab.ts test/preview-document.test.ts
git commit -m "feat(markdown): navigate outline in preview mode"
```

---

### Task 5: Verify Isolation And Regression Safety

**Files:**

- Modify: `test/editor-channel.test.ts`
- Modify only if a failure requires it: files already listed in Tasks 1-4

**Interfaces:**

- Consumes the completed extraction, bridge, sidebar, and Preview navigation.
- Produces a verified feature with no known regression.

- [ ] **Step 1: Add a multi-tab isolation test**

Add an `outline` message for channel `tab-3:item-303` and assert `isEditorProtocolMessageForChannel(message, "tab-1:item-101")` is `false`.

- [ ] **Step 2: Run complete automated verification**

```bash
pnpm test:unit
pnpm build
pnpm lint:check
```

Expected: all tests pass, build plus `tsc --noEmit` succeed, and Prettier/ESLint report zero errors. Format only feature files if needed.

- [ ] **Step 3: Perform Zotero runtime verification**

Run `pnpm start`, then verify:

1. Two Markdown tabs show different outlines and independent expanded/active states.
2. Editing ATX and Setext headings updates the outline without moving the caret.
3. Heading-like content in frontmatter and fences never appears.
4. Live and Source clicks reveal the correct heading without changing text or undo history.
5. Preview clicks scroll the rendered heading without switching modes.
6. Collapse removes the sidebar completely; the far-left toolbar button restores it.
7. Narrow auto-hide restores the explicit state after widening.
8. Light/dark hover, active, focus, empty, ellipsis, and border states match Zotero.

Expected: all checks pass and the console contains no outline error. Stop the runner afterward.

- [ ] **Step 4: Review the diff and commit the isolation test**

```bash
git status --short
git diff --check
git add test/editor-channel.test.ts
git commit -m "test(markdown): cover outline tab isolation"
```

Expected: unrelated pre-existing changes remain unstaged and every feature commit contains only its listed paths.
