import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITOR_MESSAGE_SOURCE,
  applyDocChanges,
  isEditorProtocolMessageForChannel,
} from "../src/modules/markdown/editor-protocol.ts";

test("accepts editor messages only from the matching session channel", () => {
  const message = {
    source: EDITOR_MESSAGE_SOURCE,
    channel: "tab-3:item-303",
    type: "change",
    payload: {
      rev: 3,
      changes: [{ from: 0, to: 0, insert: "third document" }],
    },
  };

  assert.equal(
    isEditorProtocolMessageForChannel(message, "tab-3:item-303"),
    true,
  );
  assert.equal(
    isEditorProtocolMessageForChannel(message, "tab-1:item-101"),
    false,
  );
});

test("rejects unscoped editor messages when a channel is required", () => {
  assert.equal(
    isEditorProtocolMessageForChannel(
      { source: EDITOR_MESSAGE_SOURCE, type: "ready" },
      "tab-1:item-101",
    ),
    false,
  );
});

test("applies original-document changes from last to first", () => {
  assert.equal(
    applyDocChanges("hello world", [
      { from: 0, to: 5, insert: "hey" },
      { from: 6, to: 11, insert: "there" },
    ]),
    "hey there",
  );
});
