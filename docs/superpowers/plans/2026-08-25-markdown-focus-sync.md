# Markdown Focus Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the same Markdown attachment to remain open in a Bamboo tab and Zotero sidebar, with content refreshed when a view regains focus and without continuous full-document broadcasting.

**Architecture:** Add a document-scoped registry that stores source identifiers, edit order, and save revisions while delegating content access to registered callbacks. A focused clean view flushes the newest dirty peer, reads the attachment from disk, and adopts the result as a clean editor snapshot; a dirty focused view is never overwritten. Tab and sidebar adapters register their existing editor and `SaveCoordinator` instances with this registry and publish lightweight edit/save invalidations.

**Tech Stack:** TypeScript, Zotero tab hooks and ItemPaneManager lifecycle, CodeMirror iframe bridge, Node test runner, pnpm.

## Global Constraints

- Continue directly on `main`, as previously requested by the user.
- Do not broadcast or retain complete Markdown documents in the registry.
- Do not overwrite a locally dirty editor during focus refresh.
- Keep autosave and image/title persistence on the existing `persistMarkdownContent` path.
- Do not create a git commit unless the user explicitly requests one.

---

### Task 1: Document synchronization state

**Files:**

- Create: `src/modules/markdown/document-sync.ts`
- Create: `test/document-sync.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `DocumentSyncRegistry`, `DocumentSyncSource`, `DocumentRefreshResult`, and the singleton `documentSyncRegistry`.
- A source exposes `sourceID`, `itemID`, `hasLocalWork()`, `flush()`, `getCurrentValue()`, `readPersisted()`, and `applyPersisted(value)`.

- [ ] **Step 1: Write failing registry tests**

```ts
it("refreshes a clean source from persisted content after another source saves", async () => {
  const registry = new DocumentSyncRegistry();
  // Register tab and sidebar sources for one item, publish a tab save,
  // focus the sidebar, and assert that sidebar applyPersisted receives disk data.
});

it("flushes the newest dirty peer before reading persisted content", async () => {
  // Mark one source edited, focus the other, and assert flush occurs before read.
});

it("does not overwrite the focused source while it is dirty", async () => {
  // Focus a dirty source and assert neither readPersisted nor applyPersisted runs.
});

it("unregisters sources without retaining document content", () => {
  // Register, dispose, and assert the source is no longer considered.
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec tsx --test test/document-sync.test.ts`

Expected: FAIL because `document-sync.ts` and `DocumentSyncRegistry` do not exist.

- [ ] **Step 3: Implement the minimal registry**

```ts
export interface DocumentSyncSource {
  sourceID: string;
  itemID: number;
  hasLocalWork(): boolean;
  flush(): Promise<void>;
  getCurrentValue(): string;
  readPersisted(): Promise<string>;
  applyPersisted(value: string): void | Promise<void>;
}

export type DocumentRefreshResult =
  "refreshed" | "unchanged" | "skipped-dirty" | "blocked-peer-dirty";

export class DocumentSyncRegistry {
  register(source: DocumentSyncSource): () => void;
  markEdited(sourceID: string): void;
  markSaved(sourceID: string): void;
  refreshOnFocus(sourceID: string): Promise<DocumentRefreshResult>;
}
```

The registry stores only source callbacks, a monotonic edit sequence, document save revision, and each source's last seen revision. `hasLocalWork()` returns true for either unsaved changes or an active write. `refreshOnFocus()` rechecks that state after every awaited operation and compares the disk value with `getCurrentValue()` before replacing it.

- [ ] **Step 4: Add the test file to `test:unit` and verify GREEN**

Run: `pnpm exec tsx --test test/document-sync.test.ts`

Expected: all document-sync tests pass.

---

### Task 2: SaveCoordinator external snapshot adoption

**Files:**

- Modify: `src/modules/markdown/save-coordinator.ts`
- Modify: `test/save-coordinator.test.ts`

**Interfaces:**

- Produces: `SaveCoordinator.adoptPersistedSnapshot()`.
- Consumers call this only after `editor.setValue()` has adopted content already persisted by another view.

- [ ] **Step 1: Write the failing state-transition test**

```ts
it("adopts externally persisted content as clean without writing", async () => {
  save.markChanged();
  save.adoptPersistedSnapshot();
  assert.equal(save.dirty, false);
  assert.equal(save.lastError, null);
  assert.equal(writes, 0);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec tsx --test test/save-coordinator.test.ts`

Expected: FAIL because `adoptPersistedSnapshot` is not defined.

- [ ] **Step 3: Implement the state transition**

```ts
adoptPersistedSnapshot() {
  this.currentRev += 1;
  this.savedRev = this.currentRev;
  this.lastError = null;
  this.options.onStateChange?.();
}
```

The monotonic revision must never move backwards, including when a previous write has completed.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec tsx --test test/save-coordinator.test.ts`

Expected: all SaveCoordinator tests pass.

---

### Task 3: Tab and sidebar lifecycle integration

**Files:**

- Modify: `src/modules/markdown/session-registry.ts`
- Modify: `src/modules/markdown/tab.ts`
- Modify: `src/modules/markdown/sidebar.ts`
- Modify: `test/markdown-sidebar.test.ts`
- Modify: `test/session-registry.test.ts`

**Interfaces:**

- Tab source ID: `tab:${tabID}`.
- Sidebar source ID: a controller-stable ID containing the attachment ID.
- Each session stores an unregister callback and a focus-refresh guard/promise.

- [ ] **Step 1: Write failing integration/source tests**

```ts
it("allows a sidebar editor even when the attachment is open in a tab", () => {
  assert.doesNotMatch(sidebarSource, /sessionRegistry\.find\([^)]*item\.id/);
});

it("registers tab and sidebar sources with the document sync registry", () => {
  assert.match(tabSource, /documentSyncRegistry\.register/);
  assert.match(sidebarSource, /documentSyncRegistry\.register/);
});

it("publishes edit and save invalidations from both surfaces", () => {
  assert.match(tabSource, /documentSyncRegistry\.markEdited/);
  assert.match(tabSource, /documentSyncRegistry\.markSaved/);
  assert.match(sidebarSource, /documentSyncRegistry\.markEdited/);
  assert.match(sidebarSource, /documentSyncRegistry\.markSaved/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm exec tsx --test test/markdown-sidebar.test.ts test/session-registry.test.ts`

Expected: FAIL because the conflict branch remains and sync registration does not exist.

- [ ] **Step 3: Integrate tab sessions**

Register after the editor is created. The adapter:

```ts
{
  sourceID: `tab:${session.tabID}`,
  itemID: session.itemID,
  hasLocalWork: () => session.save.dirty || session.save.writing,
  flush: () => requestSave(session, { force: true }),
  readPersisted: () => readMarkdownPath(session.path),
  applyPersisted: (value) => applyPersistedToTab(session, value),
}
```

`onChange` calls `markEdited`; `persistSession` calls `markSaved` only after a successful write. Root `focusin` and main-window `focus` listeners call a deduplicated refresh only when the Markdown tab is selected. Closing a session removes listeners and unregisters the source.

- [ ] **Step 4: Integrate sidebar sessions**

Remove the `sessionRegistry.find()` conflict branch and its hint-only ownership behavior. Register the sidebar editor after creation, call `markEdited` from `onChange`, call `markSaved` after successful persistence, and refresh on editor-host `focusin`, window focus when the Markdown pane is active, and repeated `onRender`/same-item reuse. Destroying or switching the editor unregisters the source.

- [ ] **Step 5: Prevent feedback saves during external apply**

For both surfaces, `applyPersisted(value)`:

```ts
if (editor.getValue() === value) return;
editor.setValue(value);
save.adoptPersistedSnapshot();
refresh images, outline/status, and metadata without scheduling autosave;
```

Because the current iframe `setValue()` does not emit `onChange`, no synthetic edit is generated. Recheck `save.dirty` immediately before applying after asynchronous disk reads.

- [ ] **Step 6: Verify focused integration tests**

Run: `pnpm exec tsx --test test/document-sync.test.ts test/save-coordinator.test.ts test/markdown-sidebar.test.ts test/session-registry.test.ts`

Expected: all focused tests pass.

---

### Task 4: H2 icon regression

**Files:**

- Modify: `addon/content/icons/markdown/h2.svg`
- Modify: `test/markdown-toolbar.test.ts`

**Interfaces:**

- `iconH2()` continues to resolve `chrome://bamboo/content/icons/markdown/h2.svg`.

- [ ] **Step 1: Write a failing asset test**

```ts
it("draws heading 2 with a complete two glyph", () => {
  const source = readFileSync(h2AssetURL, "utf8");
  assert.match(source, /expected-complete-two-path/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec tsx --test test/markdown-toolbar.test.ts`

Expected: FAIL because the existing final H2 path does not draw the lower horizontal stroke of `2`.

- [ ] **Step 3: Replace only the numeral path in `h2.svg`**

Keep the H and viewBox aligned with the H1/H3 assets, but use a complete two-stroke path with top curve, diagonal transition, and bottom horizontal stroke.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec tsx --test test/markdown-toolbar.test.ts`

Expected: all toolbar tests pass.

---

### Task 5: Full verification

**Files:**

- Review all modified files from Tasks 1-4.

- [ ] **Step 1: Format and lint**

Run: `pnpm lint:check`

Expected: exit code 0 with no formatting or ESLint errors.

- [ ] **Step 2: Run the complete unit suite**

Run: `pnpm test:unit`

Expected: all unit tests pass with zero failures.

- [ ] **Step 3: Build the production extension**

Run: `NODE_ENV=production pnpm build`

Expected: exit code 0, TypeScript checking succeeds, and the Bamboo XPI is produced.

- [ ] **Step 4: Review the diff and requirements**

Run: `git diff --check && git status --short && git diff --stat`

Expected: no whitespace errors; only the sync implementation, tests, plan, and H2 asset are modified.
