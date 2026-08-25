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
