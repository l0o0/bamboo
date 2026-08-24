# Preview Worker and Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Preview and export Markdown rendering into a reusable Zotero Worker, add bounded failure handling, localize remaining user-facing errors, and prove table/API/image edge behavior with regression tests.

**Architecture:** A DOM-free render core is shared by the existing synchronous API and a third esbuild Worker bundle. A single injected Worker client handles request IDs, timeouts, restart, and disposal; an async render service applies UTF-8 size limits and the sub-1 MB fallback policy. Preview and export await this service while DOM/image work stays on the Zotero UI thread.

**Tech Stack:** TypeScript, esbuild through `zotero-plugin-scaffold`, Zotero `ChromeWorker`, markdown-it 15, Highlight.js, CodeMirror 6, Fluent, Node test runner via `tsx`.

## Global Constraints

- Preserve the synchronous public `markdown.render(source): string` API.
- Preview, HTML export, and PDF preparation use Worker rendering when Worker support is available.
- Measure limits as UTF-8 bytes: fallback below 1 MiB, reject above 20 MiB.
- Never run main-thread markdown-it fallback for a document of 1 MiB or more.
- Do not truncate Preview or exported documents.
- Keep image hydration and DOM mounting on the main thread.
- Reuse one Worker; do not add a Worker pool or network dependency.
- Do not restructure `bootstrap.ts` or the theme implementation.
- Keep internal logs in English and localize user-visible errors in en-US and zh-CN.
- Make table parser changes only after a failing regression test proves them necessary.
- Preserve all unrelated uncommitted work already present in the worktree.

---

### Task 1: Extract the DOM-Free Markdown Render Core

**Files:**

- Create: `src/modules/markdown/preview-render-core.ts`
- Modify: `src/modules/markdown/preview.ts`
- Test: `test/preview-document.test.ts`

**Interfaces:**

- Produces: `renderMarkdownCore(source: string): string`
- Produces: `documentTitleCore(source: string, fallback?: string): string`
- Preserves: `renderMarkdown(source: string): string` and `documentTitle(source: string, fallback?: string): string` exports from `preview.ts`

- [ ] **Step 1: Add a failing compatibility test**

Extend `test/preview-document.test.ts` to import the new core and prove it has the same safety and highlighting behavior as the public wrapper:

````ts
import {
  documentTitleCore,
  renderMarkdownCore,
} from "../src/modules/markdown/preview-render-core.ts";

test("the worker-safe render core preserves preview behavior", () => {
  const source = "---\ntitle: Worker title\n---\n\n```ts\nconst n = 1;\n```";
  assert.equal(documentTitleCore(source), "Worker title");
  assert.equal(renderMarkdownCore(source), renderMarkdown(source));
  assert.match(renderMarkdownCore(source), /hljs-keyword/);
  assert.doesNotMatch(renderMarkdownCore("[x](javascript:alert(1))"), /<a /);
});
````

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec tsx --test test/preview-document.test.ts
```

Expected: FAIL because `preview-render-core.ts` does not exist.

- [ ] **Step 3: Move pure rendering into the core**

Move the markdown-it constructor, safe link validator, hardened link/image renderer rules, `renderMarkdown` body, and title extraction into `preview-render-core.ts`. Export:

```ts
export function renderMarkdownCore(source: string): string;
export function documentTitleCore(
  source: string,
  fallback = "Markdown",
): string;
```

Keep `preview.ts` API-compatible:

```ts
export function renderMarkdown(source: string): string {
  return renderMarkdownCore(source);
}

export function documentTitle(source: string, fallback = "Markdown"): string {
  return documentTitleCore(source, fallback);
}
```

The core may import `frontmatter.ts`, `code-highlight.ts`, and `images/model.ts`, but must not import `getString`, Zotero globals, DOM types, or tab/session modules.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
pnpm exec tsx --test test/preview-document.test.ts
```

Expected: all preview document tests PASS.

- [ ] **Step 5: Commit the render-core extraction**

```bash
git add src/modules/markdown/preview-render-core.ts src/modules/markdown/preview.ts test/preview-document.test.ts
git commit -m "refactor(markdown): extract worker-safe render core"
```

---

### Task 2: Define and Build the Preview Worker

**Files:**

- Create: `src/modules/markdown/preview-worker-protocol.ts`
- Create: `src/workers/preview-worker.ts`
- Modify: `zotero-plugin.config.ts`
- Create: `test/preview-worker-protocol.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `PreviewWorkerRequest`, `PreviewWorkerResponse`, and protocol guards
- Consumes: `renderMarkdownCore()` and `documentTitleCore()` from Task 1
- Produces build artifact: `.scaffold/build/addon/content/workers/preview-worker.js`

- [ ] **Step 1: Write failing protocol tests**

Create `test/preview-worker-protocol.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  isPreviewWorkerRequest,
  isPreviewWorkerResponse,
} from "../src/modules/markdown/preview-worker-protocol.ts";

test("validates versioned preview worker messages", () => {
  assert.equal(
    isPreviewWorkerRequest({ version: 1, requestID: 2, source: "# A" }),
    true,
  );
  assert.equal(
    isPreviewWorkerResponse({
      version: 1,
      requestID: 2,
      ok: true,
      title: "A",
      bodyHtml: "<h1>A</h1>",
    }),
    true,
  );
  assert.equal(isPreviewWorkerResponse({ requestID: 2, ok: true }), false);
});
```

- [ ] **Step 2: Run the protocol test and verify RED**

```bash
pnpm exec tsx --test test/preview-worker-protocol.test.ts
```

Expected: FAIL because the protocol module does not exist.

- [ ] **Step 3: Implement the versioned protocol and Worker handler**

Define the exact protocol from the approved spec and strict guards that reject wrong versions, non-integer request IDs, and incomplete success/error variants.

In `src/workers/preview-worker.ts`, install one message handler:

```ts
self.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isPreviewWorkerRequest(event.data)) return;
  const { requestID, source, title } = event.data;
  try {
    self.postMessage({
      version: 1,
      requestID,
      ok: true,
      title: title || documentTitleCore(source),
      bodyHtml: renderMarkdownCore(source),
    } satisfies PreviewWorkerResponse);
  } catch (error) {
    self.postMessage({
      version: 1,
      requestID,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies PreviewWorkerResponse);
  }
});
```

- [ ] **Step 4: Add the third esbuild entry**

Append this entry to `build.esbuildOptions` in `zotero-plugin.config.ts`:

```ts
{
  entryPoints: ["src/workers/preview-worker.ts"],
  bundle: true,
  minify: true,
  target: "firefox115",
  outfile: ".scaffold/build/addon/content/workers/preview-worker.js",
},
```

Add `test/preview-worker-protocol.test.ts` to `test:unit` in `package.json`.

- [ ] **Step 5: Verify protocol and bundle output**

Run:

```bash
pnpm exec tsx --test test/preview-worker-protocol.test.ts
pnpm build
test -s .scaffold/build/addon/content/workers/preview-worker.js
```

Expected: test PASS, build exits 0, and the Worker artifact is non-empty.

- [ ] **Step 6: Commit the Worker bundle**

```bash
git add src/modules/markdown/preview-worker-protocol.ts src/workers/preview-worker.ts zotero-plugin.config.ts test/preview-worker-protocol.test.ts package.json
git commit -m "feat(markdown): add preview render worker"
```

---

### Task 3: Implement Worker Client Lifecycle and Timeouts

**Files:**

- Create: `src/modules/markdown/preview-worker-client.ts`
- Create: `test/preview-worker-client.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `PreviewWorkerClient`
- Produces: `PreviewWorkerClientError` with codes `WORKER_UNAVAILABLE`, `WORKER_RENDER_TIMEOUT`, `WORKER_RENDER_FAILED`, and `WORKER_DISPOSED`
- Consumes: protocol types and guards from Task 2

- [ ] **Step 1: Write failing client lifecycle tests**

Create a small fake Worker implementing `postMessage`, `terminate`, and event listener registration. Test these behaviors independently:

```ts
test("resolves concurrent requests by request ID", async () => {
  const worker = new FakeWorker();
  const client = new PreviewWorkerClient(() => worker, { timeoutMs: 100 });
  const first = client.render("# First");
  const second = client.render("# Second");
  worker.respondSuccess(2, "Second", "<h1>Second</h1>");
  worker.respondSuccess(1, "First", "<h1>First</h1>");
  assert.equal((await first).title, "First");
  assert.equal((await second).title, "Second");
});

test("times out pending work and recreates the worker", async () => {
  const workers = [new FakeWorker(), new FakeWorker()];
  const client = new PreviewWorkerClient(() => workers.shift()!, {
    timeoutMs: 5,
  });
  await assert.rejects(client.render("slow"), {
    code: "WORKER_RENDER_TIMEOUT",
  });
  assert.equal(workers.length, 1);
  void client.render("retry");
  assert.equal(workers.length, 0);
});

test("dispose rejects every pending request", async () => {
  const worker = new FakeWorker();
  const client = new PreviewWorkerClient(() => worker, { timeoutMs: 100 });
  const pending = client.render("# Pending");
  client.dispose();
  await assert.rejects(pending, { code: "WORKER_DISPOSED" });
  assert.equal(worker.terminated, true);
});
```

Also test malformed/unknown responses are ignored and Worker `error` events reject all pending requests.

- [ ] **Step 2: Run client tests and verify RED**

```bash
pnpm exec tsx --test test/preview-worker-client.test.ts
```

Expected: FAIL because `PreviewWorkerClient` does not exist.

- [ ] **Step 3: Implement the injected single-Worker client**

Define a minimal `WorkerLike` interface so tests do not require browser globals. `render(source, title?)` must:

```ts
render(source: string, title?: string): Promise<{
  title: string;
  bodyHtml: string;
}>;
```

Use one monotonically increasing request ID and a pending map containing each resolve, reject, and timeout handle. On timeout or Worker error:

1. reject affected pending requests with a stable code;
2. clear their timers;
3. terminate the Worker;
4. set the cached Worker to null so the next request creates a fresh one.

The production factory uses Zotero's privileged Worker constructor and URL:

```ts
const url = `chrome://${addon.data.config.addonRef}/content/workers/preview-worker.js`;
return new ChromeWorker(url);
```

Access `ChromeWorker` through a locally typed global declaration rather than `any`.

- [ ] **Step 4: Run lifecycle tests and verify GREEN**

```bash
pnpm exec tsx --test test/preview-worker-client.test.ts
```

Expected: all Worker client tests PASS without leaked timers.

- [ ] **Step 5: Add the test to the default suite and commit**

Add `test/preview-worker-client.test.ts` to `test:unit`, then run:

```bash
pnpm test:unit
```

Expected: all tests PASS.

```bash
git add src/modules/markdown/preview-worker-client.ts test/preview-worker-client.test.ts package.json
git commit -m "feat(markdown): manage preview worker lifecycle"
```

---

### Task 4: Add the Bounded Asynchronous Rendering Service

**Files:**

- Create: `src/modules/markdown/async-render.ts`
- Create: `test/async-render.test.ts`
- Modify: `src/modules/markdown/preview.ts`
- Modify: `src/modules/markdown/export-document.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `utf8ByteLength(source: string): number`
- Produces: `renderMarkdownAsync(options): Promise<{ title: string; bodyHtml: string }>`
- Produces: `disposeMarkdownRenderer(): void`
- Produces: `buildStandaloneDocumentFromRendered(options): ReadOnlyDocument`
- Consumes: `PreviewWorkerClient` from Task 3 and synchronous core from Task 1

- [ ] **Step 1: Write failing threshold and fallback tests**

Create `test/async-render.test.ts` using an injected renderer:

```ts
test("measures limits as UTF-8 bytes", () => {
  assert.equal(utf8ByteLength("abc"), 3);
  assert.equal(utf8ByteLength("竹子"), 6);
});

test("falls back synchronously only below one MiB", async () => {
  const result = await renderMarkdownAsync(
    { source: "# Small" },
    {
      workerRender: async () => {
        throw new Error("worker failed");
      },
      syncRender: () => ({ title: "Small", bodyHtml: "<h1>Small</h1>" }),
    },
  );
  assert.equal(result.bodyHtml, "<h1>Small</h1>");
});

test("refuses UI-thread fallback at one MiB", async () => {
  await assert.rejects(
    renderMarkdownAsync(
      { source: "x".repeat(1024 * 1024) },
      { workerRender: async () => Promise.reject(new Error("failed")) },
    ),
    { code: "WORKER_RENDER_FAILED" },
  );
});

test("rejects input above twenty MiB before invoking the worker", async () => {
  let invoked = false;
  await assert.rejects(
    renderMarkdownAsync(
      { source: "x".repeat(20 * 1024 * 1024 + 1) },
      {
        workerRender: async () => (
          (invoked = true),
          { title: "", bodyHtml: "" }
        ),
      },
    ),
    { code: "DOCUMENT_TOO_LARGE" },
  );
  assert.equal(invoked, false);
});
```

- [ ] **Step 2: Run async rendering tests and verify RED**

```bash
pnpm exec tsx --test test/async-render.test.ts
```

Expected: FAIL because `async-render.ts` does not exist.

- [ ] **Step 3: Implement thresholds and fallback**

Use exact constants:

```ts
export const MAIN_THREAD_FALLBACK_BYTES = 1 * 1024 * 1024;
export const MAX_WORKER_RENDER_BYTES = 20 * 1024 * 1024;
```

Use `TextEncoder().encode(source).byteLength`, with a UTF-8-safe fallback helper only if `TextEncoder` is unavailable. Do not allocate a second 20 MB string.

Map Worker client errors into stable render errors. Preserve `WORKER_RENDER_TIMEOUT` and `WORKER_UNAVAILABLE`; map unexpected failures to `WORKER_RENDER_FAILED`.

- [ ] **Step 4: Split standalone document assembly from rendering**

In `preview.ts`, introduce:

```ts
export function buildStandaloneDocumentFromRendered(options: {
  title: string;
  bodyHtml: string;
  assets?: ImageAssetMap;
  theme?: "light" | "dark";
}): ReadOnlyDocument;
```

Keep `buildStandaloneDocument()` synchronous by rendering through the core and delegating to the new assembly function. Change `buildExportHtml()` to await `renderMarkdownAsync()` and then call `buildStandaloneDocumentFromRendered()`.

- [ ] **Step 5: Verify async rendering and existing output**

```bash
pnpm exec tsx --test test/async-render.test.ts test/preview-document.test.ts
```

Expected: threshold tests and all existing HTML-hardening/export tests PASS.

- [ ] **Step 6: Add tests to the suite and commit**

```bash
git add src/modules/markdown/async-render.ts src/modules/markdown/preview.ts src/modules/markdown/export-document.ts test/async-render.test.ts package.json
git commit -m "feat(markdown): render previews through bounded worker service"
```

---

### Task 5: Integrate Async Preview, Stale-Result Protection, and Shutdown

**Files:**

- Create: `src/modules/markdown/preview-render-state.ts`
- Modify: `src/modules/markdown/preview.ts`
- Modify: `src/modules/markdown/tab.ts`
- Modify: `src/hooks.ts`
- Modify: `src/modules/markdown/index.ts`
- Create: `test/preview-render-state.test.ts`
- Modify: `test/preview-document.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `isCurrentPreviewGeneration(started: number, current: number): boolean`
- Changes: `mountPreviewHtml()` accepts already-rendered HTML instead of synchronously rendering source
- Consumes: `renderMarkdownAsync()` and `disposeMarkdownRenderer()` from Task 4

- [ ] **Step 1: Write a failing stale-generation test**

Create `test/preview-render-state.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentPreviewGeneration } from "../src/modules/markdown/preview-render-state.ts";

test("accepts only the latest preview generation", () => {
  assert.equal(isCurrentPreviewGeneration(3, 3), true);
  assert.equal(isCurrentPreviewGeneration(2, 3), false);
});
```

- [ ] **Step 2: Run the generation test and verify RED**

```bash
pnpm exec tsx --test test/preview-render-state.test.ts
```

Expected: FAIL because the state helper does not exist.

- [ ] **Step 3: Implement asynchronous Preview mounting**

Add `previewRenderGeneration: number` to each `OpenSession`. Every Preview request increments it and captures the new value. Switching to Live/Source or closing the session also increments it.

`showReadOnlyPreview()` must:

1. set mode and loading status;
2. snapshot source;
3. await `renderMarkdownAsync({ source })`;
4. return without DOM writes unless the generation is still current, the mode is still `preview`, and the preview element remains connected;
5. call `mountPreviewHtml(previewEl, rendered, outlineItems)`;
6. hydrate images and set the localized ready status.

On failure, mount a localized error state with a `data-action="preview-retry"` button. The existing root click delegation invokes `showReadOnlyPreview(session)` for that action.

- [ ] **Step 4: Dispose the shared renderer during shutdown**

Export `disposeMarkdownRenderer` from `src/modules/markdown/index.ts` and call it in `onShutdown()` after session/sidebar flush and before toolkit teardown:

```ts
disposeMarkdownRenderer();
```

- [ ] **Step 5: Verify Preview state and tab contracts**

```bash
pnpm exec tsx --test test/preview-render-state.test.ts test/preview-document.test.ts test/markdown-toolbar.test.ts
```

Expected: all tests PASS and source inspection confirms Preview calls the async service.

- [ ] **Step 6: Add the test to the suite and commit**

```bash
git add src/modules/markdown/preview-render-state.ts src/modules/markdown/preview.ts src/modules/markdown/tab.ts src/hooks.ts src/modules/markdown/index.ts test/preview-render-state.test.ts test/preview-document.test.ts package.json
git commit -m "feat(markdown): mount worker previews safely"
```

---

### Task 6: Localize Remaining User-Facing Errors

**Files:**

- Modify: `addon/locale/en-US/mainWindow.ftl`
- Modify: `addon/locale/zh-CN/mainWindow.ftl`
- Modify: `typings/i10n.d.ts`
- Modify: `src/modules/markdown/images/service.ts`
- Modify: `src/modules/markdown/tab.ts`
- Modify: `src/modules/markdown/preview.ts`
- Modify: `test/preview-document.test.ts`
- Create: `test/markdown-error-i18n.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: existing `getString()` Fluent helper
- Produces: localized messages for image capability, missing assets, attachment disappearance, rename/print failures, Worker failure, timeout, unavailable runtime, oversized document, retry, and loading

- [ ] **Step 1: Write a failing localization coverage test**

Create `test/markdown-error-i18n.test.ts` that reads both FTL files and the relevant TypeScript sources. Assert every required key exists in both locales and that the source files no longer contain the migrated Chinese literals:

```ts
const keys = [
  "error-stored-image-only",
  "error-not-text-attachment",
  "error-read-only-image",
  "error-image-reference-unsupported",
  "error-image-missing",
  "error-attachment-gone",
  "error-rename-missing",
  "error-rename-exists",
  "error-rename-failed",
  "error-print-window",
  "error-preview-too-large",
  "error-preview-timeout",
  "error-preview-worker-failed",
  "error-preview-worker-unavailable",
  "preview-loading",
  "preview-retry",
];
```

- [ ] **Step 2: Run the i18n test and verify RED**

```bash
pnpm exec tsx --test test/markdown-error-i18n.test.ts
```

Expected: FAIL because the keys and migrated calls are absent.

- [ ] **Step 3: Add Fluent messages and migrate UI boundaries**

Add idiomatic English and Chinese values for every listed key and update `typings/i10n.d.ts`. Replace user-visible throws and ProgressWindow text with `getString()` calls.

Do not localize internal log messages such as `Preview worker failed`, error codes, or the `Bamboo 竹子` brand name.

Map async render error codes in one UI helper rather than repeating switches:

```ts
function previewErrorMessage(error: unknown): string {
  switch (renderErrorCode(error)) {
    case "DOCUMENT_TOO_LARGE":
      return getString("error-preview-too-large");
    case "WORKER_RENDER_TIMEOUT":
      return getString("error-preview-timeout");
    case "WORKER_UNAVAILABLE":
      return getString("error-preview-worker-unavailable");
    default:
      return getString("error-preview-worker-failed");
  }
}
```

- [ ] **Step 4: Verify localization coverage**

```bash
pnpm exec tsx --test test/markdown-error-i18n.test.ts test/preview-document.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Add the test to the suite and commit**

```bash
git add addon/locale/en-US/mainWindow.ftl addon/locale/zh-CN/mainWindow.ftl typings/i10n.d.ts src/modules/markdown/images/service.ts src/modules/markdown/tab.ts src/modules/markdown/preview.ts test/markdown-error-i18n.test.ts test/preview-document.test.ts package.json
git commit -m "refactor(i18n): localize markdown operation errors"
```

---

### Task 7: Prove API/Image Contracts and Table Delimiter Edges

**Files:**

- Modify: `test/markdown-api-guards.test.ts`
- Modify: `test/image-import-safety.test.ts`
- Modify: `test/editor-table.test.ts`
- Modify only if a test fails: `src/editor/table.ts`
- Modify: `docs/reviews/2026-08-24-code-review.md`

**Interfaces:**

- Verifies existing API snapshot guard and cleanup propagation
- Verifies bounded streamed image reads and cancellation
- Verifies GFM delimiter rows through public `tableLayoutAt()` behavior

- [ ] **Step 1: Add API and image contract assertions**

Extend the existing tests to cover:

```ts
test("keeps cleanup enabled for open editor saves", () => {
  const source = readFileSync(apiURL, "utf8");
  assert.match(
    source,
    /save\.request\(\{ force: true, cleanupImages: opts\.cleanupImages \}\)/,
  );
  assert.match(source, /writeContent\(item, content, options, existing\)/);
});

test("cancels a streamed response after it crosses the byte cap", async () => {
  let cancelled = false;
  const response = responseWithReader(
    [
      [1, 2],
      [3, 4],
    ],
    () => {
      cancelled = true;
    },
  );
  await assert.rejects(readResponseBytes(response, 3));
  assert.equal(cancelled, true);
});
```

- [ ] **Step 2: Add delimiter-row table cases**

Use the existing CodeMirror state helper and `tableLayoutAt()` to assert equivalent three-column layouts for:

```md
| :--- | :---: | ---: |
| :--- | :---: | ---: |
| ---  |  ---  |  --- |
| ---  |  ---  |  --- |
```

Also cover a valid table whose body rows are shorter than the delimiter row. Assert three logical columns and left/center/right alignment.

- [ ] **Step 3: Run focused tests and classify the result**

```bash
pnpm exec tsx --test test/markdown-api-guards.test.ts test/image-import-safety.test.ts test/editor-table.test.ts
```

Expected: API/image contracts PASS. If delimiter cases PASS, leave `table.ts` unchanged. If a delimiter case FAILS, retain that failing test and continue to Step 4.

- [ ] **Step 4: Apply the smallest proven delimiter fix if required**

If necessary, replace only `delimiterCells()` with the same logical range policy as `rowCells()`: preserve empty segments between adjacent pipes, ignore only optional outer pipes, trim cell contents through `trimCell()`, and do not implement independent table recognition.

Re-run:

```bash
pnpm exec tsx --test test/editor-table.test.ts test/editor-table-cell-edit.test.ts test/editor-table-operations.test.ts
```

Expected: all table tests PASS.

- [ ] **Step 5: Update the review record and commit**

Append the Worker/i18n/table verification outcome and final test count to `docs/reviews/2026-08-24-code-review.md`. State explicitly whether `delimiterCells()` required a code change.

```bash
git add test/markdown-api-guards.test.ts test/image-import-safety.test.ts test/editor-table.test.ts src/editor/table.ts docs/reviews/2026-08-24-code-review.md
git commit -m "test(markdown): cover worker and parsing boundaries"
```

---

### Task 8: Full Verification and Release Readiness Check

**Files:**

- Verify only; modify files only to correct failures attributable to Tasks 1-7

**Interfaces:**

- Confirms the complete approved design and preserves the existing plugin build

- [ ] **Step 1: Run the complete unit suite**

```bash
pnpm test:unit
```

Expected: zero failed, cancelled, skipped, or todo tests.

- [ ] **Step 2: Run formatting and lint checks**

```bash
pnpm lint:check
```

Expected: Prettier reports all files matched and ESLint exits 0.

- [ ] **Step 3: Build all three bundles and type-check**

```bash
pnpm build
test -s .scaffold/build/addon/content/scripts/zoteromarkdown.js
test -s .scaffold/build/addon/content/editor/editor.js
test -s .scaffold/build/addon/content/workers/preview-worker.js
```

Expected: build and `tsc --noEmit` exit 0; plugin, editor, and Worker bundles are non-empty.

- [ ] **Step 4: Inspect the final diff and worktree ownership**

```bash
git diff --check
git status --short
git log --oneline -8
```

Expected: no whitespace errors; all task commits are present; unrelated pre-existing changes remain preserved.

- [ ] **Step 5: Report runtime verification limits**

Record that automated tests use an injected Worker and that final validation in a running Zotero instance should exercise:

- a normal Preview render;
- a large fenced-code document while the Zotero UI remains responsive;
- rapid Preview/Live switching without stale content;
- HTML export and PDF print;
- forced Worker termination followed by retry.

Do not claim these Zotero-runtime checks were performed unless they were actually run.
