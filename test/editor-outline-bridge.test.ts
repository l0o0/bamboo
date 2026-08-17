import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EDITOR_MESSAGE_SOURCE,
  isEditorProtocolMessageForChannel,
} from "../src/modules/markdown/editor-protocol.ts";

test("outline messages remain channel scoped", () => {
  const message = {
    source: EDITOR_MESSAGE_SOURCE,
    channel: "tab-a:item-1",
    type: "outline",
    payload: { items: [], activeID: null },
  };

  assert.equal(
    isEditorProtocolMessageForChannel(message, "tab-a:item-1"),
    true,
  );
  assert.equal(
    isEditorProtocolMessageForChannel(message, "tab-b:item-2"),
    false,
  );
});

test("bootstrap schedules outline updates and handles revealPosition", () => {
  const source = readFileSync("src/editor/bootstrap.ts", "utf8");

  assert.match(source, /scheduleOutlineUpdate/);
  assert.match(source, /case "revealPosition"/);
  assert.match(source, /EditorView\.scrollIntoView/);
  assert.match(source, /outlineTimer/);
});

test("parent editor exposes outline callbacks and navigation", () => {
  const source = readFileSync("src/modules/markdown/editor.ts", "utf8");

  assert.match(source, /onOutline\?/);
  assert.match(source, /onOutlineActive\?/);
  assert.match(source, /revealPosition:/);
  assert.match(source, /case "outline"/);
  assert.match(source, /case "outlineActive"/);
});
