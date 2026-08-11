# Line-level Live Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Obsidian-style line-level Live Preview on top of the existing CodeMirror 6 iframe editor: non-active lines render as document prose; the cursor/selection lines show raw Markdown source; full Source mode remains available.

**Architecture:** Keep the pure-text CM document as source of truth. A `ViewPlugin` builds `Decoration` sets for non-active lines (hide markers, style content). Active lines (primary cursor line + selection-covered lines) and YAML frontmatter lines get no live decorations. Mode `live` | `source` is a CM `Compartment` toggled via extended postMessage protocol; parent tab toolbar switches mode.

**Tech Stack:** CodeMirror 6 (`@codemirror/view`, `@codemirror/state`), existing iframe bridge (`editor-protocol`, `editor.ts`, `bootstrap.ts`), TypeScript, `pnpm build` / `tsc --noEmit`. Pure helpers unit-tested with Node `node:test` (no Zotero required).

## Global Constraints

- Disk format remains standard Markdown + optional YAML frontmatter (do not normalize away user source).
- Live Preview granularity is **line-level** (not block-level).
- Engine remains CodeMirror 6 + decorations (no Milkdown/TipTap this phase).
- No left/right sidebars, no image `zotero://` protocol, no table editing in L1–L2.
- Frontmatter lines always show source in Live mode.
- IME: while composing, treat current line as active (source).
- Bundle: do not add `@codemirror/language-data`.
- Default mode on open: `live`.
- Preserve autosave, `getValue` cache, theme hot-switch, toolbar wrap/prefix APIs.

---

## File map

| Path | Responsibility |
|------|----------------|
| `src/modules/markdown/editor-protocol.ts` | Add `EditorMode`, `mode` on init, `setMode` message |
| `src/editor/live-preview/types.ts` | Shared types for live preview |
| `src/editor/live-preview/active-lines.ts` | Compute active line numbers + frontmatter line set |
| `src/editor/live-preview/inline.ts` | Pure ranges for bold/italic/code/link on one line |
| `src/editor/live-preview/structure.ts` | Pure parse for ATX heading / list / quote prefixes |
| `src/editor/live-preview/plugin.ts` | CM `ViewPlugin` + decorations |
| `src/editor/live-preview/index.ts` | Public `livePreview({ enabled })` extension factory |
| `src/editor/bootstrap.ts` | Mode compartment, lineNumbers compartment, wire plugin |
| `src/editor/theme.ts` | Live prose styles (heading sizes, etc.) when live |
| `src/modules/markdown/editor.ts` | `setMode`, init default `live` |
| `src/modules/markdown/tab.ts` | Toolbar Live \| Source; drop/repurpose Preview later |
| `src/modules/markdown/styles.ts` | Toolbar mode segment styles |
| `test/live-preview-active-lines.test.mjs` | Unit tests for pure helpers (Node test runner) |

---

### Task 1: Protocol — `EditorMode` + `setMode`

**Files:**
- Modify: `src/modules/markdown/editor-protocol.ts`
- Modify: `src/modules/markdown/editor.ts` (types only if needed for handle)
- Test: `pnpm build` (typecheck)

**Interfaces:**
- Produces:
  - `export type EditorMode = "live" | "source"`
  - `EditorInitPayload.mode?: EditorMode` (default interpreted as `"live"` by bootstrap)
  - `ParentToEditorMessage` variant `{ type: "setMode"; payload: { mode: EditorMode } }`
  - `MarkdownEditorHandle.setMode(mode: EditorMode): void`

- [ ] **Step 1: Extend protocol types**

In `editor-protocol.ts`, add:

```ts
export type EditorMode = "live" | "source";

export interface EditorInitPayload {
  doc: string;
  readOnly: boolean;
  fontSize: number;
  theme: EditorTheme;
  mode?: EditorMode;
}
```

Add to `ParentToEditorMessage` union:

```ts
| {
    source: typeof EDITOR_MESSAGE_SOURCE;
    type: "setMode";
    payload: { mode: EditorMode };
  }
```

- [ ] **Step 2: Export `setMode` on parent handle**

In `editor.ts` `MarkdownEditorHandle`, add:

```ts
setMode: (mode: EditorMode) => void;
```

Implement via existing `sendOrQueue` with `type: "setMode"`. Include `setMode` in pending dedupe list (same as `setTheme`).

Import `EditorMode` from `./editor-protocol`.

Default `init` payload: `mode: "live"`.

- [ ] **Step 3: Build**

Run: `pnpm build`  
Expected: success (bootstrap may ignore `setMode` until Task 4).

- [ ] **Step 4: Commit**

```bash
git add src/modules/markdown/editor-protocol.ts src/modules/markdown/editor.ts
git commit -m "feat(editor): add live/source mode to iframe protocol"
```

---

### Task 2: Pure helpers — active lines + frontmatter

**Files:**
- Create: `src/editor/live-preview/types.ts`
- Create: `src/editor/live-preview/active-lines.ts`
- Create: `test/live-preview-active-lines.test.mjs`
- Modify: `package.json` (optional script `"test:unit": "node --test test/*.test.mjs"`)

**Interfaces:**
- Produces:
  - `getActiveLineNumbers(doc: TextLike, mainFrom: number, mainTo: number): Set<number>`
  - `getFrontmatterLineNumbers(docText: string): Set<number>` — 1-based or 0-based? **Use 1-based CM line numbers** (`line.number`).
  - `shouldSkipLiveLine(lineNumber: number, active: Set<number>, frontmatter: Set<number>): boolean`

Use a minimal doc interface so tests do not import CM:

```ts
// types.ts
export interface LineInfo {
  number: number; // 1-based
  from: number;
  to: number;
  text: string;
}

export interface DocLines {
  lines: number;
  line(n: number): LineInfo; // n is 1-based
}
```

- [ ] **Step 1: Write failing unit tests**

`test/live-preview-active-lines.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
// After compile path: import from built file OR duplicate pure logic in .mjs for test.
// Prefer implementing helpers as plain .ts and testing via dynamic import of compiled output.
// For zero-build unit tests, implement active-lines as .ts and run:
//   pnpm exec tsx --test test/live-preview-active-lines.test.ts
```

Prefer **TypeScript tests** with `tsx` if available; else plain functions in `.mjs` re-export. Simplest path that works without new deps:

Create pure functions in `src/editor/live-preview/active-lines.ts`, and a **mirror-free** test file that imports using relative path after adding:

```json
"test:unit": "node --import tsx --test test/live-preview/*.test.ts"
```

If `tsx` is not a dependency, add devDependency `tsx` OR write the pure helpers as `active-lines.mjs` — **prefer adding `tsx` as devDependency** for DX.

Actually YAGNI: write helpers in TS and test file as:

`test/live-preview-active-lines.test.ts` using node:test, run with:

```bash
pnpm add -wD tsx
pnpm exec tsx --test test/live-preview-active-lines.test.ts
```

Test cases:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activeLinesFromSelection,
  frontmatterLineNumbers,
  shouldSkipLiveLine,
} from "../src/editor/live-preview/active-lines.ts";

function docFrom(text: string) {
  const lines = text.split("\n");
  let pos = 0;
  const infos = lines.map((t, i) => {
    const from = pos;
    const to = pos + t.length;
    pos = to + 1;
    return { number: i + 1, from, to, text: t };
  });
  return {
    lines: infos.length,
    line: (n: number) => infos[n - 1],
    text: text,
  };
}

describe("activeLinesFromSelection", () => {
  it("marks single cursor line", () => {
    const d = docFrom("a\nb\nc");
    // cursor on line 2 (offset after "a\n")
    const set = activeLinesFromSelection(d, 2, 2);
    assert.deepEqual([...set].sort(), [2]);
  });

  it("marks all lines covered by selection", () => {
    const d = docFrom("a\nb\nc");
    const set = activeLinesFromSelection(d, 0, 3); // "a\nb"
    assert.ok(set.has(1) && set.has(2));
  });
});

describe("frontmatterLineNumbers", () => {
  it("detects yaml fence block at start", () => {
    const text = "---\ntitle: x\n---\n\n# Hi";
    const set = frontmatterLineNumbers(text);
    assert.ok(set.has(1) && set.has(2) && set.has(3));
    assert.equal(set.has(5), false);
  });

  it("returns empty when no frontmatter", () => {
    const set = frontmatterLineNumbers("# Hi\n");
    assert.equal(set.size, 0);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm exec tsx --test test/live-preview-active-lines.test.ts`  
Expected: module not found / functions missing.

- [ ] **Step 3: Implement helpers**

`active-lines.ts`:

```ts
import type { DocLines } from "./types";

/** 1-based line numbers covered by [from, to] selection (CM indices). */
export function activeLinesFromSelection(
  doc: DocLines,
  from: number,
  to: number,
): Set<number> {
  const out = new Set<number>();
  if (doc.lines < 1) return out;
  const start = doc.lineAtOffset
    ? doc.lineAtOffset(from)
    : lineAt(doc, from);
  const end = doc.lineAtOffset
    ? doc.lineAtOffset(Math.max(from, to))
    : lineAt(doc, Math.max(from, to));
  for (let n = start.number; n <= end.number; n++) out.add(n);
  return out;
}

// Prefer implementing lineAtOffset on adapter from CM Text in plugin;
// for tests, provide full DocLines with lineAtOffset:

export function frontmatterLineNumbers(text: string): Set<number> {
  const lines = text.split("\n");
  const set = new Set<number>();
  if (lines[0]?.trim() !== "---") return set;
  set.add(1);
  for (let i = 1; i < lines.length; i++) {
    set.add(i + 1);
    if (i > 0 && lines[i].trim() === "---") break;
  }
  return set;
}

export function shouldSkipLiveLine(
  lineNumber: number,
  active: Set<number>,
  frontmatter: Set<number>,
): boolean {
  return active.has(lineNumber) || frontmatter.has(lineNumber);
}
```

Define `DocLines` in `types.ts` as:

```ts
export interface LineInfo {
  number: number;
  from: number;
  to: number;
  text: string;
}

export interface DocLines {
  lines: number;
  line(n: number): LineInfo;
  /** Map document offset → line */
  lineAt(pos: number): LineInfo;
}
```

Implement `activeLinesFromSelection` using `doc.lineAt(from)` / `doc.lineAt(to)`.

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm exec tsx --test test/live-preview-active-lines.test.ts`  
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/editor/live-preview package.json pnpm-lock.yaml test/live-preview-active-lines.test.ts
git commit -m "feat(live-preview): active line and frontmatter helpers"
```

---

### Task 3: Pure structure + inline range parsers (L1)

**Files:**
- Create: `src/editor/live-preview/structure.ts`
- Create: `src/editor/live-preview/inline.ts`
- Create: `test/live-preview-parse.test.ts`

**Interfaces:**
- Produces:
  - `parseAtxHeading(line: string): { level: 1|2|3|4|5|6; markEnd: number; textStart: number } | null`
  - `parseInlineL1(line: string): Array<{ from: number; to: number; kind: "mark" | "strong" | "em" }>`  
    where `mark` ranges are syntax to hide, `strong`/`em` are content to style.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAtxHeading } from "../src/editor/live-preview/structure.ts";
import { parseInlineL1 } from "../src/editor/live-preview/inline.ts";

describe("parseAtxHeading", () => {
  it("parses h1", () => {
    const r = parseAtxHeading("# Hello");
    assert.equal(r?.level, 1);
    assert.equal(r?.markEnd, 2); // "# "
    assert.equal(r?.textStart, 2);
  });
  it("rejects non-heading", () => {
    assert.equal(parseAtxHeading("not a heading"), null);
  });
});

describe("parseInlineL1", () => {
  it("finds bold markers", () => {
    const r = parseInlineL1("a **b** c");
    const marks = r.filter((x) => x.kind === "mark");
    assert.ok(marks.some((m) => m.from === 2 && m.to === 4));
    assert.ok(marks.some((m) => m.from === 5 && m.to === 7));
  });
});
```

- [ ] **Step 2: Implement minimal parsers**

`structure.ts` — regex `^(#{1,6})(\s+)(.*)$` on full line (trimEnd ok; require space after hashes per CommonMark ATX).

`inline.ts` — L1 only:
- `**...**` strong (non-greedy, no newline)
- `*...*` em (not part of `**`; simple scan is OK for L1)
- Skip content inside incomplete pairs

Do not handle nested emphasis in L1; imperfect is OK if tests pass for simple cases.

- [ ] **Step 3: Run tests PASS + commit**

```bash
pnpm exec tsx --test test/live-preview-parse.test.ts
git add src/editor/live-preview test/live-preview-parse.test.ts
git commit -m "feat(live-preview): L1 heading and emphasis parsers"
```

---

### Task 4: Live Preview ViewPlugin (L1 decorations)

**Files:**
- Create: `src/editor/live-preview/plugin.ts`
- Create: `src/editor/live-preview/index.ts`
- Modify: `src/editor/theme.ts` (heading CSS classes)
- Modify: `src/editor/bootstrap.ts`

**Interfaces:**
- Consumes: parsers + active line helpers
- Produces: `export function livePreviewExtension(enabled: boolean): Extension`

Decoration rules (L1):
1. For each line where `!shouldSkipLiveLine(...)`:
   - If ATX heading: `Decoration.replace` or `mark` on hash+space prefix with `class: "zmd-lp-hidden"`; line class `zmd-lp-h{level}`
   - Inline: hide mark ranges with `zmd-lp-hidden`; content `zmd-lp-strong` / `zmd-lp-em`
2. Rebuild on `docChanged || selectionSet || viewportChanged`
3. When `enabled === false`, return empty decorations

CSS in iframe (`theme.ts` or `index.html` style + theme):

```css
.zmd-lp-hidden { font-size: 0; letter-spacing: -1ch; opacity: 0; /* or display via CM replace */ }
.cm-line.zmd-lp-h1 { font-size: 1.75em; font-weight: 700; ... }
.cm-line.zmd-lp-h2 { font-size: 1.4em; font-weight: 650; }
.zmd-lp-strong { font-weight: 700; }
.zmd-lp-em { font-style: italic; }
```

Prefer `Decoration.mark({ class: "zmd-lp-hidden" })` with CSS:

```css
.zmd-lp-hidden {
  opacity: 0;
  font-size: 0.01px;
  width: 0;
  display: inline-block;
  overflow: hidden;
}
```

CM often uses `Decoration.replace({ widget: empty })` for cleaner hide — use **mark+opacity** first for simpler cursor math; switch to replace if needed.

Adapter from `EditorState.doc` to `DocLines`:

```ts
function asDocLines(state: EditorState): DocLines {
  return {
    lines: state.doc.lines,
    line: (n) => {
      const l = state.doc.line(n);
      return { number: n, from: l.from, to: l.to, text: l.text };
    },
    lineAt: (pos) => {
      const l = state.doc.lineAt(pos);
      return { number: l.number, from: l.from, to: l.to, text: l.text };
    },
  };
}
```

- [ ] **Step 1: Implement plugin + `livePreviewExtension`**

```ts
// index.ts
import { Compartment, type Extension } from "@codemirror/state";
// Actually enabled toggled from outside via compartment.reconfigure
export { livePreviewPlugin } from "./plugin";

export function livePreviewWhen(enabled: boolean): Extension {
  return enabled ? livePreviewPlugin : [];
}
```

- [ ] **Step 2: Wire bootstrap compartments**

In `bootstrap.ts`:

```ts
const modeCompartment = new Compartment();
const guttersCompartment = new Compartment();

function extensionsForMode(mode: EditorMode): Extension {
  if (mode === "live") {
    return [
      modeCompartment.of([]), // placeholder
      guttersCompartment.of([]), // no lineNumbers in live
      livePreviewWhen(true),
      EditorView.editorAttributes.of({ class: "zmd-mode-live" }),
    ];
  }
  return [
    guttersCompartment.of([lineNumbers(), highlightActiveLineGutter(), foldGutter()]),
    livePreviewWhen(false),
    EditorView.editorAttributes.of({ class: "zmd-mode-source" }),
  ];
}
```

Refactor carefully: today gutters are always on. Split so Live hides line numbers + fold gutter.

Handle `setMode` in `handleParentMessage`:

```ts
case "setMode": {
  if (!view) return;
  const mode = data.payload.mode === "source" ? "source" : "live";
  view.dispatch({
    effects: [
      modeCompartment.reconfigure(livePreviewWhen(mode === "live")),
      guttersCompartment.reconfigure(
        mode === "source"
          ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()]
          : [],
      ),
    ],
  });
  // also toggle editorAttributes via another compartment if needed
  break;
}
```

Use a dedicated `modeUiCompartment` for attributes/class.

Init: `const mode = init.mode ?? "live"`.

- [ ] **Step 3: Build**

Run: `pnpm build`  
Expected: success; `editor.js` size stays reasonable (~0.5–0.7MB).

- [ ] **Step 4: Manual smoke (dev)**

Run: `pnpm start`  
Open a `.md` with:

```md
# Title
hello **world**
```

Verify: cursor on title shows `#`; on other line title looks large; bold renders when cursor elsewhere.

- [ ] **Step 5: Commit**

```bash
git add src/editor
git commit -m "feat(live-preview): L1 ViewPlugin for headings and emphasis"
```

---

### Task 5: Parent tab UI — Live | Source mode switch

**Files:**
- Modify: `src/modules/markdown/tab.ts`
- Modify: `src/modules/markdown/styles.ts`

**Interfaces:**
- Consumes: `editor.setMode("live" | "source")`
- Session field: `mode: "live" | "source" | "preview"` — **migrate carefully**

Current session uses `mode: "edit" | "preview"`. Plan:

| Old | New |
|-----|-----|
| `edit` | split into `live` (default) and `source` |
| `preview` | keep optional third state for L1 to reduce risk, OR map Preview button away |

**L1 product decision (locked):** Toolbar shows three or two controls:

Recommended L1:
- Segment: **实时预览** | **源码** | **预览** (preview remains read-only markdown-it)
- Default active: 实时预览

Session type:

```ts
mode: "live" | "source" | "preview";
```

- `live` / `source`: show editorHost; call `setMode`; hide preview host  
- `preview`: existing preview path using `getValue()`

- [ ] **Step 1: Update session + toolbar buttons**

Replace Edit button with Live + Source (labels: `Live` / `Source` or Chinese `实时` / `源码` — use English short labels consistent with current `Edit`/`Preview` unless locale exists; **keep English `Live` / `Source` / `Preview`** for parity with existing toolbar language).

Wire clicks:
- Live → `session.mode = "live"`; `editor.setMode("live")`; show editor
- Source → `session.mode = "source"`; `editor.setMode("source")`; show editor  
- Preview → existing

- [ ] **Step 2: Styles for active mode buttons** (reuse `.zotero-markdown-btn.active`)

- [ ] **Step 3: `pnpm build` + manual check mode switch**

- [ ] **Step 4: Commit**

```bash
git add src/modules/markdown/tab.ts src/modules/markdown/styles.ts
git commit -m "feat(ui): Live/Source/Preview mode switch for markdown tab"
```

---

### Task 6: Live canvas typography

**Files:**
- Modify: `src/editor/theme.ts`
- Modify: `addon/content/editor/index.html` (optional base CSS)
- Modify: `src/editor/bootstrap.ts` if content padding differs by mode

- [ ] **Step 1: Live mode styles**

When `.zmd-mode-live`:
- `font-family`: system-ui / text fonts (not mono)
- larger line-height (~1.7)
- content max-width optional via padding
- gutters already off

When `.zmd-mode-source`:
- keep mono stack from current theme

- [ ] **Step 2: Build + visual check light/dark**

- [ ] **Step 3: Commit**

```bash
git add src/editor/theme.ts addon/content/editor/index.html
git commit -m "style(live-preview): prose typography for live mode"
```

---

### Task 7: L2 parsers + decorations (list, quote, link, inline code)

**Files:**
- Modify: `src/editor/live-preview/structure.ts`
- Modify: `src/editor/live-preview/inline.ts`
- Modify: `src/editor/live-preview/plugin.ts`
- Modify: `test/live-preview-parse.test.ts`

**Interfaces:**
- `parseListPrefix(line): { markEnd: number } | null` — `^(\s*)([-*+]|\d+\.)\s+`
- `parseBlockQuotePrefix(line): { markEnd: number } | null` — `^(\s*>\s?)+`
- `parseInlineL2`: add `` `code` `` and `[text](url)` (hide `[]()` marks, style text as link)

- [ ] **Step 1: Tests for list/quote/link/code**

- [ ] **Step 2: Implement + decorate in plugin** (skip lines inside frontmatter; skip active lines)

- [ ] **Step 3: Unit tests pass + `pnpm build`**

- [ ] **Step 4: Manual check**

Doc:

```md
> quote
- item **x**
[link](https://example.com)
`code`
```

- [ ] **Step 5: Commit**

```bash
git add src/editor/live-preview test
git commit -m "feat(live-preview): L2 list, quote, link, and inline code"
```

---

### Task 8: IME safety + composition

**Files:**
- Modify: `src/editor/live-preview/plugin.ts`

- [ ] **Step 1: Track composition**

```ts
let composing = false;
// EditorView.domEventHandlers({
//   compositionstart: () => { composing = true; },
//   compositionend: () => { composing = false; },
// })
```

While `composing`, force active line set to include cursor line (already true) and **skip decorations on that line** (already active). Ensure plugin reconfigures on compositionend (`view.dispatch` empty transaction or requestMeasure).

- [ ] **Step 2: Manual Chinese IME test in Zotero**

- [ ] **Step 3: Commit**

```bash
git commit -am "fix(live-preview): keep source line stable during IME composition"
```

---

### Task 9: Docs + acceptance checklist

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-live-preview-design.md` (status: L1/L2 implemented when done)
- Modify: `docs/editor/codemirror-iframe-plan.md` (link plan progress)
- Optional: `CHANGELOG.md` entry under Unreleased

- [ ] **Step 1: Mark L1/L2 acceptance in spec implementation notes**

Checklist (all must pass before release bump):

1. Open `.md` → default Live, document-like (no line numbers).
2. Cursor on heading → `#` visible; leave → styled heading.
3. Bold on non-active line styled; active line shows `**`.
4. L2: list/quote/link/code behave similarly.
5. Source mode: full raw + line numbers.
6. Preview mode still renders HTML.
7. Autosave + theme hot switch still work.
8. Frontmatter lines never fake-render as headings.
9. `pnpm build` clean; unit tests pass.

- [ ] **Step 2: Commit docs**

```bash
git add docs
git commit -m "docs: record live preview L1/L2 implementation status"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Live default + Source mode | 1, 4, 5 |
| Line-level active source | 2, 4 |
| Frontmatter always source | 2, 4 |
| L1 heading + bold/italic | 3, 4 |
| L2 list/link/code/quote | 7 |
| CM + decorations, no Milkdown | 4 |
| No sidebars / images / tables | Global constraints (not in tasks) |
| IME | 8 |
| Autosave / theme / toolbar APIs | 1, 5 (preserve existing) |
| Typography | 6 |

## Placeholder scan

No TBD steps; pure helpers have concrete tests; plugin rules listed for L1/L2.

## Type consistency

- `EditorMode = "live" | "source"` used in protocol, editor handle, bootstrap, tab session (tab also has `"preview"`).
- Line numbers **1-based** everywhere in helpers.
- `shouldSkipLiveLine` / `activeLinesFromSelection` / `frontmatterLineNumbers` names stable across tasks.

---

## Out of scope (do not implement in this plan)

- L3 code fences polish, L4 frontmatter fold, tables, images
- Removing Preview entirely
- Block-level source reveal
