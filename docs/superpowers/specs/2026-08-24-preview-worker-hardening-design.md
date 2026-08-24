# Preview Worker and Review Hardening Design

## Objective

Move expensive Markdown preview and export rendering away from Zotero's UI
thread, then finish the remaining bounded review work: rendering failure
handling, user-facing error localization, API/image contract tests, and table
delimiter edge tests.

The design must preserve full-document viewing and export for ordinary large
documents. Size thresholds are safety limits, not the primary rendering
strategy.

## Scope

This work includes:

- asynchronous Worker rendering for Preview, HTML export, and PDF print;
- request isolation, timeout handling, Worker restart, and bounded fallback;
- a 20 MB maximum Worker input size;
- a main-thread fallback only for documents smaller than 1 MB;
- localized user-facing errors for the remaining Markdown workflows;
- contract-level API, sidebar, and image-import tests;
- delimiter-row table parsing edge tests and only the fixes those tests prove
  necessary.

This work does not include:

- restructuring `bootstrap.ts` or the theme implementation;
- a Worker pool;
- incremental or section-based Markdown rendering;
- live network tests;
- a mandatory Zotero profile integration test in the default unit suite;
- changing the synchronous public `markdown.render(source)` API.

## Architecture

### Worker Bundle

Add `src/workers/preview-worker.ts` as a third esbuild entry. It bundles
markdown-it, frontmatter handling, and Highlight.js into
`addon/content/workers/preview-worker.js`, targeting the same Firefox version
as the plugin and editor bundles.

The Worker accepts a versioned request:

```ts
interface PreviewWorkerRequest {
  version: 1;
  requestID: number;
  source: string;
  title?: string;
}
```

It returns either a successful render or a serializable failure:

```ts
type PreviewWorkerResponse =
  | {
      version: 1;
      requestID: number;
      ok: true;
      title: string;
      bodyHtml: string;
    }
  | {
      version: 1;
      requestID: number;
      ok: false;
      error: string;
    };
```

The Worker performs only deterministic text transformation. It does not use
Zotero globals, access files, resolve image assets, or mutate DOM.

### Worker Client

Add a single reusable client owned by the Markdown module. The client:

- lazily creates one Worker;
- assigns a monotonically increasing request ID;
- tracks pending requests independently;
- rejects timed-out requests;
- terminates and clears the Worker after an error or timeout;
- ignores responses for unknown or already-settled request IDs;
- rejects all pending requests when disposed during plugin shutdown.

The first implementation uses one Worker rather than a pool. Preview and
export requests are not CPU-parallelized because concurrent large renders
would increase memory pressure and provide little benefit for an interactive
editor.

### Rendering Service

Add an asynchronous rendering service shared by Preview and export. It checks
the input before posting to the Worker:

- inputs up to 20 MB are accepted;
- larger inputs fail with a stable `DOCUMENT_TOO_LARGE` error;
- Worker failures for inputs smaller than 1 MB fall back to the existing
  synchronous renderer;
- Worker failures for inputs of 1 MB or more return a stable
  `WORKER_RENDER_FAILED` error and do not run markdown-it on the UI thread.

The thresholds are measured as UTF-8 bytes so Chinese text and ASCII-heavy
code are treated consistently with actual transfer and memory cost.

The existing synchronous `renderMarkdown()` remains available for the public
in-process API and the bounded fallback. Its behavior and return type do not
change.

### Preview and Export Flow

Preview mode becomes asynchronous:

1. Capture the source and a per-session render generation.
2. Show the existing preview surface in a loading state.
3. Render through the shared Worker service.
4. Discard the result if the session generation changed while rendering.
5. Apply cached image assets and mount the returned HTML on the UI thread.
6. On failure, show a localized error and a retry action.

HTML export and PDF print await the same rendering service before building the
standalone document. Export always uses the full accepted source. It does not
truncate or paginate content.

The returned HTML still has to be parsed and inserted on the UI thread. The
Worker removes parsing and syntax-highlighting CPU cost, but cannot eliminate
all cost of mounting a very large DOM. Generation checks prevent stale output
from replacing a newer document.

## Error Model and Localization

User-visible errors are represented by stable codes and localized at the UI
boundary. Remaining Chinese literals for attachment disappearance, rename
failures, image capability, missing image assets, print-window failures, and
Worker rendering failures move to Fluent messages in `en-US` and `zh-CN`.

Internal logs remain concise English diagnostics and include the original
exception. The `Bamboo 竹子` brand name is not localized.

Worker failures expose these user-facing states:

- `DOCUMENT_TOO_LARGE`: the document exceeds 20 MB;
- `WORKER_RENDER_TIMEOUT`: the Worker did not respond before the timeout;
- `WORKER_RENDER_FAILED`: the Worker crashed or returned an error;
- `WORKER_UNAVAILABLE`: Worker construction is unavailable in the runtime.

Retry creates a fresh Worker after any timeout or fatal Worker failure.

## Test Strategy

All behavior changes follow a red-green test cycle.

Unit and contract tests cover:

- request/response protocol validation;
- independent resolution of concurrent request IDs;
- stale and unknown responses;
- timeout rejection and Worker restart;
- shutdown rejection of pending work;
- UTF-8 threshold calculation;
- main-thread fallback below 1 MB and refusal above it;
- Preview generation checks;
- complete HTML export through the asynchronous renderer;
- bounded external-image response reading;
- API update snapshot conflicts and cleanup propagation;
- sidebar save/close contracts;
- delimiter rows with leading/trailing pipes, no outer pipes, empty segments,
  alignment markers, whitespace, and ragged rows.

Tests use injected Worker factories and fake responses. They do not require
network access or a real Zotero profile. The existing Zotero plugin test
harness remains available for a later CI integration suite, but is not made a
default dependency of `pnpm test:unit` in this work.

## Table Delimiter Policy

`delimiterCells` is not rewritten speculatively. Tests first describe the
logical columns expected from valid GFM delimiter rows. If the current
implementation passes, it remains unchanged. If a test proves an error, the
smallest correction is made while preserving existing table layout and cell
editing behavior.

Malformed delimiter rows continue to follow the CodeMirror Markdown parser's
decision about whether a table exists. Bamboo does not add a second complete
GFM table recognizer.

## Lifecycle and Compatibility

The Worker client is disposed during plugin shutdown. Pending promises reject
instead of hanging. A Worker is recreated lazily after disposal only when the
plugin lifecycle creates a new client.

The implementation preserves:

- Zotero's current Firefox target;
- the synchronous public render API;
- current Markdown HTML hardening and link validation;
- complete local image hydration on the main thread;
- the existing Live and Source editor behavior;
- the current output structure and CSS classes used by Preview and export.

## Acceptance Criteria

- Preview, HTML export, and PDF preparation do not execute markdown-it or
  Highlight.js on the Zotero UI thread when Worker support is available.
- A Worker crash or timeout cannot leave a pending request unresolved.
- Documents below 1 MB retain a safe synchronous fallback.
- Documents from 1 MB through 20 MB never fall back to UI-thread Markdown
  rendering after Worker failure and can be retried with a fresh Worker.
- Documents above 20 MB fail before Worker transfer with a localized message.
- Rapid document or mode changes cannot mount stale Worker output.
- Existing public API behavior remains compatible.
- User-facing Markdown errors are localized in English and Chinese.
- Table delimiter changes, if any, are justified by a failing regression test.
- `pnpm test:unit`, `pnpm lint:check`, and `pnpm build` pass.
