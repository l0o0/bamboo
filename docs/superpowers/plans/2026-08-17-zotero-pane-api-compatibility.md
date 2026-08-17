# Zotero Pane API Compatibility Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a capability-detected, array-based ZoteroPane selection API that works on Zotero 9 and Zotero 10, then route Markdown attachment creation through it.

**Architecture:** A focused `src/compat/zotero-pane.ts` module owns old/new ZoteroPane method detection and return-shape normalization. Business code consumes typed arrays and makes selection-policy decisions explicitly; a small pure creation-target helper preserves the current first-collection behavior.

**Tech Stack:** TypeScript, Zotero plugin APIs, Node test runner through `tsx`, pnpm.

## Global Constraints

- Support the plugin's current Zotero 9 and Zotero 10 range.
- Prefer plural runtime methods; call singular methods only when the plural replacement is absent.
- Return arrays from every compatibility function.
- Preserve all values from Zotero 10 multi-selection results.
- Return `[]` for an unavailable pane or nullish selection.
- Do not catch or suppress unrelated exceptions thrown by an available Zotero API.
- Do not inspect `Zotero.version` or monkey-patch Zotero globals.
- Keep Markdown creation's current behavior: use only the first selected collection ID.
- Stage only task-owned hunks because the worktree contains unrelated changes, including `package.json` and `src/modules/markdown/create.ts`.

## File Structure

- Create `src/compat/zotero-pane.ts`: structural pane type, capability detection, array normalization, and typed selection functions.
- Create `src/modules/markdown/create-target.ts`: pure policy for resolving the one collection ID used by Markdown creation.
- Modify `src/modules/markdown/create.ts`: replace direct ZoteroPane selection access with the pure target helper.
- Create `test/zotero-pane-compat.test.ts`: Zotero 9/10 contract and exception-boundary tests.
- Create `test/markdown-create-target.test.ts`: current first-collection creation policy tests.
- Modify `package.json`: include both new test files in `test:unit`; stage only the added filenames in the already-modified script.

---

### Task 1: Array-Based ZoteroPane Compatibility Functions

**Files:**

- Create: `src/compat/zotero-pane.ts`
- Create: `test/zotero-pane-compat.test.ts`
- Modify: `package.json:34`

**Interfaces:**

- Produces: `ZoteroPaneSelectionLike`.
- Produces: `getSelectedCollections(pane, asID)` returning `Zotero.Collection[]` or `number[]`.
- Produces: `getSelectedLibraryIDs(pane)` returning `number[]`.
- Produces: `getCollectionTreeRows(pane)` returning `Zotero.CollectionTreeRow[]`.
- Produces: `getSelectedSavedSearches(pane, asID)` returning `Zotero.Search[]` or `number[]`.
- Produces: `getSelectedGroupRows(pane)` returning `Zotero.CollectionTreeRow[]`.
- Consumed by: Task 2's creation-target helper.

- [ ] **Step 1: Write the failing Zotero 9/10 compatibility tests**

Create `test/zotero-pane-compat.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  getCollectionTreeRows,
  getSelectedCollections,
  getSelectedGroupRows,
  getSelectedLibraryIDs,
  getSelectedSavedSearches,
  type ZoteroPaneSelectionLike,
} from "../src/compat/zotero-pane.ts";

test("prefers Zotero 10 plural collection getters and preserves all values", () => {
  const pane: ZoteroPaneSelectionLike = {
    marker: "pane",
    getSelectedCollections(asID?: boolean) {
      assert.equal(this.marker, "pane");
      assert.equal(asID, true);
      return [11, 22];
    },
    getSelectedCollection() {
      throw new Error("removed singular getter must not run");
    },
  };

  assert.deepEqual(getSelectedCollections(pane, true), [11, 22]);
});

test("wraps Zotero 9 singular collection and library results", () => {
  const collection = { id: 7 } as Zotero.Collection;
  const pane: ZoteroPaneSelectionLike = {
    getSelectedCollection(asID?: boolean) {
      return asID ? 7 : collection;
    },
    getSelectedLibraryID() {
      return 1;
    },
  };

  assert.deepEqual(getSelectedCollections(pane), [collection]);
  assert.deepEqual(getSelectedCollections(pane, true), [7]);
  assert.deepEqual(getSelectedLibraryIDs(pane), [1]);
});

test("returns empty arrays for unavailable panes and nullish selections", () => {
  assert.deepEqual(getSelectedCollections(undefined, true), []);
  assert.deepEqual(getSelectedLibraryIDs(null), []);
  assert.deepEqual(
    getSelectedSavedSearches({ getSelectedSavedSearch: () => undefined }),
    [],
  );
});

test("normalizes collection-tree rows and filters group rows", () => {
  const group = { isGroup: () => true } as Zotero.CollectionTreeRow;
  const collection = { isGroup: () => false } as Zotero.CollectionTreeRow;
  const pane: ZoteroPaneSelectionLike = {
    getCollectionTreeRows() {
      return [group, collection];
    },
    getCollectionTreeRow() {
      throw new Error("removed singular getter must not run");
    },
  };

  assert.deepEqual(getCollectionTreeRows(pane), [group, collection]);
  assert.deepEqual(getSelectedGroupRows(pane), [group]);
});

test("wraps Zotero 9 singular rows and saved searches", () => {
  const row = { isGroup: () => true } as Zotero.CollectionTreeRow;
  const search = { id: 9 } as Zotero.Search;
  const pane: ZoteroPaneSelectionLike = {
    getCollectionTreeRow: () => row,
    getSelectedSavedSearch: (asID?: boolean) => (asID ? 9 : search),
  };

  assert.deepEqual(getCollectionTreeRows(pane), [row]);
  assert.deepEqual(getSelectedGroupRows(pane), [row]);
  assert.deepEqual(getSelectedSavedSearches(pane), [search]);
  assert.deepEqual(getSelectedSavedSearches(pane, true), [9]);
});

test("does not suppress exceptions from an available plural getter", () => {
  const pane: ZoteroPaneSelectionLike = {
    getSelectedLibraryIDs() {
      throw new Error("collections view unavailable");
    },
  };

  assert.throws(
    () => getSelectedLibraryIDs(pane),
    /collections view unavailable/,
  );
});
```

- [ ] **Step 2: Register the new focused test and verify the RED state**

Add `test/zotero-pane-compat.test.ts` to the existing `test:unit` command in
`package.json`. Do not remove or reorder the test files already present in the
dirty working tree.

Run:

```bash
pnpm exec tsx --test test/zotero-pane-compat.test.ts
```

Expected: FAIL with `Cannot find module '../src/compat/zotero-pane.ts'`.

- [ ] **Step 3: Implement the compatibility module**

Create `src/compat/zotero-pane.ts`:

```ts
type PaneMethod = (...args: any[]) => unknown;

export interface ZoteroPaneSelectionLike {
  [key: string]: unknown;
  getSelectedCollections?: PaneMethod;
  getSelectedCollection?: PaneMethod;
  getSelectedLibraryIDs?: PaneMethod;
  getSelectedLibraryID?: PaneMethod;
  getCollectionTreeRows?: PaneMethod;
  getCollectionTreeRow?: PaneMethod;
  getSelectedSavedSearches?: PaneMethod;
  getSelectedSavedSearch?: PaneMethod;
}

function normalizeArray<T>(value: unknown): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

function callPluralOrSingular<T>(
  pane: ZoteroPaneSelectionLike | null | undefined,
  pluralName: keyof ZoteroPaneSelectionLike,
  singularName: keyof ZoteroPaneSelectionLike,
  args: unknown[] = [],
): T[] {
  if (!pane) return [];

  const plural = pane[pluralName];
  if (typeof plural === "function") {
    return normalizeArray<T>(plural.apply(pane, args));
  }

  const singular = pane[singularName];
  if (typeof singular === "function") {
    return normalizeArray<T>(singular.apply(pane, args));
  }

  return [];
}

export function getSelectedCollections(
  pane: ZoteroPaneSelectionLike | null | undefined,
  asID: true,
): number[];
export function getSelectedCollections(
  pane: ZoteroPaneSelectionLike | null | undefined,
  asID?: false,
): Zotero.Collection[];
export function getSelectedCollections(
  pane: ZoteroPaneSelectionLike | null | undefined,
  asID = false,
): Array<Zotero.Collection | number> {
  return callPluralOrSingular<Zotero.Collection | number>(
    pane,
    "getSelectedCollections",
    "getSelectedCollection",
    [asID],
  );
}

export function getSelectedLibraryIDs(
  pane: ZoteroPaneSelectionLike | null | undefined,
): number[] {
  return callPluralOrSingular<number>(
    pane,
    "getSelectedLibraryIDs",
    "getSelectedLibraryID",
  );
}

export function getCollectionTreeRows(
  pane: ZoteroPaneSelectionLike | null | undefined,
): Zotero.CollectionTreeRow[] {
  return callPluralOrSingular<Zotero.CollectionTreeRow>(
    pane,
    "getCollectionTreeRows",
    "getCollectionTreeRow",
  );
}

export function getSelectedSavedSearches(
  pane: ZoteroPaneSelectionLike | null | undefined,
  asID: true,
): number[];
export function getSelectedSavedSearches(
  pane: ZoteroPaneSelectionLike | null | undefined,
  asID?: false,
): Zotero.Search[];
export function getSelectedSavedSearches(
  pane: ZoteroPaneSelectionLike | null | undefined,
  asID = false,
): Array<Zotero.Search | number> {
  return callPluralOrSingular<Zotero.Search | number>(
    pane,
    "getSelectedSavedSearches",
    "getSelectedSavedSearch",
    [asID],
  );
}

export function getSelectedGroupRows(
  pane: ZoteroPaneSelectionLike | null | undefined,
): Zotero.CollectionTreeRow[] {
  return getCollectionTreeRows(pane).filter((row) => row.isGroup());
}
```

- [ ] **Step 4: Run focused tests and TypeScript verification**

Run:

```bash
pnpm exec tsx --test test/zotero-pane-compat.test.ts
pnpm exec tsc --noEmit
```

Expected: 6 compatibility tests pass and TypeScript exits with code 0.

- [ ] **Step 5: Commit Task 1 without staging unrelated `package.json` changes**

Inspect the package diff and stage only the new test filename in the
`test:unit` script. Then stage the two new files:

```bash
git diff -- package.json
git add -p package.json
git add src/compat/zotero-pane.ts test/zotero-pane-compat.test.ts
git diff --cached --check
git commit -m "feat(zotero): add pane selection compatibility layer"
```

Expected: the commit contains the compatibility module, its tests, and only
the task-owned `package.json` script fragment.

---

### Task 2: Migrate Markdown Creation Selection

**Files:**

- Create: `src/modules/markdown/create-target.ts`
- Create: `test/markdown-create-target.test.ts`
- Modify: `src/modules/markdown/create.ts:1-95`
- Modify: `package.json:34`

**Interfaces:**

- Consumes: `getSelectedCollections(pane, true): number[]` from Task 1.
- Produces: `resolveMarkdownCollectionID(pane, explicitCollectionID?)` returning `number | undefined`.
- `createMarkdownAttachment()` consumes the helper and continues passing zero or one collection ID to `Zotero.Attachments.importFromFile()`.

- [ ] **Step 1: Write the failing creation-target policy tests**

Create `test/markdown-create-target.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { resolveMarkdownCollectionID } from "../src/modules/markdown/create-target.ts";

test("explicit collection ID takes precedence without reading ZoteroPane", () => {
  assert.equal(
    resolveMarkdownCollectionID(
      {
        getSelectedCollections() {
          throw new Error("selection must not be read");
        },
      },
      44,
    ),
    44,
  );
});

test("Markdown creation keeps using the first selected collection", () => {
  assert.equal(
    resolveMarkdownCollectionID({
      getSelectedCollections: () => [12, 13],
    }),
    12,
  );
});

test("invalid or empty first selections do not create collection membership", () => {
  assert.equal(
    resolveMarkdownCollectionID({ getSelectedCollections: () => [] }),
    undefined,
  );
  assert.equal(
    resolveMarkdownCollectionID({ getSelectedCollections: () => [0, 13] }),
    undefined,
  );
});
```

- [ ] **Step 2: Register the test and verify the RED state**

Add `test/markdown-create-target.test.ts` to the existing `test:unit` command
without changing other test entries.

Run:

```bash
pnpm exec tsx --test test/markdown-create-target.test.ts
```

Expected: FAIL with `Cannot find module '../src/modules/markdown/create-target.ts'`.

- [ ] **Step 3: Implement the pure creation-target helper**

Create `src/modules/markdown/create-target.ts`:

```ts
import {
  getSelectedCollections,
  type ZoteroPaneSelectionLike,
} from "../../compat/zotero-pane";

export function resolveMarkdownCollectionID(
  pane: ZoteroPaneSelectionLike | null | undefined,
  explicitCollectionID?: number,
): number | undefined {
  if (explicitCollectionID != null) return explicitCollectionID;

  const collectionID = getSelectedCollections(pane, true)[0];
  return typeof collectionID === "number" && collectionID > 0
    ? collectionID
    : undefined;
}
```

- [ ] **Step 4: Route `createMarkdownAttachment()` through the helper**

Add the import in `src/modules/markdown/create.ts`:

```ts
import { resolveMarkdownCollectionID } from "./create-target";
```

Replace the direct selection block:

```ts
const collection = !parent
  ? resolveMarkdownCollectionID(pane, collectionID)
  : undefined;
const collections = collection == null ? undefined : [collection];
```

Remove the old `selectedIDs` variable and its inline array/type checks. Do not
modify the surrounding API, persistence, notification, or UI behavior.

- [ ] **Step 5: Run focused tests and the creation-related suite**

Run:

```bash
pnpm exec tsx --test \
  test/zotero-pane-compat.test.ts \
  test/markdown-create-target.test.ts \
  test/markdown-filename.test.ts
pnpm exec tsc --noEmit
```

Expected: all focused tests pass and TypeScript exits with code 0.

- [ ] **Step 6: Commit Task 2 with partial staging for dirty files**

Stage the new files normally. Use interactive staging for `package.json` and
`src/modules/markdown/create.ts`, accepting only the compatibility migration
hunks and preserving every pre-existing working-tree change:

```bash
git add src/modules/markdown/create-target.ts test/markdown-create-target.test.ts
git add -p package.json src/modules/markdown/create.ts
git diff --cached --check
git diff --cached --stat
git commit -m "refactor(markdown): use Zotero pane compatibility API"
```

---

### Task 3: Full Regression and Build Verification

**Files:**

- Verify only; no planned source changes.

**Interfaces:**

- Consumes: all compatibility and Markdown creation changes from Tasks 1-2.
- Produces: verification evidence for unit behavior, TypeScript, packaging, lint, formatting, and staging boundaries.

- [ ] **Step 1: Run the complete unit suite**

Run:

```bash
pnpm test:unit
```

Expected: every test passes with zero failures, including the 9 new tests.

- [ ] **Step 2: Run the production build**

Run:

```bash
pnpm build
```

Expected: Zotero plugin packaging and `tsc --noEmit` both exit with code 0.

- [ ] **Step 3: Run focused lint and formatting checks**

Run:

```bash
pnpm exec eslint \
  src/compat/zotero-pane.ts \
  src/modules/markdown/create-target.ts \
  src/modules/markdown/create.ts \
  test/zotero-pane-compat.test.ts \
  test/markdown-create-target.test.ts

pnpm exec prettier --check \
  package.json \
  src/compat/zotero-pane.ts \
  src/modules/markdown/create-target.ts \
  src/modules/markdown/create.ts \
  test/zotero-pane-compat.test.ts \
  test/markdown-create-target.test.ts

git diff --check
```

Expected: all commands exit with code 0.

- [ ] **Step 4: Confirm commit and dirty-worktree boundaries**

Run:

```bash
git status --short
git show --stat --oneline HEAD~1..HEAD
git log --oneline -5
```

Expected: both implementation commits contain only task-owned changes. All
pre-existing unrelated modifications remain unstaged and are not reverted.
