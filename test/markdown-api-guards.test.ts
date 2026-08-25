import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { editorSnapshotChanged } from "../src/modules/markdown/api-guards.ts";

test("detects editor input that arrives after the API snapshot", () => {
  assert.equal(editorSnapshotChanged("before", "after"), true);
  assert.equal(editorSnapshotChanged("same", "same"), false);
});

test("does not skip image cleanup when replacement content is unchanged", () => {
  const source = readFileSync(
    new URL("../src/modules/markdown/api.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /content === existing && !options\.cleanupImages/);
});
