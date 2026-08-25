import assert from "node:assert/strict";
import test from "node:test";
import {
  MAIN_THREAD_FALLBACK_BYTES,
  MAX_WORKER_RENDER_BYTES,
  renderMarkdownAsync,
  utf8ByteLength,
} from "../src/modules/markdown/async-render.ts";

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
  assert.equal(MAIN_THREAD_FALLBACK_BYTES, 1024 * 1024);
});

test("refuses UI-thread fallback at one MiB", async () => {
  await assert.rejects(
    renderMarkdownAsync(
      { source: "x".repeat(MAIN_THREAD_FALLBACK_BYTES) },
      { workerRender: async () => Promise.reject(new Error("failed")) },
    ),
    { code: "WORKER_RENDER_FAILED" },
  );
});

test("rejects input above twenty MiB before invoking the worker", async () => {
  let invoked = false;
  await assert.rejects(
    renderMarkdownAsync(
      { source: "x".repeat(MAX_WORKER_RENDER_BYTES + 1) },
      {
        workerRender: async () => {
          invoked = true;
          return { title: "", bodyHtml: "" };
        },
      },
    ),
    { code: "DOCUMENT_TOO_LARGE" },
  );
  assert.equal(invoked, false);
});
