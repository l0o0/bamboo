import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentPreviewGeneration } from "../src/modules/markdown/preview-render-state.ts";

test("accepts only the latest preview generation", () => {
  assert.equal(isCurrentPreviewGeneration(3, 3), true);
  assert.equal(isCurrentPreviewGeneration(2, 3), false);
});
