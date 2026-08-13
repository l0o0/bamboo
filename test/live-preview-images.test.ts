import assert from "node:assert/strict";
import test from "node:test";
import { planLiveImageDecorations } from "../src/editor/live-preview/images";

test("inactive image lines replace source with the preview", () => {
  assert.deepEqual(planLiveImageDecorations("![alt](assets/a.png)", false), [
    {
      kind: "replace",
      from: 0,
      to: 20,
      alt: "alt",
      source: "assets/a.png",
    },
  ]);
});

test("active image lines keep source and add an inline preview at line end", () => {
  assert.deepEqual(planLiveImageDecorations("![alt](assets/a.png)", true), [
    {
      kind: "inline",
      from: 20,
      to: 20,
      alt: "alt",
      source: "assets/a.png",
    },
  ]);
});
