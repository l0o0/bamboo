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

test("viewport scrolling owns active outline publication", () => {
  const source = readFileSync("src/editor/bootstrap.ts", "utf8");
  const publishStart = source.indexOf("function publishActiveOutline");
  const publishEnd = source.indexOf("function guttersForMode", publishStart);
  const publishSource = source.slice(publishStart, publishEnd);

  assert.match(source, /update\.viewportChanged/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(publishSource, /activeOutlineAtScrollThreshold\(/);
  assert.doesNotMatch(publishSource, /selection\.main\.head/);
  assert.match(source, /scrollDOM\.getBoundingClientRect\(\)/);
  assert.match(source, /rect\.top \+ rect\.height \* 0\.5/);
  assert.match(source, /view\.lineBlockAt\(item\.from\)\.top/);
  assert.match(source, /scrollTop \+ scrollDOM\.clientHeight/);
  assert.match(source, /items\.at\(-1\)/);
  assert.match(source, /cancelAnimationFrame/);
});

test("parent editor exposes outline callbacks and navigation", () => {
  const source = readFileSync("src/modules/markdown/editor.ts", "utf8");

  assert.match(source, /onOutline\?/);
  assert.match(source, /onOutlineActive\?/);
  assert.match(source, /revealPosition:/);
  assert.match(source, /case "outline"/);
  assert.match(source, /case "outlineActive"/);
});
