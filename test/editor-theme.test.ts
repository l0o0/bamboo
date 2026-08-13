import assert from "node:assert/strict";
import test from "node:test";
import { liveEditorGeometry } from "../src/editor/theme.ts";

test("live editor puts horizontal spacing on lines for aligned selections", () => {
  assert.deepEqual(liveEditorGeometry(), {
    contentPadding: "20px 0 40px",
    linePadding: "0 30px 0 34px",
  });
});
